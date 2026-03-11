/**
 * TrackMixerStrip — compact horizontal mixer strip for timeline sidebar.
 * Column layout: [Color dot + Name] | [PreFX] [Vol slider] [Pan slider] [Reverb]
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getAudioEngine, type TrackMeterData, type TrackMixState } from "@/lib/audioEngine";
import { VuSlider } from "./VuSlider";

interface TrackMixerStripProps {
  trackId: string;
  allClipIds?: string[];
  label: string;
  color: string;
  expanded: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  onMixChange?: () => void;
}

export function TrackMixerStrip({
  trackId,
  allClipIds = [],
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

  // Poll meter + mix state at ~30fps when expanded
  useEffect(() => {
    if (!expanded) return;
    let running = true;
    const interval = setInterval(() => {
      if (running) {
        setMeter(engine.getTrackMeter(trackId));
        setMix(engine.getTrackMixState(trackId));
      }
    }, 33);
    return () => {
      running = false;
      clearInterval(interval);
    };
  }, [expanded, trackId, engine]);

  const handleVolumeChange = useCallback((v: number) => {
    engine.setTrackVolume(trackId, v);
    onMixChange?.();
  }, [engine, trackId, onMixChange]);

  const handlePanChange = useCallback((p: number) => {
    engine.setTrackPan(trackId, p / 100);
    onMixChange?.();
  }, [engine, trackId, onMixChange]);

  const toggleReverbBypass = useCallback(() => {
    if (!mix) return;
    engine.setTrackReverbBypassed(trackId, !mix.reverbBypassed);
    onMixChange?.();
  }, [engine, trackId, mix, onMixChange]);

  const togglePreFxBypass = useCallback(() => {
    if (!mix) return;
    engine.setTrackPreFxBypassed(trackId, !mix.preFxBypassed);
    onMixChange?.();
  }, [engine, trackId, mix, onMixChange]);

  // Collapsed: minimal view — with FX/RV toggles for atmo/sfx tracks
  const isAtmoOrSfx = trackId === "ambience" || trackId.startsWith("atmosphere") || trackId === "sfx" || trackId.startsWith("sfx-");

  // Poll mix state even when collapsed for atmo/sfx (lightweight, only for button state)
  useEffect(() => {
    if (expanded || !isAtmoOrSfx) return;
    let running = true;
    const interval = setInterval(() => {
      if (running) setMix(engine.getTrackMixState(trackId));
    }, 200);
    return () => { running = false; clearInterval(interval); };
  }, [expanded, isAtmoOrSfx, trackId, engine]);

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
        {isAtmoOrSfx && (
          <div className="flex items-center gap-1 ml-1 shrink-0">
            <button
              className={`text-[8px] px-1 py-0.5 rounded border font-mono uppercase leading-none transition-colors font-semibold ${
                mix?.preFxBypassed
                  ? "border-border text-muted-foreground/40 bg-transparent"
                  : "border-accent text-accent bg-accent/15"
              }`}
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
          onClick={(e) => { e.stopPropagation(); toggleReverbBypass(); }}
          title="Reverb"
        >
          RV
        </button>
      </div>
    </div>
  );
}
