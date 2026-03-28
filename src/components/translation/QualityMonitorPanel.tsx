import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Radar as RadarIcon, Activity, BarChart3, MousePointerClick } from "lucide-react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { RadarScores, RadarWeights, RadarAxis } from "@/lib/qualityRadar";
import {
  DEFAULT_WEIGHTS,
  computeWeightedScore,
  computeProgrammaticAxes,
  computeSemanticScore,
  AXIS_LABELS,
  getScoreLevel,
  SCORE_COLORS,
} from "@/lib/qualityRadar";
import type { SelectedSegmentData } from "@/components/translation/BilingualSegmentsView";
import { QualityRadarChart } from "./QualityRadarChart";
import { RadarAxisDetail } from "./RadarAxisDetail";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { SEGMENT_CONFIG } from "@/components/studio/storyboard/constants";
import { cn } from "@/lib/utils";

// Module-level cache: sceneId → { segments: [...] }
// Prevents re-reading OPFS on every remount / navigation return
const radarCache = new Map<string, {
  segments: { segmentId: string; radar: RadarScores; critiqueNotes?: string[] }[];
}>();

// Per-segment fallback cache: "sceneId:segmentId" → computed scores
const computedCache = new Map<string, { scores: RadarScores; notes: string[] }>();

interface QualityMonitorPanelProps {
  storage: ProjectStorage | null;
  sceneId: string | null;
  chapterId: string | null;
  isRu: boolean;
  /** Currently selected segment from bilingual view */
  selectedSegment?: SelectedSegmentData | null;
  sourceLang?: "ru" | "en";
  targetLang?: "ru" | "en";
  userApiKeys?: Record<string, string>;
}

