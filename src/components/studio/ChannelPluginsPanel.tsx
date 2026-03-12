/**
 * ChannelPluginsPanel — Per-clip plugin configuration.
 * Header shows miniature proportional clip strip.
 * Right-click on clip → context menu to toggle individual plugins (EQ/Comp/Limiter).
 * Left-click on clip → selects it for individual parameter editing in the Dynamics panel.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { getAudioEngine } from "@/lib/audioEngine";
import { Radio, Waves } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ContextMenu, ContextMenuContent, ContextMenuTrigger,
  ContextMenuCheckboxItem, ContextMenuSeparator, ContextMenuLabel,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { EqGraph } from "./plugins/EqGraph";
import { KneeGraph } from "./plugins/KneeGraph";
import { LimiterGraph } from "./plugins/LimiterGraph";
import { ParamSlider } from "./plugins/ParamSlider";
import { BypassButton } from "./plugins/BypassButton";
import { Panner3DStage } from "./plugins/Panner3DStage";
import { ConvolverPanel } from "./plugins/ConvolverPanel";
import type { ClipPluginConfig, ClipEqConfig, ClipCompConfig, ClipLimiterConfig, ClipPanner3dConfig, ClipConvolverConfig } from "@/hooks/useClipPluginConfigs";
import { DEFAULT_CLIP_PLUGIN_CONFIG } from "@/hooks/useClipPluginConfigs";

// ─── Types ───────────────────────────────────────────────────

export interface ClipInfo {
  id: string;
  label: string;
  segmentType?: string;
  startSec: number;
  durationSec: number;
}

interface ChannelPluginsPanelProps {
  isRu: boolean;
  clips: ClipInfo[];
  trackLabel?: string;
  trackColor?: string;
  trackId?: string;
  /** Per-clip plugin configs from useClipPluginConfigs */
  clipConfigs: Record<string, ClipPluginConfig>;
  onTogglePlugin: (clipId: string, plugin: "eq" | "comp" | "limiter") => void;
  onUpdateParams: (clipId: string, plugin: "eq" | "comp" | "limiter", params: Partial<ClipEqConfig> | Partial<ClipCompConfig> | Partial<ClipLimiterConfig>) => void;
}

// ─── Main component ─────────────────────────────────────────

