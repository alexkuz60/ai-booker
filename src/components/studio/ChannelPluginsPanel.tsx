/**
 * ChannelPluginsPanel — Two-tab layout:
 * Tab 1 "Dynamics": EQ + Compressor + Limiter (PRE → POST)
 * Tab 2 "Spatial": placeholder for Stereo Width, Stage Placement, Convolution Reverb
 *
 * Supports per-clip plugin enable/disable via header clip chips.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { getAudioEngine } from "@/lib/audioEngine";
import { Radio, Waves } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EqGraph } from "./plugins/EqGraph";
import { KneeGraph } from "./plugins/KneeGraph";
import { LimiterGraph } from "./plugins/LimiterGraph";
import { ParamSlider } from "./plugins/ParamSlider";
import { BypassButton } from "./plugins/BypassButton";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

// ─── Types ───────────────────────────────────────────────────

export interface ClipInfo {
  id: string;
  label: string;         // e.g. segment type or short name
  segmentType?: string;  // narrator, dialogue, etc.
  startSec: number;
  durationSec: number;
}

interface ChannelPluginsPanelProps {
  isRu: boolean;
  clips: ClipInfo[];
  trackLabel?: string;
  trackColor?: string;
  /** Set of clip IDs that have plugins enabled (not bypassed). Managed externally for persistence. */
  enabledClipIds: Set<string>;
  onToggleClip: (clipId: string) => void;
  onMixChange?: () => void;
}

// ─── Main component ─────────────────────────────────────────

