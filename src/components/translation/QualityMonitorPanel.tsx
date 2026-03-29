import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Radar as RadarIcon, Activity, MousePointerClick } from "lucide-react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { RadarScores, RadarWeights, RadarAxis } from "@/lib/qualityRadar";
import {
  DEFAULT_WEIGHTS,
  computeWeightedScore,
  computeProgrammaticAxes,
  computeSemanticScore,
} from "@/lib/qualityRadar";
import type { SelectedSegmentData } from "@/components/translation/BilingualSegmentsView";
import { QualityRadarChart, type RadarLayer } from "./QualityRadarChart";
import { RadarAxisDetail } from "./RadarAxisDetail";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  readAllStages,
  LAYER_LABELS,
  type StageRadarFile,
  type CritiqueRadarFile,
} from "@/lib/radarStages";

// Module-level cache: sceneId → { segments: [...] }
const radarCache = new Map<string, {
  segments: { segmentId: string; radar: RadarScores; critiqueNotes?: string[] }[];
}>();

// Per-segment fallback cache: "sceneId:segmentId" → computed scores
const computedCache = new Map<string, { scores: RadarScores; notes: string[] }>();

// Stage files cache: sceneId → stages
const stageCache = new Map<string, {
  literal: StageRadarFile | null;
  literary: StageRadarFile | null;
  critique: CritiqueRadarFile | null;
}>();

/** Invalidate caches for a scene so the monitor re-reads from storage */
export function invalidateRadarCache(sceneId: string, segmentId?: string) {
  stageCache.delete(sceneId);
  radarCache.delete(sceneId);
  if (segmentId) {
    computedCache.delete(`${sceneId}:${segmentId}`);
  } else {
    // Clear all segments for this scene
    for (const key of computedCache.keys()) {
      if (key.startsWith(`${sceneId}:`)) computedCache.delete(key);
    }
  }
}

