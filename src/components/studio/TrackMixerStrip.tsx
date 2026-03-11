/**
 * TrackMixerStrip — compact horizontal mixer strip for timeline sidebar.
 * Column layout: [Color dot + Name] | [PreFX] [Vol slider] [Pan slider] [Reverb]
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { getAudioEngine, type TrackMeterData, type TrackMixState } from "@/lib/audioEngine";
import { VuSlider } from "./VuSlider";

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
}

/** Threshold in dB above which we consider signal "active" */
const SIGNAL_THRESHOLD_DB = -50;

export function TrackMixerStrip({
  trackId,
  allClipIds = [],
  fallbackEngineId,
  label,
  color,
  expanded,
  isSelected,
  onClick,
  onMixChange,
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

  // Poll meter + mix state at ~30fps when expanded, or 10fps for collapsed atmo/sfx with clips
  useEffect(() => {
    const shouldPoll = expanded || (isAtmoOrSfx && hasAudioClips);
    if (!shouldPoll) return;
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

  const toggleReverbBypass = useCallback(() => {
    // Read current state from any available clip
    const currentMix = effectiveIds.reduce<TrackMixState | null>((acc, id) => acc ?? engine.getTrackMixState(id), null);
    if (!currentMix) return;
    const newVal = !currentMix.reverbBypassed;
    for (const id of effectiveIds) engine.setTrackReverbBypassed(id, newVal);
    pollState();
    onMixChange?.();
  }, [engine, effectiveIds, onMixChange, pollState]);

  const togglePreFxBypass = useCallback(() => {
    const currentMix = effectiveIds.reduce<TrackMixState | null>((acc, id) => acc ?? engine.getTrackMixState(id), null);
    if (!currentMix) return;
    const newVal = !currentMix.preFxBypassed;
    for (const id of effectiveIds) engine.setTrackPreFxBypassed(id, newVal);
    pollState();
    onMixChange?.();
  }, [engine, effectiveIds, onMixChange, pollState]);

  // Signal activity flag
  const hasSignal = (meter?.level ?? -60) > SIGNAL_THRESHOLD_DB;
  const fxActive = !mix?.preFxBypassed && hasSignal;
  const rvActive = !mix?.reverbBypassed && hasSignal;

  // Glow intensity based on signal level (0..1)
  const glowIntensity = useMemo(() => {
    const level = meter?.level ?? -60;
    if (level <= SIGNAL_THRESHOLD_DB) return 0;
    // Map -50..-6 dB → 0..1
    return Math.min(1, Math.max(0, (level - SIGNAL_THRESHOLD_DB) / (SIGNAL_THRESHOLD_DB * -0.88)));
  }, [meter?.level]);

  if (!expanded) {
    return (
      <div
        className={`h-10 flex items-center px-3 border-b border-border/50 cursor-pointer transition-colors ${
          isSelected ? "bg-accent/20" : "hover:bg-muted/30"
        }`}
        onClick={onClick}
      >
        <div className="w-2.5 h-2.5 rounded-full shrink-0 mr-2" style={{ backgroundColor: color }} />
        <span className={`text-xs font-body truncate flex-1 ${isSelected ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
          {label}
        </span>
        {isAtmoOrSfx && hasAudioClips && (
          <div className="flex items-center gap-1 ml-1 shrink-0">
            <button
              className={`text-[8px] px-1 py-0.5 rounded border font-mono uppercase leading-none transition-colors font-semibold ${
                mix?.preFxBypassed
                  ? "border-border text-muted-foreground/40 bg-transparent"
                  : "border-accent text-accent bg-accent/15"
              }`}
              style={fxActive ? {
                boxShadow: `0 0 ${4 + glowIntensity * 6}px hsl(var(--accent) / ${0.3 + glowIntensity * 0.4})`,
              } : undefined}
              onClick={(e) => { e.stopPropagation(); togglePreFxBypass(); }}
              title="Pre-FX"
            >
              FX
            </button>
            <button
              className={`text-[8px] px-1 py-0.5 rounded border font-mono uppercase leading-none transition-colors font-semibold ${
                mix?.reverbBypassed
                  ? "border-border text-muted-foreground/40 bg-transparent"
                  : "border-primary text-primary bg-primary/15"
              }`}
              style={rvActive ? {
                boxShadow: `0 0 ${4 + glowIntensity * 6}px hsl(var(--primary) / ${0.3 + glowIntensity * 0.4})`,
              } : undefined}
              onClick={(e) => { e.stopPropagation(); toggleReverbBypass(); }}
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

  return (
    <div
      className={`flex items-center gap-2 px-2 border-b border-border/50 cursor-pointer transition-colors h-10 ${
        isSelected ? "bg-accent/20" : "hover:bg-muted/30"
      }`}
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
          className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 font-mono uppercase leading-none transition-colors font-semibold ${
            mix?.preFxBypassed
              ? "border-border text-muted-foreground/60 bg-transparent"
              : "border-accent text-accent bg-accent/15"
          }`}
          style={fxActive ? {
            boxShadow: `0 0 ${4 + glowIntensity * 8}px hsl(var(--accent) / ${0.35 + glowIntensity * 0.45})`,
          } : undefined}
          onClick={(e) => { e.stopPropagation(); togglePreFxBypass(); }}
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
          className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 font-mono uppercase leading-none transition-colors font-semibold ${
            mix?.reverbBypassed
              ? "border-border text-muted-foreground/60 bg-transparent"
              : "border-primary text-primary bg-primary/15"
          }`}
          style={rvActive ? {
            boxShadow: `0 0 ${4 + glowIntensity * 8}px hsl(var(--primary) / ${0.35 + glowIntensity * 0.45})`,
          } : undefined}
          onClick={(e) => { e.stopPropagation(); toggleReverbBypass(); }}
          title="Reverb"
        >
          RV
        </button>
      </div>
    </div>
  );
}
