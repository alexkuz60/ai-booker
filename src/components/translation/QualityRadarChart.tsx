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

interface QualityRadarChartProps {
  scores: RadarScores | null;
  weights?: RadarWeights;
  onWeightsChange?: (preset: string, weights: RadarWeights) => void;
  onAxisClick?: (axis: RadarAxis) => void;
  isRu: boolean;
  compact?: boolean;
}

const AXES: RadarAxis[] = ["semantic", "sentiment", "rhythm", "phonetic", "cultural"];

export function QualityRadarChart({
  scores,
  weights = DEFAULT_WEIGHTS,
  onWeightsChange,
  onAxisClick,
  isRu,
  compact = false,
}: QualityRadarChartProps) {
  const [activePreset, setActivePreset] = useState("prose");

  const chartData = useMemo(() => {
    if (!scores) return AXES.map((a) => ({ axis: a, label: AXIS_LABELS[a][isRu ? "ru" : "en"], value: 0, fullMark: 1 }));
    return AXES.map((a) => ({
      axis: a,
      label: AXIS_LABELS[a][isRu ? "ru" : "en"],
      value: scores[a],
      fullMark: 1,
    }));
  }, [scores, isRu]);

  const weighted = scores ? computeWeightedScore(scores, weights) : 0;
  const level: ScoreLevel = getScoreLevel(weighted);

  const handlePreset = (key: string) => {
    setActivePreset(key);
    const w = RADAR_PRESETS[key];
    if (w && onWeightsChange) onWeightsChange(key, w);
  };

  return (
    <div className={cn("flex flex-col items-center gap-3", compact ? "gap-2" : "gap-4")}>
      {/* Weighted score badge */}
      <div className="flex items-center gap-2">
        <span
          className="text-2xl font-bold tabular-nums"
          style={{ color: SCORE_COLORS[level] }}
        >
          {scores ? (weighted * 100).toFixed(0) : "—"}
        </span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>

      {/* Radar chart */}
      <div className={cn("w-full", compact ? "h-[180px]" : "h-[240px]")}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="75%">
            <PolarGrid stroke="hsl(var(--border))" />
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
            <Radar
              name="Score"
              dataKey="value"
              stroke={SCORE_COLORS[level]}
              fill={SCORE_COLORS[level]}
              fillOpacity={0.2}
              strokeWidth={2}
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