export function QualityMonitorPanel({
  storage,
  sceneId,
  chapterId,
  isRu,
  selectedSegment,
  sourceLang = "ru",
  targetLang = "en",
  userApiKeys = {},
}: QualityMonitorPanelProps) {
  const [weights, setWeights] = useState<RadarWeights>(DEFAULT_WEIGHTS);
  const [selectedAxis, setSelectedAxis] = useState<RadarAxis | null>(null);
  const [segmentScores, setSegmentScores] = useState<RadarScores | null>(null);
  const [computing, setComputing] = useState(false);
  const [critiqueNotes, setCritiqueNotes] = useState<string[]>([]);

  // Try loading saved radar from storage first; fallback to on-the-fly compute
  useEffect(() => {
    if (!selectedSegment?.translatedText || !selectedSegment?.originalText) {
      setSegmentScores(null);
      setCritiqueNotes([]);
      return;
    }

    const segKey = `${sceneId}:${selectedSegment.segmentId}`;

    // 0. Check in-memory computed cache (survives remount)
    const cached = computedCache.get(segKey);
    if (cached) {
      const scores = { ...cached.scores, weighted: computeWeightedScore(cached.scores, weights) };
      setSegmentScores(scores);
      setCritiqueNotes(cached.notes);
      setComputing(false);
      return;
    }

    let cancelled = false;
    setComputing(true);

    (async () => {
      try {
        // 1. Try radar.json cache, then OPFS
        let radarSegments = sceneId ? radarCache.get(sceneId)?.segments : undefined;
        if (!radarSegments && storage && sceneId && chapterId) {
          const radarPath = `chapters/${chapterId}/scenes/${sceneId}/radar.json`;
          const radarData = await storage.readJSON<{
            segments?: {
              segmentId: string;
              radar: RadarScores;
              critiqueNotes?: string[];
            }[];
          }>(radarPath);
          if (radarData?.segments) {
            radarSegments = radarData.segments;
            radarCache.set(sceneId, { segments: radarSegments });
          }
        }

        if (!cancelled && radarSegments) {
          const saved = radarSegments.find(
            (s) => s.segmentId === selectedSegment.segmentId,
          );
          if (saved?.radar && saved.radar.weighted > 0) {
            const scores = { ...saved.radar, weighted: computeWeightedScore(saved.radar, weights) };
            computedCache.set(segKey, { scores: saved.radar, notes: saved.critiqueNotes ?? [] });
            setSegmentScores(scores);
            setCritiqueNotes(saved.critiqueNotes ?? []);
            setComputing(false);
            return;
          }
        }

        if (cancelled) return;

        // 2. Fallback: compute on the fly (programmatic + semantic only)
        const { rhythm, phonetic } = computeProgrammaticAxes(
          selectedSegment.originalText,
          selectedSegment.translatedText,
          sourceLang,
          targetLang,
        );

        const semantic = await computeSemanticScore(
          selectedSegment.originalText,
          selectedSegment.translatedText,
          userApiKeys,
        );

        if (cancelled) return;

        const scores: RadarScores = {
          semantic: semantic ?? 0,
          sentiment: 0,
          rhythm,
          phonetic,
          cultural: 0,
          weighted: 0,
        };
        scores.weighted = computeWeightedScore(scores, weights);
        computedCache.set(segKey, { scores: { ...scores }, notes: [] });
        setSegmentScores(scores);
        setCritiqueNotes([]);
      } catch (err) {
        console.error("[QualityMonitor] compute error:", err);
        if (!cancelled) {
          setSegmentScores(null);
          setCritiqueNotes([]);
        }
      } finally {
        if (!cancelled) setComputing(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedSegment?.segmentId, selectedSegment?.originalText, selectedSegment?.translatedText, storage, sceneId, chapterId, sourceLang, targetLang, userApiKeys]);

  // Recompute weighted when weights change
  const displayScores = useMemo(() => {
    if (!segmentScores) return null;
    return { ...segmentScores, weighted: computeWeightedScore(segmentScores, weights) };
  }, [segmentScores, weights]);

  const handleWeightsChange = useCallback((_preset: string, w: RadarWeights) => {
    setWeights(w);
  }, []);

  // No scene selected
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

  // Scene selected but no segment
  if (!selectedSegment) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground p-6">
        <MousePointerClick className="h-8 w-8 opacity-20" />
        <p className="text-xs text-center">
          {isRu
            ? "Кликните на сегмент для оценки качества перевода"
            : "Click a segment to evaluate translation quality"}
        </p>
      </div>
    );
  }

  // Segment selected but no translation
  if (!selectedSegment.translatedText) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground p-6">
        <Activity className="h-8 w-8 opacity-20" />
        <p className="text-xs text-center">
          {isRu
            ? "Сначала переведите этот сегмент"
            : "Translate this segment first"}
        </p>
      </div>
    );
  }

  const segConfig = SEGMENT_CONFIG[selectedSegment.segmentType as keyof typeof SEGMENT_CONFIG] ?? SEGMENT_CONFIG.narrator;
  const SegIcon = segConfig.icon;

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Segment info header */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn("text-[10px] gap-1 py-0 shrink-0", segConfig.color)}
            >
              <SegIcon className="h-3 w-3" />
              {isRu ? segConfig.label_ru : segConfig.label_en}
            </Badge>
            {selectedSegment.speaker && (
              <span className="text-[10px] text-muted-foreground truncate">
                {selectedSegment.speaker}
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/70 line-clamp-2 leading-relaxed">
            {selectedSegment.originalText.slice(0, 120)}
            {selectedSegment.originalText.length > 120 ? "…" : ""}
          </p>
        </div>

        {/* Radar chart */}
        {computing ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
            <Activity className="h-4 w-4 animate-pulse" />
            <span className="text-xs">{isRu ? "Вычисление…" : "Computing…"}</span>
          </div>
        ) : (
          <QualityRadarChart
            scores={displayScores}
            weights={weights}
            onWeightsChange={handleWeightsChange}
            onAxisClick={setSelectedAxis}
            isRu={isRu}
          />
        )}

        {/* Axis scores breakdown */}
        {displayScores && !computing && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-1">
              {isRu ? "Оси оценки" : "Score axes"}
            </span>
            {(["semantic", "sentiment", "rhythm", "phonetic", "cultural"] as RadarAxis[]).map((axis) => {
              const val = displayScores[axis];
              const level = getScoreLevel(val);
              const color = SCORE_COLORS[level];
              const label = AXIS_LABELS[axis];
              const isActive = val > 0;
              return (
                <div
                  key={axis}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1 rounded transition-colors",
                    isActive ? "hover:bg-muted/50" : "opacity-40",
                  )}
                >
                  <div
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: isActive ? color : "hsl(var(--muted-foreground))" }}
                  />
                  <span className="text-[10px] text-muted-foreground flex-1">
                    {isRu ? label.ru : label.en}
                  </span>
                  <span
                    className="text-[10px] font-mono font-bold shrink-0"
                    style={{ color: isActive ? color : undefined }}
                  >
                    {isActive ? `${(val * 100).toFixed(0)}%` : "—"}
                  </span>
                </div>
              );
            })}
            <p className="text-[9px] text-muted-foreground/50 px-2 pt-1 italic">
              {isRu
                ? "Тональность и культурный код — после критики (следующий этап)"
                : "Sentiment & cultural code — after critique (next phase)"}
            </p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}