import React, { useState, useEffect, useCallback } from "react";
import { Radar as RadarIcon, Activity, BarChart3 } from "lucide-react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { RadarAxis, RadarScores, RadarWeights } from "@/lib/qualityRadar";
import { DEFAULT_WEIGHTS, computeWeightedScore } from "@/lib/qualityRadar";
import type { TranslationSceneResult, TranslationSegmentResult } from "@/lib/translationPipeline";
import { QualityRadarChart } from "./QualityRadarChart";
import { RadarAxisDetail } from "./RadarAxisDetail";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface QualityMonitorPanelProps {
  storage: ProjectStorage | null;
  sceneId: string | null;
  chapterId: string | null;
  isRu: boolean;
}

/**
 * Reads radar.json from translation project OPFS to display quality scores.
 * radar.json is saved by translationPipeline after each run.
 */
export function QualityMonitorPanel({
  storage,
  sceneId,
  chapterId,
  isRu,
}: QualityMonitorPanelProps) {
  const [sceneResult, setSceneResult] = useState<TranslationSceneResult | null>(null);
  const [weights, setWeights] = useState<RadarWeights>(DEFAULT_WEIGHTS);
  const [selectedAxis, setSelectedAxis] = useState<RadarAxis | null>(null);
  const [loading, setLoading] = useState(false);

  // Load radar.json for the selected scene
  useEffect(() => {
    if (!storage || !sceneId || !chapterId) {
      setSceneResult(null);
      setSelectedAxis(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        // Try reading from the translation project's scene folder
        const radarPath = `chapters/${chapterId}/scenes/${sceneId}/radar.json`;
        const data = await storage.readJSON<TranslationSceneResult>(radarPath);
        if (!cancelled) setSceneResult(data ?? null);
      } catch {
        if (!cancelled) setSceneResult(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [storage, sceneId, chapterId]);

  // Compute aggregate radar from segments
  const aggregateScores: RadarScores | null = React.useMemo(() => {
    if (!sceneResult?.segments?.length) return null;
    const segs = sceneResult.segments.filter((s) => s.radar);
    if (segs.length === 0) return null;

    const avg = (axis: keyof Omit<RadarScores, "weighted">) =>
      segs.reduce((sum, s) => sum + (s.radar[axis] ?? 0), 0) / segs.length;

    const scores = {
      semantic: avg("semantic"),
      sentiment: avg("sentiment"),
      rhythm: avg("rhythm"),
      phonetic: avg("phonetic"),
      cultural: avg("cultural"),
      weighted: 0,
    };
    scores.weighted = computeWeightedScore(scores, weights);
    return scores;
  }, [sceneResult, weights]);

  const handleWeightsChange = useCallback((_preset: string, w: RadarWeights) => {
    setWeights(w);
  }, []);

  // Axis detail view
  if (selectedAxis && sceneResult) {
    return (
      <RadarAxisDetail
        axis={selectedAxis}
        segments={sceneResult.segments}
        onBack={() => setSelectedAxis(null)}
        isRu={isRu}
      />
    );
  }

  // Empty state — no scene selected
  if (!sceneId) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground p-6">
        <RadarIcon className="h-10 w-10 opacity-20" />
        <p className="text-xs text-center">
          {isRu
            ? "Выберите сцену для мониторинга качества"
            : "Select a scene to monitor quality"}
        </p>
      </div>
    );
  }

  // Empty state — no radar data yet
  if (!sceneResult && !loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground p-6">
        <Activity className="h-8 w-8 opacity-20" />
        <p className="text-xs text-center">
          {isRu
            ? "Запустите перевод сцены для получения оценки качества"
            : "Run scene translation to get quality scores"}
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Scene aggregate radar */}
        <QualityRadarChart
          scores={aggregateScores}
          weights={weights}
          onWeightsChange={handleWeightsChange}
          onAxisClick={setSelectedAxis}
          isRu={isRu}
        />

        {/* Segment breakdown */}
        {sceneResult && sceneResult.segments.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 px-1">
              <BarChart3 className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                {isRu ? "По сегментам" : "By segment"}
              </span>
              <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-auto">
                {sceneResult.segments.length}
              </Badge>
            </div>
            <div className="space-y-1">
              {sceneResult.segments.map((seg) => {
                const w = seg.radar?.weighted ?? 0;
                const level = w >= 0.85 ? "green" : w >= 0.70 ? "yellow" : "red";
                const color = level === "green" ? "hsl(142, 71%, 45%)" : level === "yellow" ? "hsl(48, 96%, 53%)" : "hsl(0, 84%, 60%)";
                return (
                  <div
                    key={seg.segmentId}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 transition-colors"
                  >
                    <div
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-[10px] text-muted-foreground truncate flex-1">
                      {seg.original.slice(0, 50)}
                      {seg.original.length > 50 ? "…" : ""}
                    </span>
                    <span
                      className="text-[10px] font-mono font-bold shrink-0"
                      style={{ color }}
                    >
                      {(w * 100).toFixed(0)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Iteration info */}
        {sceneResult && sceneResult.segments.some((s) => s.iterations > 1) && (
          <div className="text-[10px] text-muted-foreground text-center border-t pt-2">
            {isRu ? "Итерации редактирования:" : "Edit iterations:"}{" "}
            {Math.max(...sceneResult.segments.map((s) => s.iterations))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
