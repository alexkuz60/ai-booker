import { useEffect, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Segment } from "@/components/studio/storyboard/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { LocalStoryboardData } from "@/lib/storyboardSync";
import { paths } from "@/lib/projectPaths";
import { Loader2, Languages } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion } from "@/components/ui/accordion";
import { type RadarStage, readAllStages, getSegmentStage } from "@/lib/radarStages";
import { BilingualSegmentRow } from "./BilingualSegmentRow";

export interface SelectedSegmentData {
  segmentId: string;
  originalText: string;
  translatedText: string;
  segmentType: string;
  speaker: string | null;
}

/** Imperative API exposed via ref for granular updates */
export interface BilingualSegmentsHandle {
  /** Update a single segment's translation text + stage without full reload */
  patchSegment: (segmentId: string, translatedText: string, stage?: RadarStage | null) => void;
  /** Force full reload from OPFS (for bulk operations) */
  reload: () => void;
}

interface Props {
  sourceStorage: ProjectStorage | null;
  translationStorage: ProjectStorage | null;
  sceneId: string | null;
  chapterId: string | null;
  isRu: boolean;
  onTranslateSegments?: (segments: Segment[]) => Promise<void>;
  onLiteraryEdit?: (segment: Segment) => Promise<void>;
  onCritique?: (segment: Segment) => Promise<void>;
  onSegmentsLoaded?: (segmentIds: string[]) => void;
  translating?: boolean;
  progressLabel?: string | null;
  selectedSegmentId?: string | null;
  onSelectSegment?: (data: SelectedSegmentData | null) => void;
}

interface SegmentWithTranslation {
  segment: Segment;
  translatedText: string;
  hasLiteral: boolean;
}

