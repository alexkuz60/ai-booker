import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SEGMENT_CONFIG } from "@/components/studio/storyboard/constants";
import type { Segment } from "@/components/studio/storyboard/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { LocalStoryboardData } from "@/lib/storyboardSync";
import { paths } from "@/lib/projectPaths";
import { Loader2, Languages, Sparkles, Scale, Lock } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type RadarStage, STAGE_LABELS, readAllStages, getSegmentStage } from "@/lib/radarStages";

export interface SelectedSegmentData {
  segmentId: string;
  originalText: string;
  translatedText: string;
  segmentType: string;
  speaker: string | null;
}

interface Props {
  /** Source project storage (original text) */
  sourceStorage: ProjectStorage | null;
  /** Translation project storage (translated text) */
  translationStorage: ProjectStorage | null;
  sceneId: string | null;
  chapterId: string | null;
  isRu: boolean;
  /** Translate a batch of segments */
  onTranslateSegments?: (segments: Segment[]) => Promise<void>;
  /** Literary edit a single segment */
  onLiteraryEdit?: (segment: Segment) => Promise<void>;
  /** Critique a single segment */
  onCritique?: (segment: Segment) => Promise<void>;
  /** Is currently translating */
  translating?: boolean;
  /** Translation progress label */
  progressLabel?: string | null;
  /** Currently selected segment id */
  selectedSegmentId?: string | null;
  /** Callback when user selects a segment for radar inspection */
  onSelectSegment?: (data: SelectedSegmentData | null) => void;
}

interface SegmentWithTranslation {
  segment: Segment;
  translatedText: string;
  /** Has literal translation stored */
  hasLiteral: boolean;
}

/**
 * Bilingual view: each segment is an accordion item.
 * Original text (read-only) + translation (from translation project) below.
 */