/** Normalize radar scores: if any axis > 1, assume 0-100 scale and convert to 0-1 */
function normalizeRadar(radar: RadarScores): RadarScores {
  const axes: (keyof RadarScores)[] = ["semantic", "sentiment", "rhythm", "phonetic", "cultural", "weighted"];
  const needsNorm = axes.some(a => radar[a] > 1);
  if (!needsNorm) return radar;
  const norm: RadarScores = { ...radar };
  for (const a of axes) {
    norm[a] = Math.max(0, Math.min(1, radar[a] / 100));
  }
  return norm;
}

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
  /** Called when weighted score changes (0–1 or null) */
  onScoreChange?: (score: number | null) => void;
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
  onScoreChange,
}: QualityMonitorPanelProps) {
  const [weights, setWeights] = useState<RadarWeights>(DEFAULT_WEIGHTS);
  const [selectedAxis, setSelectedAxis] = useState<RadarAxis | null>(null);
  const [segmentScores, setSegmentScores] = useState<RadarScores | null>(null);
  const [computing, setComputing] = useState(false);
  const [critiqueNotes, setCritiqueNotes] = useState<string[]>([]);
  const [visibleLayers, setVisibleLayers] = useState<RadarLayer[]>([]);
  const [layerScores, setLayerScores] = useState<{
    "3R"?: RadarScores | null;
    "5R"?: RadarScores | null;
    "5R+Alt"?: RadarScores | null;
  }>({});
  const [availableLayers, setAvailableLayers] = useState<RadarLayer[]>([]);

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
            const scores = { ...normalizeRadar(saved.radar), weighted: computeWeightedScore(normalizeRadar(saved.radar), weights) };
            computedCache.set(segKey, { scores: normalizeRadar(saved.radar), notes: saved.critiqueNotes ?? [] });
            setSegmentScores(scores);
            setCritiqueNotes(saved.critiqueNotes ?? []);
            setComputing(false);
            return;
          }
        }

        if (cancelled) return;

        // 1b. Try staged radar files (radar-literal / radar-literary / radar-critique)
        if (storage && sceneId && chapterId) {
          const stages = stageCache.get(sceneId) ?? await readAllStages(storage, chapterId, sceneId);
          if (stages) {
            stageCache.set(sceneId, stages);
            // Pick the highest available stage for this segment
            const critSeg = stages.critique?.segments.find(s => s.segmentId === selectedSegment.segmentId);
            const liteSeg = stages.literary?.segments.find(s => s.segmentId === selectedSegment.segmentId);
            const litSeg = stages.literal?.segments.find(s => s.segmentId === selectedSegment.segmentId);
            const bestSeg = critSeg ?? liteSeg ?? litSeg;
            if (bestSeg?.radar) {
              // Check if any axis has data (weighted may be 0 for partial stages)
              const hasData = Object.entries(bestSeg.radar)
                .filter(([k]) => k !== "weighted")
                .some(([, v]) => (v as number) > 0);
              if (hasData) {
                const normRadar = normalizeRadar(bestSeg.radar);
                const notes = bestSeg.critiqueNotes ?? [];
                const scores = { ...normRadar, weighted: computeWeightedScore(normRadar, weights) };
                computedCache.set(segKey, { scores: normRadar, notes });
                setSegmentScores(scores);
                setCritiqueNotes(notes);
                setComputing(false);
                return;
              }
            }
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

  // Load stage radar files for layer overlays
  useEffect(() => {
    if (!storage || !sceneId || !chapterId || !selectedSegment?.segmentId) {
      setLayerScores({});
      setAvailableLayers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let stages = stageCache.get(sceneId);
        if (!stages) {
          stages = await readAllStages(storage, chapterId, sceneId);
          stageCache.set(sceneId, stages);
        }
        if (cancelled) return;

        const segId = selectedSegment.segmentId;
        const newLayers: typeof layerScores = {};
        const available: RadarLayer[] = [];

        const litSeg = stages.literal?.segments.find(s => s.segmentId === segId);
        if (litSeg?.radar) {
          newLayers["3R"] = normalizeRadar(litSeg.radar);
          available.push("3R");
        }

        const liteSeg = stages.literary?.segments.find(s => s.segmentId === segId);
        if (liteSeg?.radar) {
          newLayers["5R"] = normalizeRadar(liteSeg.radar);
          available.push("5R");
        }

        const critSeg = stages.critique?.segments.find(s => s.segmentId === segId);
        if (critSeg?.radar) {
          newLayers["5R+Alt"] = normalizeRadar(critSeg.radar);
          available.push("5R+Alt");
        }

        if (!cancelled) {
          setLayerScores(newLayers);
          setAvailableLayers(available);
        }
      } catch {
        if (!cancelled) {
          setLayerScores({});
          setAvailableLayers([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [storage, sceneId, chapterId, selectedSegment?.segmentId]);

  // Recompute weighted when weights change
  const displayScores = useMemo(() => {
    if (!segmentScores) return null;
    return { ...segmentScores, weighted: computeWeightedScore(segmentScores, weights) };
  }, [segmentScores, weights]);

  // Notify parent about score changes
  useEffect(() => {
    onScoreChange?.(displayScores?.weighted ?? null);
  }, [displayScores?.weighted, onScoreChange]);

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


  return (
    <ScrollArea className="h-full">
      <div className="px-4 pt-1 pb-4 space-y-3">

        {/* Layer toggle — 3R always visible, only 5R/5R+Alt togglable */}
        {availableLayers.filter((l) => l !== "3R").length > 0 && !computing && (
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
              {isRu ? "Слои" : "Layers"}
            </span>
            <ToggleGroup
              type="multiple"
              size="sm"
              value={visibleLayers}
              onValueChange={(val) => setVisibleLayers(val as RadarLayer[])}
              className="gap-0.5"
            >
              {availableLayers.filter((l) => l !== "3R").map((layer) => (
                <ToggleGroupItem
                  key={layer}
                  value={layer}
                  className={cn(
                    "h-5 text-[9px] px-1.5 transition-opacity",
                    visibleLayers.includes(layer)
                      ? "data-[state=on]:bg-primary/20 opacity-100"
                      : "opacity-40"
                  )}
                >
                  {LAYER_LABELS[layer]?.[isRu ? "ru" : "en"] ?? layer}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}

        {/* Radar chart */}
        {computing ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
            <Activity className="h-4 w-4 animate-pulse" />
            <span className="text-xs">{isRu ? "Вычисление…" : "Computing…"}</span>
          </div>
        ) : (
          <QualityRadarChart
            scores={displayScores}
            layers={layerScores}
            visibleLayers={visibleLayers}
            weights={weights}
            onWeightsChange={handleWeightsChange}
            onAxisClick={setSelectedAxis}
            isRu={isRu}
          />
        )}

      </div>
    </ScrollArea>
  );
}