export const BilingualSegmentsView = forwardRef<BilingualSegmentsHandle, Props>(function BilingualSegmentsView({
  sourceStorage,
  translationStorage,
  sceneId,
  chapterId,
  isRu,
  onTranslateSegments,
  onLiteraryEdit,
  onCritique,
  onSegmentsLoaded,
  translating = false,
  progressLabel,
  selectedSegmentId,
  onSelectSegment,
}, ref) {
  const [items, setItems] = useState<SegmentWithTranslation[]>([]);
  const [loading, setLoading] = useState(false);
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  const [segmentStages, setSegmentStages] = useState<Map<string, RadarStage | null>>(new Map());
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const [critiquingIds, setCritiquingIds] = useState<Set<string>>(new Set());

  // ── Full load from OPFS ─────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!sourceStorage || !sceneId || !chapterId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const sourceData = await sourceStorage.readJSON<LocalStoryboardData>(
        paths.storyboard(sceneId, chapterId),
      );
      const segments = sourceData?.segments ?? [];

      let translationSegments: Segment[] = [];
      if (translationStorage) {
        const transData = await translationStorage.readJSON<LocalStoryboardData>(
          `chapters/${chapterId}/scenes/${sceneId}/storyboard.json`,
        );
        translationSegments = transData?.segments ?? [];
      }

      const transMap = new Map<string, { text: string; hasLiteral: boolean }>();
      for (const tseg of translationSegments) {
        const literaryText = (tseg as any)._literary;
        const literalText = (tseg as any)._literal;
        const phrasesText = tseg.phrases.map(p => p.text).filter(Boolean).join(" ");
        const text = literaryText || literalText || phrasesText;
        const hasLiteral = !!literalText;
        transMap.set(tseg.segment_id, { text, hasLiteral });
      }

      const mapped = segments.map(seg => {
        const trans = transMap.get(seg.segment_id);
        return {
          segment: seg,
          translatedText: trans?.text ?? "",
          hasLiteral: trans?.hasLiteral ?? false,
        };
      });
      setItems(mapped);
      onSegmentsLoaded?.(segments.map(s => s.segment_id));
    } catch (err) {
      console.error("[BilingualSegmentsView] read error:", err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [sourceStorage, translationStorage, sceneId, chapterId, onSegmentsLoaded]);

  // Load on scene change
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Imperative handle for granular updates ──────────────
  useImperativeHandle(ref, () => ({
    patchSegment(segmentId: string, translatedText: string, stage?: RadarStage | null) {
      setItems(prev => prev.map(item =>
        item.segment.segment_id === segmentId
          ? { ...item, translatedText, hasLiteral: true }
          : item,
      ));
      if (stage !== undefined) {
        setSegmentStages(prev => {
          const next = new Map(prev);
          next.set(segmentId, stage);
          return next;
        });
      }
    },
    reload: loadAll,
  }), [loadAll]);

  // Track segment IDs separately to avoid re-reading stages when items
  // change due to patchSegment (which already sets stages directly).
  const segmentIdList = useMemo(
    () => items.map(i => i.segment.segment_id),
    // Only recalculate when segment count or identity changes (not text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length, items.map(i => i.segment.segment_id).join(",")],
  );

  // Load segment stage info from radar files — only on scene change, NOT on items patch
  useEffect(() => {
    if (!translationStorage || !sceneId || !chapterId || segmentIdList.length === 0) {
      setSegmentStages(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stages = await readAllStages(translationStorage, chapterId, sceneId);
        if (cancelled) return;
        const map = new Map<string, RadarStage | null>();
        for (const id of segmentIdList) {
          map.set(id, getSegmentStage(id, stages));
        }
        setSegmentStages(map);
      } catch {
        if (!cancelled) setSegmentStages(new Map());
      }
    })();
    return () => { cancelled = true; };
  }, [translationStorage, sceneId, chapterId, segmentIdList]);

  const handleTranslateSegment = useCallback(async (seg: Segment) => {
    if (!onTranslateSegments) return;
    setTranslatingIds(prev => new Set(prev).add(seg.segment_id));
    try {
      await onTranslateSegments([seg]);
    } finally {
      setTranslatingIds(prev => { const next = new Set(prev); next.delete(seg.segment_id); return next; });
    }
  }, [onTranslateSegments]);

  const handleLiteraryEdit = useCallback(async (seg: Segment) => {
    if (!onLiteraryEdit) return;
    setEditingIds(prev => new Set(prev).add(seg.segment_id));
    try {
      await onLiteraryEdit(seg);
    } finally {
      setEditingIds(prev => { const next = new Set(prev); next.delete(seg.segment_id); return next; });
    }
  }, [onLiteraryEdit]);

  const handleCritique = useCallback(async (seg: Segment) => {
    if (!onCritique) return;
    setCritiquingIds(prev => new Set(prev).add(seg.segment_id));
    try {
      await onCritique(seg);
    } finally {
      setCritiquingIds(prev => { const next = new Set(prev); next.delete(seg.segment_id); return next; });
    }
  }, [onCritique]);

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

  const openValue = selectedSegmentId ?? "";

  return (
    <div className="space-y-2">
      {onTranslateSegments && (
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onTranslateSegments(items.map(i => i.segment))}
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

      <Accordion type="single" collapsible value={openValue} onValueChange={(val) => {
          if (!val) {
            onSelectSegment?.(null);
          } else {
            const found = items.find(i => i.segment.segment_id === val);
            if (found) {
              const fullText = found.segment.phrases.map(p => p.text).join(" ");
              onSelectSegment?.({
                segmentId: found.segment.segment_id,
                originalText: fullText,
                translatedText: found.translatedText,
                segmentType: found.segment.segment_type,
                speaker: found.segment.speaker ?? null,
              });
            }
          }
        }} className="space-y-1.5">
        {items.map(({ segment: seg, translatedText, hasLiteral }) => {
          const isSelected = selectedSegmentId === seg.segment_id;

          return (
            <BilingualSegmentRow
              key={seg.segment_id}
              segment={seg}
              translatedText={translatedText}
              hasLiteral={hasLiteral}
              currentStage={segmentStages.get(seg.segment_id) ?? null}
              isSelected={isSelected}
              isRu={isRu}
              translating={translating}
              isSegTranslating={translatingIds.has(seg.segment_id)}
              isSegEditing={editingIds.has(seg.segment_id)}
              isSegCritiquing={critiquingIds.has(seg.segment_id)}
              onTranslate={handleTranslateSegment}
              onLiteraryEdit={onLiteraryEdit ? handleLiteraryEdit : undefined}
              onCritique={onCritique ? handleCritique : undefined}
            />
          );
        })}
      </Accordion>
    </div>
  );
});