export function ChannelPluginsPanel({
  isRu,
  clips,
  trackLabel,
  trackColor,
  enabledClipIds,
  onToggleClip,
  onMixChange,
}: ChannelPluginsPanelProps) {
  const engine = getAudioEngine();

  // The "primary" clip we read state from (first enabled clip, or first clip overall)
  const primaryClipId = useMemo(() => {
    const firstEnabled = clips.find(c => enabledClipIds.has(c.id));
    return firstEnabled?.id ?? clips[0]?.id ?? null;
  }, [clips, enabledClipIds]);

  const enabledIds = useMemo(
    () => clips.filter(c => enabledClipIds.has(c.id)).map(c => c.id),
    [clips, enabledClipIds],
  );

  // ── State ──
  const [eqLow, setEqLow] = useState(0);
  const [eqMid, setEqMid] = useState(0);
  const [eqHigh, setEqHigh] = useState(0);

  const [compThreshold, setCompThreshold] = useState(-24);
  const [compRatio, setCompRatio] = useState(3);
  const [compKnee, setCompKnee] = useState(10);
  const [compAttack, setCompAttack] = useState(0.01);
  const [compRelease, setCompRelease] = useState(0.1);

  const [limThreshold, setLimThreshold] = useState(-3);

  const [bypasses, setBypasses] = useState({ eq: true, comp: true, limiter: true });

  // ── Sync state from primary clip ──
  useEffect(() => {
    if (!primaryClipId) return;
    const sync = () => {
      const ms = engine.getTrackMixState(primaryClipId);
      if (!ms) return;
      setEqLow(ms.eq.low); setEqMid(ms.eq.mid); setEqHigh(ms.eq.high);
      setCompThreshold(ms.comp.threshold); setCompRatio(ms.comp.ratio);
      setCompKnee(ms.comp.knee); setCompAttack(ms.comp.attack); setCompRelease(ms.comp.release);
      setLimThreshold(ms.limiter.threshold);
      setBypasses({ eq: ms.eq.bypassed, comp: ms.comp.bypassed, limiter: ms.limiter.bypassed });
    };
    sync();
    const iv = setInterval(sync, 500);
    return () => clearInterval(iv);
  }, [primaryClipId, engine]);

  // ── Apply param to all enabled clips ──
  const applyToEnabled = useCallback((fn: (id: string) => void) => {
    for (const id of enabledIds) fn(id);
    onMixChange?.();
  }, [enabledIds, onMixChange]);

  const toggleBypass = useCallback((section: "eq" | "comp" | "limiter") => {
    if (enabledIds.length === 0) return;
    setBypasses(prev => {
      const next = !prev[section];
      for (const id of enabledIds) {
        switch (section) {
          case "eq": engine.setTrackEqBypassed(id, next); break;
          case "comp": engine.setTrackPreFxBypassed(id, next); break;
          case "limiter": engine.setTrackLimiterBypassed(id, next); break;
        }
      }
      onMixChange?.();
      return { ...prev, [section]: next };
    });
  }, [enabledIds, engine, onMixChange]);

  if (clips.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/50 text-xs font-body">
        {isRu ? "Выберите дорожку для настройки плагинов" : "Select a track to configure plugins"}
      </div>
    );
  }

  const noEnabled = enabledIds.length === 0;

  return (
    <div className="flex flex-col h-full px-3 py-2">
      {/* Header: Clip chips */}
      <div className="flex items-center gap-1.5 shrink-0 pb-2 border-b border-border/30 mb-2 flex-wrap">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor ?? "hsl(var(--primary))" }} />
        <span className="text-[10px] font-mono text-foreground/60 uppercase tracking-wider mr-1 shrink-0">
          {trackLabel ?? "Track"}
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          <TooltipProvider delayDuration={200}>
            {clips.map((clip, idx) => {
              const enabled = enabledClipIds.has(clip.id);
              return (
                <Tooltip key={clip.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onToggleClip(clip.id)}
                      className={`
                        h-5 px-1.5 rounded text-[9px] font-mono uppercase tracking-wider
                        border transition-all duration-150 cursor-pointer select-none
                        ${enabled
                          ? "border-primary/60 bg-primary/15 text-primary"
                          : "border-border/40 bg-muted/30 text-muted-foreground/40 line-through"
                        }
                      `}
                      title={clip.label}
                    >
                      {idx + 1}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    <span className="font-mono">{clip.label}</span>
                    <span className="ml-1.5 text-muted-foreground">
                      {enabled ? (isRu ? "— обработка вкл" : "— processing on") : (isRu ? "— обработка выкл" : "— processing off")}
                    </span>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </TooltipProvider>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="dynamics" className="flex flex-col flex-1 min-h-0">
        <TabsList className="h-7 p-0.5 bg-muted/50 shrink-0 w-fit">
          <TabsTrigger value="dynamics" className="text-[10px] h-6 px-2 gap-1 font-mono uppercase data-[state=active]:bg-background">
            <Radio className="h-3 w-3" />
            {isRu ? "Динамика" : "Dynamics"}
          </TabsTrigger>
          <TabsTrigger value="spatial" className="text-[10px] h-6 px-2 gap-1 font-mono uppercase data-[state=active]:bg-background">
            <Waves className="h-3 w-3" />
            {isRu ? "Пространство" : "Spatial"}
          </TabsTrigger>
        </TabsList>

        {/* ═══ Tab 1: Dynamics ═══ */}
        <TabsContent value="dynamics" className="flex-1 min-h-0 mt-2">
          <div className={`flex gap-4 h-full divide-x divide-border/40 ${noEnabled ? "opacity-40 pointer-events-none" : ""}`}>
            {/* ── EQ Column ── */}
            <div style={{ flex: "3 1 0%" }} className="min-w-0 flex flex-col gap-2">
              <div className="flex items-center justify-between shrink-0">
                <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
                  {isRu ? "3-полосный EQ" : "3-Band EQ"}
                </span>
                <BypassButton label="EQ" bypassed={bypasses.eq} onToggle={() => toggleBypass("eq")} />
              </div>
              <div className="flex gap-2 flex-1 min-h-0">
                <div className="flex-1 min-w-0 min-h-0">
                  <EqGraph low={eqLow} mid={eqMid} high={eqHigh} className="h-full" />
                </div>
                <div className="flex flex-col gap-1.5 shrink-0 justify-center" style={{ width: 100 }}>
                  <ParamSlider label="Low" value={eqLow} min={-12} max={12} step={0.5} unit=" dB"
                    onChange={v => { setEqLow(v); applyToEnabled(id => engine.setTrackEqLow(id, v)); }} disabled={bypasses.eq} />
                  <ParamSlider label="Mid" value={eqMid} min={-12} max={12} step={0.5} unit=" dB"
                    onChange={v => { setEqMid(v); applyToEnabled(id => engine.setTrackEqMid(id, v)); }} disabled={bypasses.eq} />
                  <ParamSlider label="High" value={eqHigh} min={-12} max={12} step={0.5} unit=" dB"
                    onChange={v => { setEqHigh(v); applyToEnabled(id => engine.setTrackEqHigh(id, v)); }} disabled={bypasses.eq} />
                </div>
              </div>
            </div>

            {/* ── Compressor Column ── */}
            <div style={{ flex: "1 1 0%" }} className="min-w-0 flex flex-col gap-2 pl-4">
              <div className="flex items-center justify-between shrink-0">
                <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
                  {isRu ? "Компрессор" : "Compressor"}
                </span>
                <BypassButton label="CMP" bypassed={bypasses.comp} onToggle={() => toggleBypass("comp")} />
              </div>
              <div className="flex gap-2 flex-1 min-h-0">
                <div className="flex-1 min-w-0 min-h-0">
                  <KneeGraph threshold={compThreshold} ratio={compRatio} knee={compKnee} className="h-full" />
                </div>
                <div className="flex flex-col gap-1.5 shrink-0 justify-center" style={{ width: 100 }}>
                  <ParamSlider label={isRu ? "Порог" : "Threshold"} value={compThreshold} min={-60} max={0} step={1} unit=" dB"
                    onChange={v => { setCompThreshold(v); applyToEnabled(id => engine.setTrackCompThreshold(id, v)); }} disabled={bypasses.comp} />
                  <ParamSlider label={isRu ? "Соотн." : "Ratio"} value={compRatio} min={1} max={20} step={0.5} unit=":1"
                    onChange={v => { setCompRatio(v); applyToEnabled(id => engine.setTrackCompRatio(id, v)); }} disabled={bypasses.comp} />
                  <ParamSlider label="Knee" value={compKnee} min={0} max={30} step={1} unit=" dB"
                    onChange={v => { setCompKnee(v); applyToEnabled(id => engine.setTrackCompKnee(id, v)); }} disabled={bypasses.comp} />
                  <ParamSlider label={isRu ? "Атака" : "Attack"} value={compAttack} min={0.001} max={0.5} step={0.001} unit=" s"
                    onChange={v => { setCompAttack(v); applyToEnabled(id => engine.setTrackCompAttack(id, v)); }} disabled={bypasses.comp} />
                  <ParamSlider label={isRu ? "Восст." : "Release"} value={compRelease} min={0.01} max={1.0} step={0.01} unit=" s"
                    onChange={v => { setCompRelease(v); applyToEnabled(id => engine.setTrackCompRelease(id, v)); }} disabled={bypasses.comp} />
                </div>
              </div>
            </div>

            {/* ── Limiter Column (POST) ── */}
            <div style={{ flex: "1 1 0%" }} className="min-w-0 flex flex-col gap-2 pl-4">
              <div className="flex items-center justify-between shrink-0">
                <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
                  {isRu ? "Лимитер" : "Limiter"}
                </span>
                <BypassButton label="LIM" bypassed={bypasses.limiter} onToggle={() => toggleBypass("limiter")} />
              </div>
              <div className="flex gap-2 flex-1 min-h-0">
                <div className="flex-1 min-w-0 min-h-0">
                  <LimiterGraph threshold={limThreshold} className="h-full" />
                </div>
                <div className="flex flex-col gap-1.5 shrink-0 justify-center" style={{ width: 100 }}>
                  <ParamSlider label={isRu ? "Порог" : "Threshold"} value={limThreshold} min={-30} max={0} step={0.5} unit=" dB"
                    onChange={v => { setLimThreshold(v); applyToEnabled(id => engine.setTrackLimiterThreshold(id, v)); }} disabled={bypasses.limiter} />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ═══ Tab 2: Spatial ═══ */}
        <TabsContent value="spatial" className="flex-1 min-h-0 overflow-auto mt-2">
          <div className="flex gap-6 h-full text-muted-foreground/40 text-[10px] font-mono uppercase">
            <div className="flex-1 flex flex-col items-center justify-center gap-2 border border-dashed border-border/30 rounded">
              <Waves className="h-5 w-5" />
              <span>{isRu ? "Стерео расширение" : "Stereo Width"}</span>
              <span className="text-[8px]">{isRu ? "Скоро" : "Coming soon"}</span>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center gap-2 border border-dashed border-border/30 rounded">
              <Waves className="h-5 w-5" />
              <span>{isRu ? "Сцена" : "Stage Placement"}</span>
              <span className="text-[8px]">{isRu ? "Скоро" : "Coming soon"}</span>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center gap-2 border border-dashed border-border/30 rounded">
              <Waves className="h-5 w-5" />
              <span>{isRu ? "Свёрточный ревербератор" : "Convolution Reverb"}</span>
              <span className="text-[8px]">{isRu ? "Скоро" : "Coming soon"}</span>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
