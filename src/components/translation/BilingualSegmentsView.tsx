import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SEGMENT_CONFIG } from "@/components/studio/storyboard/constants";
import type { Segment } from "@/components/studio/storyboard/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";
import { Loader2, ChevronDown } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface Props {
  storage: ProjectStorage | null;
  sceneId: string | null;
  chapterId: string | null;
  isRu: boolean;
}

interface StoryboardData {
  segments?: Segment[];
}

/**
 * Bilingual view: each segment is an accordion item.
 * Inside each segment: original text (read-only) + translation placeholder below.
 * This is the atomic unit of translation — segment type, speaker, mood are all per-segment.
 */
export function BilingualSegmentsView({ storage, sceneId, chapterId, isRu }: Props) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!storage || !sceneId || !chapterId) {
      setSegments([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const data = await storage.readJSON<StoryboardData>(
          paths.storyboard(sceneId, chapterId),
        );
        if (!cancelled) {
          setSegments(data?.segments ?? []);
        }
      } catch (err) {
        console.error("[BilingualSegmentsView] read error:", err);
        if (!cancelled) setSegments([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [storage, sceneId, chapterId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-xs">{isRu ? "Загрузка…" : "Loading…"}</span>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic py-3 text-center">
        {isRu ? "Раскадровка не найдена" : "No storyboard found"}
      </p>
    );
  }

  // All segments open by default
  const allIds = segments.map((s) => s.segment_id);

  return (
    <Accordion type="multiple" defaultValue={allIds} className="space-y-1.5">
      {segments.map((seg) => {
        const config = SEGMENT_CONFIG[seg.segment_type] ?? SEGMENT_CONFIG.narrator;
        const Icon = config.icon;
        const fullText = seg.phrases.map((p) => p.text).join(" ");

        return (
          <AccordionItem
            key={seg.segment_id}
            value={seg.segment_id}
            className="border rounded-md bg-muted/10 overflow-hidden"
          >
            {/* Segment header: type badge + speaker */}
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

              {/* ── Translation (editable placeholder) ── */}
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  {isRu ? "Перевод" : "Translation"}
                </span>
                <div className="text-xs text-muted-foreground italic rounded-md bg-muted/20 border border-dashed border-muted-foreground/20 p-2 min-h-[2.5rem]">
                  {isRu
                    ? "Перевод сегмента появится здесь после запуска пайплайна"
                    : "Segment translation will appear here after pipeline run"}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
