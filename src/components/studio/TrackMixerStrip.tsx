/**
 * TrackMixerStrip — compact horizontal mixer strip for timeline sidebar.
 * Column layout: [Color dot + Name] | [PreFX] [Vol slider] [Pan slider] [Reverb]
 *
 * FX/RV buttons reflect aggregate clip plugin state:
 * - ON  = all non-overridden clips have plugins enabled
 * - OFF = all non-overridden clips have plugins disabled
 * - MIXED = some clips differ or have individual overrides
 */

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { getAudioEngine, type TrackMeterData, type TrackMixState } from "@/lib/audioEngine";
import { VuSlider } from "./VuSlider";
import type { TrackPluginState } from "@/hooks/useClipPluginConfigs";

interface TrackMixerStripProps {
  trackId: string;
  allClipIds?: string[];
  fallbackEngineId?: string;
  label: string;
  color: string;
  expanded: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  onMixChange?: () => void;
  trackHeight?: number;
  /** Aggregate FX state from clip plugin configs */
  fxState?: TrackPluginState;
  /** Aggregate RV state from clip plugin configs */
  rvState?: TrackPluginState;
  /** Toggle FX for all non-overridden clips on this track */
  onToggleFx?: () => void;
  /** Toggle RV for all non-overridden clips on this track */
  onToggleRv?: () => void;
}

/** Threshold in dB above which we consider signal "active" */
const SIGNAL_THRESHOLD_DB = -50;

