/**
 * SegmentQualityChart — collapsible vertical bar chart showing per-segment
 * quality scores for one selected axis, with tri-color overlay bars (3R/5R/5R+Alt).
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";
import { type RadarAxis, AXIS_LABELS } from "@/lib/qualityRadar";
import { normalizeRadar } from "@/lib/radarCache";
import { readAllStages, type StageSegmentRadar } from "@/lib/radarStages";
import { LAYER_COLORS, type RadarLayer } from "./QualityRadarChart";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { SelectedSegmentData } from "./BilingualSegmentsView";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, BarChart3 } from "lucide-react";
import {
  Tooltip as UiTooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

const AXES: RadarAxis[] = ["semantic", "sentiment", "rhythm", "phonetic", "cultural"];
const Y_BASE = 0.3; // bars start from 30%

const AXIS_ICONS: Record<RadarAxis, Record<string, string>> = {
  semantic: { ru: "С", en: "S" },
  sentiment: { ru: "Т", en: "T" },
  rhythm: { ru: "Р", en: "R" },
  phonetic: { ru: "Ф", en: "P" },
  cultural: { ru: "К", en: "C" },
};

interface SegmentBar {
  segmentId: string;
  index: number;
  label: string;
  /** Display values (shifted by Y_BASE) */
  "3R": number;
  "5R": number;
  "5R+Alt": number;
  /** Raw 0-1 values for tooltip */
  raw3R: number;
  raw5R: number;
  rawAlt: number;
}

interface Props {
  translationStorage: ProjectStorage | null;
  targetLang: string;
  sceneId: string | null;
  chapterId: string | null;
  segmentIds: string[];
  isRu: boolean;
  selectedSegmentId?: string | null;
  onSelectSegment?: (data: SelectedSegmentData | null) => void;
  /** Tick counter to force data reload */
  reloadTick?: number;
}

/** Layers ordered back-to-front: 3R (primary) rendered last = topmost z-level */
const OVERLAY_ORDER: RadarLayer[] = ["5R+Alt", "5R", "3R"];