export function ChannelPluginsPanel({
  isRu,
  clips,
  trackLabel,
  trackColor,
  trackId,
  clipConfigs,
  onTogglePlugin,
  onUpdateParams,
}: ChannelPluginsPanelProps) {
  // Selected clip ID for individual param editing
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  // Auto-select first clip if selection is stale
  useEffect(() => {
    if (clips.length === 0) { setSelectedClipId(null); return; }
    if (selectedClipId && clips.some(c => c.id === selectedClipId)) return;
    setSelectedClipId(clips[0]?.id ?? null);
  }, [clips, selectedClipId]);

  const selectedConfig = useMemo((): ClipPluginConfig => {
    if (!selectedClipId) return { ...DEFAULT_CLIP_PLUGIN_CONFIG };
    return clipConfigs[selectedClipId] ?? { ...DEFAULT_CLIP_PLUGIN_CONFIG };
  }, [selectedClipId, clipConfigs]);

  const selectedClip = useMemo(() => clips.find(c => c.id === selectedClipId), [clips, selectedClipId]);

  // Total span for proportional clip widths
  const totalSpanSec = useMemo(() => {
    if (clips.length === 0) return 0;
    return Math.max(...clips.map(c => c.startSec + c.durationSec));
  }, [clips]);

  // Count enabled plugins for a clip (for visual indicator)
  const enabledCount = useCallback((clipId: string) => {
    const cfg = clipConfigs[clipId] ?? DEFAULT_CLIP_PLUGIN_CONFIG;
    let count = 0;
    if (cfg.eq.enabled) count++;
    if (cfg.comp.enabled) count++;
    if (cfg.limiter.enabled) count++;
    return count;
  }, [clipConfigs]);

  if (clips.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/50 text-xs font-body">
        {isRu ? "Выберите дорожку для настройки плагинов" : "Select a track to configure plugins"}
      </div>
    );
  }

  const noPluginsEnabled = !selectedConfig.eq.enabled && !selectedConfig.comp.enabled && !selectedConfig.limiter.enabled;

  return (
    <div className="flex flex-col h-full px-3 py-2">
      {/* Header: Miniature proportional clip strip with context menus */}
      <div className="flex flex-col gap-1 shrink-0 pb-2 border-b border-border/30 mb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor ?? "hsl(var(--primary))" }} />
          <span className="text-[10px] font-mono text-foreground/60 uppercase tracking-wider shrink-0">
            {trackLabel ?? "Track"}
          </span>
          {selectedClip && (
            <span className="text-[10px] text-primary font-mono ml-auto">
              ▸ {selectedClip.label}
            </span>
          )}
        </div>

        {totalSpanSec > 0 && (
          <div className="relative w-full" style={{ height: "14px" }}>
            <TooltipProvider delayDuration={200}>
              {clips.map((clip) => {
                const leftPct = (clip.startSec / totalSpanSec) * 100;
                const widthPct = (clip.durationSec / totalSpanSec) * 100;
                const isSelected = clip.id === selectedClipId;
                const count = enabledCount(clip.id);
                const hasAnyPlugin = count > 0;

                return (
                  <ContextMenu key={clip.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <ContextMenuTrigger asChild>
                          <button
                            onClick={() => setSelectedClipId(clip.id)}
                            className={`absolute top-0 h-full rounded-sm cursor-pointer transition-all duration-150 overflow-hidden select-none
                              ${isSelected ? "ring-1 ring-primary ring-offset-1 ring-offset-background" : ""}
                              ${hasAnyPlugin ? "opacity-90 hover:opacity-100" : "opacity-35 hover:opacity-55"}
                            `}
                            style={{
                              left: `${leftPct}%`,
                              width: `${Math.max(widthPct, 0.5)}%`,
                              backgroundColor: trackColor ?? "hsl(var(--primary))",
                              backgroundImage: !hasAnyPlugin
                                ? "repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)"
                                : undefined,
                            }}
                          >
                            {widthPct > 4 && (
                              <span className="text-[7px] text-primary-foreground px-0.5 truncate block leading-[14px] font-body">
                                {clip.label}
                              </span>
                            )}
                            {/* Plugin count badge */}
                            {hasAnyPlugin && widthPct > 2 && (
                              <span className="absolute top-0 right-0 text-[6px] text-primary-foreground/80 bg-black/30 rounded-bl px-0.5 leading-[10px]">
                                {count}
                              </span>
                            )}
                          </button>
                        </ContextMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        <span className="font-mono">{clip.label}</span>
                        <span className="ml-1.5 text-muted-foreground">
                          {count > 0
                            ? `— ${count} ${isRu ? "плагин(ов)" : "plugin(s)"}`
                            : (isRu ? "— нет обработки" : "— no processing")}
                        </span>
                      </TooltipContent>
                    </Tooltip>

                    <ContextMenuContent className="w-48">
                      <ContextMenuLabel className="text-[10px] font-mono uppercase text-muted-foreground">
                        {isRu ? "Плагины клипа" : "Clip Plugins"}
                      </ContextMenuLabel>
                      <ContextMenuSeparator />
                      <ContextMenuCheckboxItem
                        checked={clipConfigs[clip.id]?.eq?.enabled ?? false}
                        onCheckedChange={() => onTogglePlugin(clip.id, "eq")}
                      >
                        <span className="font-mono text-xs">EQ</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">3-Band</span>
                      </ContextMenuCheckboxItem>
                      <ContextMenuCheckboxItem
                        checked={clipConfigs[clip.id]?.comp?.enabled ?? false}
                        onCheckedChange={() => onTogglePlugin(clip.id, "comp")}
                      >
                        <span className="font-mono text-xs">CMP</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">{isRu ? "Компрессор" : "Compressor"}</span>
                      </ContextMenuCheckboxItem>
                      <ContextMenuCheckboxItem
                        checked={clipConfigs[clip.id]?.limiter?.enabled ?? false}
                        onCheckedChange={() => onTogglePlugin(clip.id, "limiter")}
                      >
                        <span className="font-mono text-xs">LIM</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">{isRu ? "Лимитер" : "Limiter"}</span>
                      </ContextMenuCheckboxItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </TooltipProvider>
          </div>
        )}
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

        {/* ═══ Tab 1: Dynamics — per-clip editing ═══ */}
        <TabsContent value="dynamics" className="flex-1 min-h-0 mt-2">
          {!selectedClipId ? (
            <div className="flex items-center justify-center h-full text-muted-foreground/40 text-xs font-body">
              {isRu ? "Выберите клип для настройки" : "Select a clip to configure"}
            </div>
          ) : (
            <div className={`flex gap-4 h-full divide-x divide-border/40 ${noPluginsEnabled ? "opacity-40 pointer-events-none" : ""}`}>
              {/* ── EQ Column ── */}
              <div style={{ flex: "3 1 0%" }} className="min-w-0 flex flex-col gap-2">
                <div className="flex items-center justify-between shrink-0">
                  <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
                    {isRu ? "3-полосный EQ" : "3-Band EQ"}
                  </span>
                  <BypassButton
                    label="EQ"
                    bypassed={!selectedConfig.eq.enabled}
                    onToggle={() => onTogglePlugin(selectedClipId, "eq")}
                  />
                </div>
                <div className="flex gap-2 flex-1 min-h-0">
                  <div className="flex-1 min-w-0 min-h-0">
                    <EqGraph low={selectedConfig.eq.low} mid={selectedConfig.eq.mid} high={selectedConfig.eq.high} className="h-full" />
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0 justify-center" style={{ width: 100 }}>
                    <ParamSlider label="Low" value={selectedConfig.eq.low} min={-12} max={12} step={0.5} unit=" dB"
                      onChange={v => onUpdateParams(selectedClipId, "eq", { low: v })} disabled={!selectedConfig.eq.enabled} />
                    <ParamSlider label="Mid" value={selectedConfig.eq.mid} min={-12} max={12} step={0.5} unit=" dB"
                      onChange={v => onUpdateParams(selectedClipId, "eq", { mid: v })} disabled={!selectedConfig.eq.enabled} />
                    <ParamSlider label="High" value={selectedConfig.eq.high} min={-12} max={12} step={0.5} unit=" dB"
                      onChange={v => onUpdateParams(selectedClipId, "eq", { high: v })} disabled={!selectedConfig.eq.enabled} />
                  </div>
                </div>
              </div>

              {/* ── Compressor Column ── */}
              <div style={{ flex: "1 1 0%" }} className="min-w-0 flex flex-col gap-2 pl-4">
                <div className="flex items-center justify-between shrink-0">
                  <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
                    {isRu ? "Компрессор" : "Compressor"}
                  </span>
                  <BypassButton
                    label="CMP"
                    bypassed={!selectedConfig.comp.enabled}
                    onToggle={() => onTogglePlugin(selectedClipId, "comp")}
                  />
                </div>
                <div className="flex gap-2 flex-1 min-h-0">
                  <div className="flex-1 min-w-0 min-h-0">
                    <KneeGraph threshold={selectedConfig.comp.threshold} ratio={selectedConfig.comp.ratio} knee={selectedConfig.comp.knee} className="h-full" />
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0 justify-center" style={{ width: 100 }}>
                    <ParamSlider label={isRu ? "Порог" : "Threshold"} value={selectedConfig.comp.threshold} min={-60} max={0} step={1} unit=" dB"
                      onChange={v => onUpdateParams(selectedClipId, "comp", { threshold: v })} disabled={!selectedConfig.comp.enabled} />
                    <ParamSlider label={isRu ? "Соотн." : "Ratio"} value={selectedConfig.comp.ratio} min={1} max={20} step={0.5} unit=":1"
                      onChange={v => onUpdateParams(selectedClipId, "comp", { ratio: v })} disabled={!selectedConfig.comp.enabled} />
                    <ParamSlider label="Knee" value={selectedConfig.comp.knee} min={0} max={30} step={1} unit=" dB"
                      onChange={v => onUpdateParams(selectedClipId, "comp", { knee: v })} disabled={!selectedConfig.comp.enabled} />
                    <ParamSlider label={isRu ? "Атака" : "Attack"} value={selectedConfig.comp.attack} min={0.001} max={0.5} step={0.001} unit=" s"
                      onChange={v => onUpdateParams(selectedClipId, "comp", { attack: v })} disabled={!selectedConfig.comp.enabled} />
                    <ParamSlider label={isRu ? "Восст." : "Release"} value={selectedConfig.comp.release} min={0.01} max={1.0} step={0.01} unit=" s"
                      onChange={v => onUpdateParams(selectedClipId, "comp", { release: v })} disabled={!selectedConfig.comp.enabled} />
                  </div>
                </div>
              </div>

              {/* ── Limiter Column (POST) ── */}
              <div style={{ flex: "1 1 0%" }} className="min-w-0 flex flex-col gap-2 pl-4">
                <div className="flex items-center justify-between shrink-0">
                  <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
                    {isRu ? "Лимитер" : "Limiter"}
                  </span>
                  <BypassButton
                    label="LIM"
                    bypassed={!selectedConfig.limiter.enabled}
                    onToggle={() => onTogglePlugin(selectedClipId, "limiter")}
                  />
                </div>
                <div className="flex gap-2 flex-1 min-h-0">
                  <div className="flex-1 min-w-0 min-h-0">
                    <LimiterGraph threshold={selectedConfig.limiter.threshold} className="h-full" />
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0 justify-center" style={{ width: 100 }}>
                    <ParamSlider label={isRu ? "Порог" : "Threshold"} value={selectedConfig.limiter.threshold} min={-30} max={0} step={0.5} unit=" dB"
                      onChange={v => onUpdateParams(selectedClipId, "limiter", { threshold: v })} disabled={!selectedConfig.limiter.enabled} />
                  </div>
                </div>
              </div>
            </div>
          )}
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