export const TrackMixerStrip = memo(function TrackMixerStrip({
  trackId,
  allClipIds = [],
  fallbackEngineId,
  label,
  color,
  expanded,
  isSelected,
  onClick,
  onMixChange,
  trackHeight,
  fxState = "off",
  rvState = "off",
  onToggleFx,
  onToggleRv,
}: TrackMixerStripProps) {
  const engine = getAudioEngine();

  const [mix, setMix] = useState<TrackMixState | null>(null);
  const [meter, setMeter] = useState<TrackMeterData | null>(null);

  // IDs in engine that should receive mix changes for this logical track
  const effectiveIds = useMemo(() => {
    if (allClipIds.length > 0) return allClipIds;
    if (fallbackEngineId) return [fallbackEngineId];
    return [trackId];
  }, [allClipIds, fallbackEngineId, trackId]);

  const pollState = useCallback(() => {
    let bestMix: TrackMixState | null = null;
    let bestLevel = -Infinity;
    let bestMeter: TrackMeterData | null = null;
    for (const id of effectiveIds) {
      const m = engine.getTrackMixState(id);
      if (m && !bestMix) bestMix = m;
      const mt = engine.getTrackMeter(id);
      if (mt && mt.level > bestLevel) {
        bestLevel = mt.level;
        bestMeter = mt;
      }
    }
    setMix(bestMix);
    setMeter(bestMeter);
  }, [engine, effectiveIds]);

  // Collapsed: minimal view — with FX/RV toggles for atmo/sfx tracks (only when they have clips)
  const isAtmoOrSfx = trackId === "ambience" || trackId.startsWith("atmosphere") || trackId === "sfx" || trackId.startsWith("sfx-");
  const hasAudioClips = allClipIds.length > 0;

  // Poll meter + mix state at ~30fps when expanded, or 10fps for collapsed tracks with clips
  useEffect(() => {
    const shouldPoll = expanded || (isAtmoOrSfx && hasAudioClips);
    if (!shouldPoll) return;
    pollState(); // initial poll
    let running = true;
    const rate = expanded ? 33 : 100;
    const interval = setInterval(() => { if (running) pollState(); }, rate);
    return () => { running = false; clearInterval(interval); };
  }, [expanded, isAtmoOrSfx, hasAudioClips, pollState]);

  const handleVolumeChange = useCallback((v: number) => {
    for (const id of effectiveIds) engine.setTrackVolume(id, v);
    pollState();
    onMixChange?.();
  }, [engine, effectiveIds, onMixChange, pollState]);

  const handlePanChange = useCallback((p: number) => {
    for (const id of effectiveIds) engine.setTrackPan(id, p / 100);
    pollState();
    onMixChange?.();
  }, [engine, effectiveIds, onMixChange, pollState]);

  // Signal activity flag
  const hasSignal = (meter?.level ?? -60) > SIGNAL_THRESHOLD_DB;

  // Glow intensity based on signal level (0..1)
  const glowIntensity = useMemo(() => {
    const level = meter?.level ?? -60;
    if (level <= SIGNAL_THRESHOLD_DB) return 0;
    return Math.min(1, Math.max(0, (level - SIGNAL_THRESHOLD_DB) / (SIGNAL_THRESHOLD_DB * -0.88)));
  }, [meter?.level]);

  /** CSS class for FX button based on aggregate state */
  const fxClassName = fxState === "on"
    ? "border-accent text-accent bg-accent/15"
    : fxState === "mixed"
      ? "border-accent/50 text-accent/60 bg-accent/8"
      : "border-border text-muted-foreground/40 bg-transparent";

  /** CSS class for RV button based on aggregate state */
  const rvClassName = rvState === "on"
    ? "border-primary text-primary bg-primary/15"
    : rvState === "mixed"
      ? "border-primary/50 text-primary/60 bg-primary/8"
      : "border-border text-muted-foreground/40 bg-transparent";

  const fxGlow = fxState !== "off" && hasSignal;
  const rvGlow = rvState !== "off" && hasSignal;

  if (!expanded) {
    const hStyle = trackHeight ? { height: `${trackHeight}px` } : {};
    return (
      <div
        className={`flex items-center px-3 border-b border-border/50 cursor-pointer transition-colors ${
          isSelected ? "bg-accent/20" : "hover:bg-muted/30"
        }`}
        style={hStyle}
        onClick={onClick}
      >
        <div className="w-2.5 h-2.5 rounded-full shrink-0 mr-2" style={{ backgroundColor: color }} />
        <span className={`text-xs font-body truncate flex-1 ${isSelected ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
          {label}
        </span>
        {(isAtmoOrSfx ? hasAudioClips : true) && (
          <div className="flex items-center gap-1 ml-1 shrink-0">
            <button
              className={`text-[8px] px-1 py-0.5 rounded border font-mono uppercase leading-none transition-colors font-semibold ${fxClassName}`}
              style={fxGlow ? {
                boxShadow: `0 0 ${4 + glowIntensity * 6}px hsl(var(--accent) / ${0.3 + glowIntensity * 0.4})`,
              } : undefined}
              onClick={(e) => { e.stopPropagation(); onToggleFx?.(); }}
              title="Pre-FX"
            >
              FX
            </button>
            <button
              className={`text-[8px] px-1 py-0.5 rounded border font-mono uppercase leading-none transition-colors font-semibold ${rvClassName}`}
              style={rvGlow ? {
                boxShadow: `0 0 ${4 + glowIntensity * 6}px hsl(var(--primary) / ${0.3 + glowIntensity * 0.4})`,
              } : undefined}
              onClick={(e) => { e.stopPropagation(); onToggleRv?.(); }}
              title="Reverb"
            >
              RV
            </button>
          </div>
        )}
      </div>
    );
  }

  // Expanded: full mixer strip with column layout
  const meterLevel = meter?.level ?? -60;
  const meterLR: [number, number] = [meter?.levelL ?? -60, meter?.levelR ?? -60];

  const hStyleExp = trackHeight ? { height: `${trackHeight}px` } : {};
  return (
    <div
      className={`flex items-center gap-2 px-2 border-b border-border/50 cursor-pointer transition-colors ${
        isSelected ? "bg-accent/20" : "hover:bg-muted/30"
      }`}
      style={hStyleExp}
      onClick={onClick}
    >
      {/* Column 1: Color dot + name — fixed width */}
      <div className="flex items-center gap-2 w-[100px] shrink-0">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className={`text-xs font-body truncate ${isSelected ? "text-foreground font-semibold" : "text-foreground/80"}`}>
          {label}
        </span>
      </div>

      {/* Column 2: Controls — flex fill */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {/* Pre-FX badge */}
        <button
          className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 font-mono uppercase leading-none transition-colors font-semibold ${fxClassName}`}
          style={fxGlow ? {
            boxShadow: `0 0 ${4 + glowIntensity * 8}px hsl(var(--accent) / ${0.35 + glowIntensity * 0.45})`,
          } : undefined}
          onClick={(e) => { e.stopPropagation(); onToggleFx?.(); }}
          title="Pre-FX"
        >
          FX
        </button>

        {/* Volume slider with VU */}
        <div className="flex-1 min-w-[60px]" onClick={(e) => e.stopPropagation()}>
          <VuSlider
            mode="volume"
            value={mix?.volume ?? 80}
            meterDb={meterLevel}
            onChange={handleVolumeChange}
          />
        </div>

        {/* Pan slider with L/R VU */}
        <div className="w-[70px] shrink-0" onClick={(e) => e.stopPropagation()}>
          <VuSlider
            mode="pan"
            value={Math.round((mix?.pan ?? 0) * 100)}
            meterDb={meterLR}
            onChange={handlePanChange}
          />
        </div>

        {/* Reverb badge */}
        <button
          className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 font-mono uppercase leading-none transition-colors font-semibold ${rvClassName}`}
          style={rvGlow ? {
            boxShadow: `0 0 ${4 + glowIntensity * 8}px hsl(var(--primary) / ${0.35 + glowIntensity * 0.45})`,
          } : undefined}
          onClick={(e) => { e.stopPropagation(); onToggleRv?.(); }}
          title="Reverb"
        >
          RV
        </button>
      </div>
    </div>
  );
});
