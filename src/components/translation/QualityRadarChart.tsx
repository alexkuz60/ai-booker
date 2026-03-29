import React, { useMemo, useState } from "react";
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
  type ScoreLevel,
  RADAR_PRESETS,
  PRESET_LABELS,
  AXIS_LABELS,
  DEFAULT_WEIGHTS,
  getScoreLevel,
  SCORE_COLORS,
  computeWeightedScore,
} from "@/lib/qualityRadar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
  weights?: RadarWeights;
  onWeightsChange?: (preset: string, weights: RadarWeights) => void;
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

/**
 * Custom Radar shape that skips axes with value=0,
 * drawing a polygon only through non-zero points.
 */
function SkipZeroRadarShape({ points, dataKey, stroke, fill, fillOpacity, strokeWidth, strokeDasharray }: any) {
  if (!points?.length) return null;
  // Filter to only points whose corresponding data value > 0
  const nonZero = points.filter((_: any, i: number) => {
    // points correspond to AXES order
    return true; // keep all for coordinate lookup
  });
  // Build polygon from non-zero values only
  const validPoints = points.filter((_: any, i: number) => {
    // Access the raw value from the point — recharts stores it in payload
    const val = _?.payload?.[dataKey];
    return val != null && val > 0;
  });
  if (validPoints.length < 2) return null;
  const d = validPoints.map((p: any, i: number) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
  return (
    <g>
      <path d={d} fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={strokeDasharray} />
    </g>
  );
}

export function QualityRadarChart({
  scores,
  layers,
  visibleLayers = [],
  weights = DEFAULT_WEIGHTS,
  onWeightsChange,
  onAxisClick,
  isRu,
  compact = false,
}: QualityRadarChartProps) {
  const [activePreset, setActivePreset] = useState("prose");

  // Build chart data from the "primary" scores (latest stage)
  const chartData = useMemo(() => {
    if (!scores) {
      return AXES.map((a) => ({
        axis: a,
        label: AXIS_LABELS[a][isRu ? "ru" : "en"],
        value: 0,
        primaryValue: 0,
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
      primaryValue: layers?.["3R"]?.[a] ?? scores[a],
      layer3R: layers?.["3R"]?.[a] ?? 0,
      layer5R: layers?.["5R"]?.[a] ?? 0,
      layerAlt: layers?.["5R+Alt"]?.[a] ?? 0,
      fullMark: 1,
    }));
  }, [scores, layers, isRu]);

  const handlePreset = (key: string) => {
    setActivePreset(key);
    const w = RADAR_PRESETS[key];
    if (w && onWeightsChange) onWeightsChange(key, w);
  };

  const primaryScores = layers?.["3R"] ?? scores;
  const primaryWeighted = primaryScores ? computeWeightedScore(primaryScores, weights) : 0;
  const primaryLevel: ScoreLevel = getScoreLevel(primaryWeighted);
  const show5R = visibleLayers.includes("5R") && !!layers?.["5R"];
  const showAlt = visibleLayers.includes("5R+Alt") && !!layers?.["5R+Alt"];

  return (
    <div className={cn("flex flex-col items-center gap-3", compact ? "gap-2" : "gap-4")}>

      {/* Radar chart */}
      <div className={cn("w-full", compact ? "h-[180px]" : "h-[480px]")}>
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

            {/* Layer: 5R (middle) */}
            {show5R && (
              <Radar
                name="5R"
                dataKey="layer5R"
                stroke={LAYER_COLORS["5R"].stroke}
                fill={LAYER_COLORS["5R"].fill}
                fillOpacity={0.15}
                strokeWidth={1.5}
                shape={<SkipZeroRadarShape dataKey="layer5R" stroke={LAYER_COLORS["5R"].stroke} fill={LAYER_COLORS["5R"].fill} fillOpacity={0.15} strokeWidth={1.5} />}
              />
            )}

            {/* Layer: 5R+Alt */}
            {showAlt && (
              <Radar
                name="5R+Alt"
                dataKey="layerAlt"
                stroke={LAYER_COLORS["5R+Alt"].stroke}
                fill={LAYER_COLORS["5R+Alt"].fill}
                fillOpacity={0.1}
                strokeWidth={1.5}
                strokeDasharray="2 2"
                shape={<SkipZeroRadarShape dataKey="layerAlt" stroke={LAYER_COLORS["5R+Alt"].stroke} fill={LAYER_COLORS["5R+Alt"].fill} fillOpacity={0.1} strokeWidth={1.5} strokeDasharray="2 2" />}
              />
            )}

            {/* Primary layer: always 3R when available, otherwise current score */}
            <Radar
              name="Score"
              dataKey="primaryValue"
              stroke={LAYER_COLORS["3R"].stroke}
              fill={LAYER_COLORS["3R"].fill}
              fillOpacity={0.12}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              shape={<SkipZeroRadarShape dataKey="primaryValue" stroke={LAYER_COLORS["3R"].stroke} fill={LAYER_COLORS["3R"].fill} fillOpacity={0.12} strokeWidth={1.5} strokeDasharray="4 3" />}
            />

            <Tooltip
              content={({ payload }) => {
                if (!payload?.length) return null;
                const item = payload[0]?.payload;
                if (!item) return null;
                const val = (item.value * 100).toFixed(0);
                const lvl = getScoreLevel(item.value);
                return (
                  <div className="rounded-lg border bg-background px-3 py-1.5 text-xs shadow-lg">
                    <span className="font-medium">{item.label}</span>
                    <span className="ml-2 font-mono font-bold" style={{ color: SCORE_COLORS[lvl] }}>
                      {val}%
                    </span>
                  </div>
                );
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Preset selector */}
      {onWeightsChange && (
        <div className="flex items-center gap-1.5">
          {Object.keys(RADAR_PRESETS).map((key) => (
            <Badge
              key={key}
              variant={activePreset === key ? "default" : "outline"}
              className="cursor-pointer text-[10px] px-2 py-0"
              onClick={() => handlePreset(key)}
            >
              {PRESET_LABELS[key]?.[isRu ? "ru" : "en"] ?? key}
            </Badge>
          ))}
        </div>
      )}

      {/* Axis score bars */}
      {!compact && scores && (
        <div className="w-full space-y-1.5 px-2">
          {AXES.map((axis) => {
            const val = scores[axis];
            const lvl = getScoreLevel(val);
            return (
              <button
                key={axis}
                onClick={() => onAxisClick?.(axis)}
                className="w-full flex items-center gap-2 group text-left hover:bg-muted/50 rounded px-1.5 py-0.5 transition-colors"
              >
                <span className="text-[10px] text-muted-foreground w-20 truncate">
                  {AXIS_LABELS[axis][isRu ? "ru" : "en"]}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${val * 100}%`,
                      backgroundColor: SCORE_COLORS[lvl],
                    }}
                  />
                </div>
                <span
                  className="text-[10px] font-mono font-medium w-8 text-right"
                  style={{ color: SCORE_COLORS[lvl] }}
                >
                  {(val * 100).toFixed(0)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
