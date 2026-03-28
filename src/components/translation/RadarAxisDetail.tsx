import React from "react";
import {
  type RadarAxis,
  type RadarScores,
  AXIS_LABELS,
  SCORE_COLORS,
  getScoreLevel,
} from "@/lib/qualityRadar";
import type { TranslationSegmentResult } from "@/lib/translationPipeline";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface RadarAxisDetailProps {
  axis: RadarAxis;
  segments: TranslationSegmentResult[];
  onBack: () => void;
  isRu: boolean;
}

export function RadarAxisDetail({ axis, segments, onBack, isRu }: RadarAxisDetailProps) {
  const label = AXIS_LABELS[axis][isRu ? "ru" : "en"];

  // Sort segments by this axis score ascending (worst first)
  const sorted = [...segments]
    .filter((s) => s.radar)
    .sort((a, b) => (a.radar[axis] ?? 0) - (b.radar[axis] ?? 0));

  const avg =
    sorted.length > 0
      ? sorted.reduce((sum, s) => sum + (s.radar[axis] ?? 0), 0) / sorted.length
      : 0;
  const avgLevel = getScoreLevel(avg);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs font-semibold">{label}</span>
        <span
          className="ml-auto text-xs font-mono font-bold"
          style={{ color: SCORE_COLORS[avgLevel] }}
        >
          {(avg * 100).toFixed(0)}%
        </span>
      </div>

      {/* Segments list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1.5">
          {sorted.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              {isRu ? "Нет данных" : "No data"}
            </p>
          )}
          {sorted.map((seg) => {
            const val = seg.radar[axis] ?? 0;
            const level = getScoreLevel(val);
            const trend =
              seg.radarHistory.length > 1
                ? val - (seg.radarHistory[seg.radarHistory.length - 2]?.[axis] ?? val)
                : 0;

            return (
              <div
                key={seg.segmentId}
                className="rounded-lg border p-2.5 space-y-1.5 bg-card/50"
              >
                {/* Score + trend */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {seg.segmentId.slice(0, 8)}
                  </span>
                  <div className="flex items-center gap-1">
                    {trend !== 0 && (
                      <span className={cn("flex items-center text-[10px]", trend > 0 ? "text-emerald-400" : "text-destructive")}>
                        {trend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {(Math.abs(trend) * 100).toFixed(0)}
                      </span>
                    )}
                    <span
                      className="text-xs font-mono font-bold"
                      style={{ color: SCORE_COLORS[level] }}
                    >
                      {(val * 100).toFixed(0)}
                    </span>
                  </div>
                </div>

                {/* Score bar */}
                <div className="h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${val * 100}%`,
                      backgroundColor: SCORE_COLORS[level],
                    }}
                  />
                </div>

                {/* Original + translation preview */}
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="text-muted-foreground line-clamp-2">{seg.original}</div>
                  <div className="line-clamp-2">{seg.literary || seg.literal}</div>
                </div>

                {/* Critique notes */}
                {seg.critiqueNotes.length > 0 && (
                  <div className="text-[10px] text-muted-foreground italic border-t pt-1 mt-1">
                    {seg.critiqueNotes[seg.critiqueNotes.length - 1]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
