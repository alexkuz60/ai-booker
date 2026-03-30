import React, { useMemo } from "react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  type RadarScores,
  type RadarWeights,
  type RadarAxis,
  AXIS_LABELS,
  getScoreLevel,
  SCORE_COLORS,
} from "@/lib/qualityRadar";
import { cn } from "@/lib/utils";
import { ThreeAxisRadarOverlay } from "./ThreeAxisRadarOverlay";

export type RadarLayer = "3R" | "5R" | "5R+Alt";

interface QualityRadarChartProps {
  scores: RadarScores | null;
  /** Additional layer scores for overlay */
  layers?: {
    "3R"?: RadarScores | null;
    "5R"?: RadarScores | null;
    "5R+Alt"?: RadarScores | null;
  };
  /** Which layers are visible */
  visibleLayers?: RadarLayer[];
  weights: RadarWeights;
  onAxisClick?: (axis: RadarAxis) => void;
  isRu: boolean;
  compact?: boolean;
}

const AXES: RadarAxis[] = ["semantic", "sentiment", "rhythm", "phonetic", "cultural"];

export const LAYER_COLORS: Record<RadarLayer, { stroke: string; fill: string }> = {
  "3R": { stroke: "hsl(210, 80%, 60%)", fill: "hsl(210, 80%, 60%)" },
  "5R": { stroke: "hsl(35, 90%, 55%)", fill: "hsl(35, 90%, 55%)" },
  "5R+Alt": { stroke: "hsl(160, 70%, 45%)", fill: "hsl(160, 70%, 45%)" },
};

function hasAnyAxis(scores: RadarScores | null | undefined) {
  if (!scores) return false;
  return AXES.some((axis) => scores[axis] > 0);
}