export function SegmentQualityChart({
  translationStorage,
  targetLang,
  sceneId,
  chapterId,
  segmentIds,
  isRu,
  selectedSegmentId,
  onSelectSegment,
  reloadTick,
}: Props) {
  const [open, setOpen] = useState(true);
  const [activeAxis, setActiveAxis] = useState<RadarAxis>("semantic");
  const [barData, setBarData] = useState<SegmentBar[]>([]);
  const [highlightedIdx, setHighlightedIdx] = useState<number | null>(null);

  // Sync highlight when segment is selected externally (e.g. from bilingual view)
  useEffect(() => {
    if (!selectedSegmentId) { setHighlightedIdx(null); return; }
    const idx = barData.findIndex((b) => b.segmentId === selectedSegmentId);
    setHighlightedIdx(idx >= 0 ? idx : null);
  }, [selectedSegmentId, barData]);

  // Load radar stage data
  useEffect(() => {
    if (!translationStorage || !sceneId || !chapterId || segmentIds.length === 0) {
      setBarData([]);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const stages = await readAllStages(translationStorage, chapterId, sceneId, targetLang);
        if (cancelled) return;

        const literalMap = new Map<string, StageSegmentRadar>();
        const literaryMap = new Map<string, StageSegmentRadar>();
        const critiqueMap = new Map<string, StageSegmentRadar>();

        stages.literal?.segments.forEach((s) => literalMap.set(s.segmentId, s));
        stages.literary?.segments.forEach((s) => literaryMap.set(s.segmentId, s));
        stages.critique?.segments.forEach((s) => critiqueMap.set(s.segmentId, s));

        const bars: SegmentBar[] = segmentIds.map((id, idx) => {
          const lit = literalMap.get(id);
          const ltr = literaryMap.get(id);
          const crt = critiqueMap.get(id);

          const r3 = lit ? normalizeRadar(lit.radar) : null;
          const r5 = ltr ? normalizeRadar(ltr.radar) : null;
          const r5a = crt ? normalizeRadar(crt.radar) : null;

          const v3 = r3 ? r3[activeAxis] : 0;
          const v5 = r5 ? r5[activeAxis] : 0;
          const vA = r5a ? r5a[activeAxis] : 0;

          return {
            segmentId: id,
            index: idx + 1,
            label: `${idx + 1}`,
            "3R": Math.max(0, v3 - Y_BASE),
            "5R": Math.max(0, v5 - Y_BASE),
            "5R+Alt": Math.max(0, vA - Y_BASE),
            raw3R: v3,
            raw5R: v5,
            rawAlt: vA,
          };
        });

        if (!cancelled) setBarData(bars);
      } catch (err) {
        console.error("[SegmentQualityChart] read error:", err);
        if (!cancelled) setBarData([]);
      }
    })();

    return () => { cancelled = true; };
  }, [translationStorage, sceneId, chapterId, segmentIds, activeAxis, reloadTick]);

  const handleBarClick = useCallback((data: SegmentBar, idx: number) => {
    setHighlightedIdx(idx);
    if (!onSelectSegment) return;
    onSelectSegment({
      segmentId: data.segmentId,
      originalText: "",
      translatedText: "",
      segmentType: "",
      speaker: null,
    });
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-segment-id="${data.segmentId}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [onSelectSegment]);

  // Adaptive bar size: clamp between 4 and 28px based on segment count
  const dynamicBarSize = useMemo(() => {
    const count = barData.length || 1;
    // Assume ~600px usable chart width; 40% gap → 60% for bars
    const size = Math.floor((600 * 0.6) / count);
    return Math.max(4, Math.min(28, size));
  }, [barData.length]);

  const hasData = barData.some((b) => b.raw3R > 0 || b.raw5R > 0 || b.rawAlt > 0);

  if (!sceneId || segmentIds.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t shrink-0">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-3 py-1 hover:bg-muted/50 transition-colors">
        <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {isRu ? "Карта качества арт-перевода" : "Art Translation Quality Map"}
        </span>
        <ChevronDown className={cn(
          "h-3.5 w-3.5 text-muted-foreground ml-auto transition-transform",
          open && "rotate-180"
        )} />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="flex" style={{ height: 200 }}>
          {/* Axis switcher column */}
          <TooltipProvider delayDuration={200}>
            <div className="flex flex-col justify-center gap-0.5 px-1 border-r bg-muted/20 shrink-0">
              {AXES.map((axis) => (
                <UiTooltip key={axis}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setActiveAxis(axis)}
                      className={cn(
                        "w-7 h-7 rounded text-[10px] font-bold transition-colors",
                        activeAxis === axis
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {AXIS_ICONS[axis][isRu ? "ru" : "en"]}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">
                    {AXIS_LABELS[axis][isRu ? "ru" : "en"]}
                  </TooltipContent>
                </UiTooltip>
              ))}
            </div>
          </TooltipProvider>

          {/* Chart area */}
          <div className="flex-1 min-w-0">
            {!hasData ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                {isRu ? "Нет данных оценки" : "No quality data"}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barData}
                  margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
                  barCategoryGap="25%"
                  barGap={-dynamicBarSize}
                >
                  <CartesianGrid
                    horizontal
                    vertical={false}
                    stroke="hsl(var(--muted-foreground) / 0.3)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 1 - Y_BASE]}
                    ticks={[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]}
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${Math.round((v + Y_BASE) * 100)}`}
                    width={28}
                  />
                  <Tooltip
                    content={<CustomTooltip isRu={isRu} activeAxis={activeAxis} />}
                    cursor={{ fill: "hsl(var(--foreground) / 0.06)", stroke: "hsl(var(--foreground) / 0.3)", strokeWidth: 1 }}
                  />
                  {highlightedIdx !== null && barData[highlightedIdx] && (
                    <ReferenceLine
                      x={barData[highlightedIdx].label}
                      stroke="hsl(var(--primary))"
                      strokeWidth={1.5}
                      strokeDasharray="3 2"
                      ifOverflow="extendDomain"
                    />
                  )}

                  {/* Overlay: render longest bars first (behind), short ones on top */}
                  {OVERLAY_ORDER.map((layer) => (
                    <Bar
                      key={layer}
                      dataKey={layer}
                      fill={LAYER_COLORS[layer].fill}
                      fillOpacity={layer === "3R" ? 0.85 : layer === "5R" ? 0.65 : 0.5}
                      stroke="none"
                      radius={[2, 2, 0, 0]}
                      barSize={dynamicBarSize}
                      cursor="pointer"
                      onClick={(_: any, idx: number) => {
                        if (barData[idx]) handleBarClick(barData[idx], idx);
                      }}
                    >
                      {barData.map((_, i) => (
                        <Cell
                          key={i}
                          fillOpacity={highlightedIdx !== null && highlightedIdx !== i
                            ? (layer === "3R" ? 0.4 : layer === "5R" ? 0.3 : 0.2)
                            : undefined}
                        />
                      ))}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Custom Tooltip ──────────────────────────────────────────────

interface TooltipPayload {
  isRu: boolean;
  activeAxis: RadarAxis;
  active?: boolean;
  payload?: any[];
  label?: string;
}

function CustomTooltip({ isRu, activeAxis, active, payload, label }: TooltipPayload) {
  if (!active || !payload?.length) return null;

  const data = payload[0]?.payload as SegmentBar | undefined;
  if (!data) return null;

  const axisLabel = AXIS_LABELS[activeAxis][isRu ? "ru" : "en"];

  const layers: { key: RadarLayer; rawKey: keyof SegmentBar; label: string }[] = [
    { key: "3R", rawKey: "raw3R", label: isRu ? "Первичный" : "Primary" },
    { key: "5R", rawKey: "raw5R", label: isRu ? "Художественный" : "Art Edit" },
    { key: "5R+Alt", rawKey: "rawAlt", label: isRu ? "Критика" : "Critique" },
  ];

  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 shadow-md text-xs space-y-0.5">
      <div className="font-medium text-popover-foreground">
        {isRu ? "Сегмент" : "Segment"} {data.index} · {axisLabel}
      </div>
      {layers.map(({ key, rawKey, label }) => {
        const val = data[rawKey] as number;
        if (!val) return null;
        return (
          <div key={key} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ background: LAYER_COLORS[key].stroke }}
            />
            <span className="text-muted-foreground">{label}</span>
            <span className="ml-auto font-medium tabular-nums" style={{ color: LAYER_COLORS[key].stroke }}>
              {Math.round(val * 100)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
