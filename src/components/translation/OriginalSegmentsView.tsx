import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SEGMENT_CONFIG } from "@/components/studio/storyboard/constants";
import type { Segment } from "@/components/studio/storyboard/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";
import { Loader2 } from "lucide-react";

interface Props {
  storage: ProjectStorage | null;
  sceneId: string | null;
  chapterId: string | null;
  isRu: boolean;
}

interface StoryboardData {
  segments?: Segment[];
}

export function OriginalSegmentsView({ storage, sceneId, chapterId, isRu }: Props) {
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
        console.error("[OriginalSegmentsView] read error:", err);
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

  return (
    <div className="space-y-2">
      {segments.map((seg) => {
        const config = SEGMENT_CONFIG[seg.segment_type] ?? SEGMENT_CONFIG.narrator;
        const Icon = config.icon;
        const fullText = seg.phrases.map((p) => p.text).join(" ");

        return (
          <div
            key={seg.segment_id}
            className="rounded-md border border-border/50 bg-muted/20 p-2.5 space-y-1"
          >
            {/* Header: type badge + speaker */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className={cn("text-[10px] gap-1 py-0", config.color)}
              >
                <Icon className="h-3 w-3" />
                {isRu ? config.label_ru : config.label_en}
              </Badge>
              {seg.speaker && (
                <span className="text-[10px] text-muted-foreground">
                  — {seg.speaker}
                </span>
              )}
            </div>

            {/* Text content */}
            <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap select-text">
              {fullText}
            </p>
          </div>
        );
      })}
    </div>
  );
}