export function BilingualSegmentsView({
  sourceStorage,
  translationStorage,
  sceneId,
  chapterId,
  isRu,
  onTranslateSegments,
  onLiteraryEdit,
  onCritique,
  translating = false,
  progressLabel,
  selectedSegmentId,
  onSelectSegment,
}: Props) {
  const [items, setItems] = useState<SegmentWithTranslation[]>([]);
  const [loading, setLoading] = useState(false);
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  const [segmentStages, setSegmentStages] = useState<Map<string, RadarStage | null>>(new Map());
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const [critiquingIds, setCritiquingIds] = useState<Set<string>>(new Set());

  // Load source segments + any existing translations
  useEffect(() => {
    if (!sourceStorage || !sceneId || !chapterId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        // Read source storyboard
        const sourceData = await sourceStorage.readJSON<LocalStoryboardData>(
          paths.storyboard(sceneId, chapterId),
        );
        const segments = sourceData?.segments ?? [];

        // Read translation storyboard (if exists)
        let translationSegments: Segment[] = [];
        if (translationStorage) {
          const transData = await translationStorage.readJSON<LocalStoryboardData>(
            `chapters/${chapterId}/scenes/${sceneId}/storyboard.json`,
          );
          translationSegments = transData?.segments ?? [];
        }

        // Build lookup: segmentId → translated text
        const transMap = new Map<string, { text: string; hasLiteral: boolean }>();
        for (const tseg of translationSegments) {
          const text = tseg.phrases.map(p => p.text).filter(Boolean).join(" ");
          const hasLiteral = !!(tseg as any)._literal;
          transMap.set(tseg.segment_id, { text, hasLiteral });
        }

        if (!cancelled) {
          setItems(segments.map(seg => {
            const trans = transMap.get(seg.segment_id);
            return {
              segment: seg,
              translatedText: trans?.text ?? "",
              hasLiteral: trans?.hasLiteral ?? false,
            };
          }));
        }
      } catch (err) {
        console.error("[BilingualSegmentsView] read error:", err);
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sourceStorage, translationStorage, sceneId, chapterId]);

  // Translate single segment
  const handleTranslateSegment = useCallback(async (seg: Segment) => {
    if (!onTranslateSegments) return;
    setTranslatingIds(prev => new Set(prev).add(seg.segment_id));
    try {
      await onTranslateSegments([seg]);
    } finally {
      setTranslatingIds(prev => {
        const next = new Set(prev);
        next.delete(seg.segment_id);
        return next;
      });
    }
  }, [onTranslateSegments]);

  // Translate all segments of current scene
  const handleTranslateScene = useCallback(async () => {
    if (!onTranslateSegments || items.length === 0) return;
    await onTranslateSegments(items.map(i => i.segment));
  }, [onTranslateSegments, items]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-xs">{isRu ? "Загрузка…" : "Loading…"}</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic py-3 text-center">
        {isRu ? "Раскадровка не найдена" : "No storyboard found"}
      </p>
    );
  }

  const allIds = items.map((i) => i.segment.segment_id);

  return (
    <div className="space-y-2">
      {/* Scene-level translate button */}
      {onTranslateSegments && (
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTranslateScene}
            disabled={translating}
            className="h-7 text-xs gap-1.5"
          >
            {translating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Languages className="h-3 w-3" />
            )}
            {translating && progressLabel
              ? progressLabel
              : isRu ? "Перевести сцену" : "Translate scene"}
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {items.filter(i => i.hasLiteral).length}/{items.length} {isRu ? "переведено" : "translated"}
          </span>
        </div>
      )}

      <Accordion type="multiple" defaultValue={allIds} className="space-y-1.5">
        {items.map(({ segment: seg, translatedText, hasLiteral }) => {
          const config = SEGMENT_CONFIG[seg.segment_type] ?? SEGMENT_CONFIG.narrator;
          const Icon = config.icon;
          const fullText = seg.phrases.map((p) => p.text).join(" ");
          const isSegTranslating = translatingIds.has(seg.segment_id);
          const isSelected = selectedSegmentId === seg.segment_id;

          const handleSelect = () => {
            if (isSelected) {
              onSelectSegment?.(null);
            } else {
              onSelectSegment?.({
                segmentId: seg.segment_id,
                originalText: fullText,
                translatedText,
                segmentType: seg.segment_type,
                speaker: seg.speaker ?? null,
              });
            }
          };

          return (
            <AccordionItem
              key={seg.segment_id}
              value={seg.segment_id}
              className={cn(
                "border rounded-md overflow-hidden cursor-pointer transition-colors",
                isSelected
                  ? "bg-primary/5 border-primary/40 ring-1 ring-primary/20"
                  : "bg-muted/10 hover:border-muted-foreground/30",
              )}
              onClick={handleSelect}
            >
              {/* Segment header */}
              <AccordionTrigger className="px-3 py-1.5 text-xs hover:no-underline gap-2">
                <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] gap-1 py-0 shrink-0", config.color)}
                  >
                    <Icon className="h-3 w-3" />
                    {isRu ? config.label_ru : config.label_en}
                  </Badge>
                  {seg.speaker && (
                    <span className="text-[10px] text-muted-foreground truncate">
                      {seg.speaker}
                    </span>
                  )}
                  {hasLiteral && (
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">
                      {isRu ? "переведён" : "translated"}
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground/50 ml-auto shrink-0">
                    #{seg.segment_number}
                  </span>
                </div>
              </AccordionTrigger>

              <AccordionContent className="px-3 pb-3 pt-0 space-y-2">
                {/* ── Original text (read-only) ── */}
                <div className="space-y-1">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                    {isRu ? "Оригинал" : "Original"}
                  </span>
                  <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap select-text rounded-md bg-muted/30 border border-border/30 p-2">
                    {fullText}
                  </p>
                </div>

                {/* ── Translation ── */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      {isRu ? "Перевод" : "Translation"}
                    </span>
                    {onTranslateSegments && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTranslateSegment(seg);
                        }}
                        disabled={translating || isSegTranslating}
                        className="h-5 text-[10px] px-1.5 gap-1"
                      >
                        {isSegTranslating ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <Wand2 className="h-2.5 w-2.5" />
                        )}
                        {isRu ? "Перевести" : "Translate"}
                      </Button>
                    )}
                  </div>

                  {translatedText ? (
                    <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap select-text rounded-md bg-primary/5 border border-primary/20 p-2">
                      {translatedText}
                    </p>
                  ) : (
                    <div className="text-xs text-muted-foreground italic rounded-md bg-muted/20 border border-dashed border-muted-foreground/20 p-2 min-h-[2.5rem]">
                      {isRu
                        ? "Нажмите «Перевести» для подстрочного перевода"
                        : "Click \"Translate\" for literal translation"}
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