export function QualityRadarChart({
  scores,
  layers,
  visibleLayers = [],
  weights,
  onAxisClick,
  isRu,
  compact = false,
}: QualityRadarChartProps) {

  const layer3R = layers?.["3R"] ?? null;
  const layer5R = layers?.["5R"] ?? null;
  const layerAlt = layers?.["5R+Alt"] ?? null;

  // Build chart data from the "primary" scores (latest stage)
  const chartData = useMemo(() => {
    if (!scores) {
      return AXES.map((a) => ({
        axis: a,
        label: AXIS_LABELS[a][isRu ? "ru" : "en"],
        value: 0,
        layer3R: 0,
        layer5R: 0,
        layerAlt: 0,
        fullMark: 1,
      }));
    }
    return AXES.map((a) => ({
      axis: a,
      label: AXIS_LABELS[a][isRu ? "ru" : "en"],
      value: scores[a],
      layer3R: layer3R?.[a] ?? 0,
      layer5R: layer5R?.[a] ?? 0,
      layerAlt: layerAlt?.[a] ?? 0,
      fullMark: 1,
    }));
  }, [scores, layer3R, layer5R, layerAlt, isRu]);


  const show5R = visibleLayers.includes("5R") && hasAnyAxis(layer5R);
  const showAlt = visibleLayers.includes("5R+Alt") && hasAnyAxis(layerAlt);

  return (
    <div className={cn("flex flex-col items-center gap-3", compact ? "gap-2" : "gap-4")}>

      {/* Radar chart */}
      <div className={cn("relative w-full", compact ? "h-[180px]" : "h-[480px]")}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="85%">
            <PolarGrid stroke="hsl(var(--muted-foreground) / 0.15)" />
            <PolarAngleAxis
              dataKey="label"
              tick={({ x, y, payload }) => {
                const axis = chartData.find((d) => d.label === payload.value)?.axis;
                const score = scores?.[axis as RadarAxis] ?? 0;
                const lvl = getScoreLevel(score);
                return (
                  <text
                    x={x}
                    y={y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="cursor-pointer"
                    fill={scores ? SCORE_COLORS[lvl] : "hsl(var(--muted-foreground))"}
                    fontSize={compact ? 9 : 11}
                    fontWeight={500}
                    onClick={() => axis && onAxisClick?.(axis as RadarAxis)}
                  >
                    {payload.value}
                  </text>
                );
              }}
            />
            <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />

            {/* Layer: 5R (overlay) */}
            {show5R && (
              <Radar
                key="layer-5r"
                name="5R"
                dataKey="layer5R"
                stroke={LAYER_COLORS["5R"].stroke}
                fill={LAYER_COLORS["5R"].fill}
                fillOpacity={0.15}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            )}

            {/* Layer: 5R+Alt */}
            {showAlt && (
              <Radar
                key="layer-5r-alt"
                name="5R+Alt"
                dataKey="layerAlt"
                stroke={LAYER_COLORS["5R+Alt"].stroke}
                fill={LAYER_COLORS["5R+Alt"].fill}
                fillOpacity={0.1}
                strokeWidth={1.5}
                strokeDasharray="2 2"
                isAnimationActive={false}
              />
            )}

            <Tooltip
              content={({ payload }) => {
                if (!payload?.length) return null;
                const item = payload[0]?.payload;
                if (!item) return null;
                const rows: { label: string; value: number; color: string }[] = [];
                if (item.layer3R > 0) {
                  const lvl3 = getScoreLevel(item.layer3R);
                  rows.push({ label: "3R", value: item.layer3R, color: LAYER_COLORS["3R"].stroke });
                }
                if (item.layer5R > 0) {
                  const lvl5 = getScoreLevel(item.layer5R);
                  rows.push({ label: "5R", value: item.layer5R, color: LAYER_COLORS["5R"].stroke });
                }
                if (item.layerAlt > 0) {
                  rows.push({ label: "5R+Alt", value: item.layerAlt, color: LAYER_COLORS["5R+Alt"].stroke });
                }
                // fallback to primary value if no layers have data
                if (rows.length === 0 && item.value > 0) {
                  const lvl = getScoreLevel(item.value);
                  rows.push({ label: "", value: item.value, color: SCORE_COLORS[lvl] });
                }
                if (rows.length === 0) return null;
                return (
                  <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-lg space-y-0.5">
                    <span className="font-medium">{item.label}</span>
                    {rows.map((r) => (
                      <div key={r.label} className="flex items-center justify-between gap-3">
                        {r.label && (
                          <span className="text-muted-foreground text-[10px]">{r.label}</span>
                        )}
                        <span className="font-mono font-bold" style={{ color: r.color }}>
                          {(r.value * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
        <ThreeAxisRadarOverlay scores={layer3R} />
      </div>


      {/* Axis score bars — 3 layers per axis */}
      {!compact && scores && (
        <div className="w-full space-y-2 px-2">
          {AXES.map((axis) => {
            const layers: { key: RadarLayer; value: number }[] = [
              { key: "3R", value: layer3R?.[axis] ?? 0 },
              { key: "5R", value: layer5R?.[axis] ?? 0 },
              { key: "5R+Alt", value: layerAlt?.[axis] ?? 0 },
            ].filter((l) => l.value > 0);

            // fallback to primary if no layers
            if (layers.length === 0 && scores[axis] > 0) {
              layers.push({ key: "5R", value: scores[axis] });
            }

            return (
              <button
                key={axis}
                onClick={() => onAxisClick?.(axis)}
                className="w-full flex items-center gap-2 group text-left hover:bg-muted/50 rounded px-1.5 py-0.5 transition-colors"
              >
                <span className="text-[10px] text-muted-foreground w-20 truncate">
                  {AXIS_LABELS[axis][isRu ? "ru" : "en"]}
                </span>
                <div className="flex-1 flex flex-col gap-0.5">
                  {layers.map(({ key, value }) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${value * 100}%`,
                            backgroundColor: LAYER_COLORS[key].stroke,
                          }}
                        />
                      </div>
                      <span
                        className="text-[9px] font-mono font-medium w-7 text-right shrink-0"
                        style={{ color: LAYER_COLORS[key].stroke }}
                      >
                        {(value * 100).toFixed(0)}
                      </span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
