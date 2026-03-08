/**
 * TrackMixerStrip — compact horizontal mixer strip for timeline sidebar.
 * Shows: [Color dot] [Name] [PreFX badge] [Vol slider] [Pan slider] [Reverb badge]
 *
 * In collapsed sidebar: just name + color dot.
 * In expanded sidebar: full mixer strip.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getAudioEngine, type TrackMeterData, type TrackMixState } from "@/lib/audioEngine";
import { VuSlider } from "./VuSlider";

interface TrackMixerStripProps {
  trackId: string;        // engine track ID (e.g. segment UUID)
  label: string;
  color: string;
  expanded: boolean;
  isSelected?: boolean;
  onClick?: () => void;
}

export function TrackMixerStrip({
  trackId,
  label,
  color,
  expanded,
  isSelected,
  onClick,
}: TrackMixerStripProps) {
  const engine = getAudioEngine();

  const [mix, setMix] = useState<TrackMixState | null>(null);
  const [meter, setMeter] = useState<TrackMeterData | null>(null);
  const rafRef = useRef(0);

  // Poll meter + mix state at ~30fps when expanded
  useEffect(() => {
    if (!expanded) return;
    let running = true;
    const tick = () => {
      if (!running) return;
      setMeter(engine.getTrackMeter(trackId));
      setMix(engine.getTrackMixState(trackId));
      rafRef.current = requestAnimationFrame(tick);
    };
    // Throttle to 30fps
    const interval = setInterval(() => {
      if (running) {
        setMeter(engine.getTrackMeter(trackId));
        setMix(engine.getTrackMixState(trackId));
      }
    }, 33);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      clearInterval(interval);
    };
  }, [expanded, trackId, engine]);

  const handleVolumeChange = useCallback((v: number) => {
    engine.setTrackVolume(trackId, v);
  }, [engine, trackId]);

  const handlePanChange = useCallback((p: number) => {
    engine.setTrackPan(trackId, p / 100); // convert -100..100 to -1..1
  }, [engine, trackId]);

  const toggleReverbBypass = useCallback(() => {
    if (!mix) return;
    engine.setTrackReverbBypassed(trackId, !mix.reverbBypassed);
  }, [engine, trackId, mix]);

  const togglePreFxBypass = useCallback(() => {
    if (!mix) return;
    engine.setTrackPreFxBypassed(trackId, !mix.preFxBypassed);
  }, [engine, trackId, mix]);

  // Collapsed: minimal view
  if (!expanded) {
    return (
      <div
        className={`h-10 flex items-center px-3 border-b border-border/50 cursor-pointer transition-colors ${
          isSelected ? "bg-accent/20" : "hover:bg-muted/30"
        }`}
        onClick={onClick}
      >
        <div className="w-2 h-2 rounded-full shrink-0 mr-2" style={{ backgroundColor: color }} />
        <span className={`text-xs font-body truncate ${isSelected ? "text-foreground font-medium" : "text-muted-foreground"}`}>
          {label}
        </span>
      </div>
    );
  }

  // Expanded: full mixer strip
  const meterLevel = meter?.level ?? -60;
  const meterLR: [number, number] = [meter?.levelL ?? -60, meter?.levelR ?? -60];

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 border-b border-border/50 min-h-[40px] cursor-pointer transition-colors ${
        isSelected ? "bg-accent/20" : "hover:bg-muted/30"
      }`}
      onClick={onClick}
    >
      {/* Color dot + name */}
      <div className="flex items-center gap-1.5 min-w-[60px] max-w-[80px] shrink-0">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className={`text-[10px] font-body truncate ${isSelected ? "text-foreground font-medium" : "text-muted-foreground"}`}>
          {label}
        </span>
      </div>

      {/* Pre-FX badge */}
      <button
        className={`text-[8px] px-1 py-0.5 rounded border shrink-0 font-mono uppercase leading-none transition-colors ${
          mix?.preFxBypassed
            ? "border-border/50 text-muted-foreground/50 bg-transparent"
            : "border-accent text-accent bg-accent/10"
        }`}
        onClick={(e) => { e.stopPropagation(); togglePreFxBypass(); }}
        title="Pre-FX"
      >
        FX
      </button>

      {/* Volume slider with VU */}
      <div className="flex-1 min-w-[50px]" onClick={(e) => e.stopPropagation()}>
        <VuSlider
          mode="volume"
          value={mix?.volume ?? 80}
          meterDb={meterLevel}
          onChange={handleVolumeChange}
        />
      </div>

      {/* Pan slider with L/R VU */}
      <div className="w-[50px] shrink-0" onClick={(e) => e.stopPropagation()}>
        <VuSlider
          mode="pan"
          value={Math.round((mix?.pan ?? 0) * 100)}
          meterDb={meterLR}
          onChange={handlePanChange}
        />
      </div>

      {/* Reverb badge */}
      <button
        className={`text-[8px] px-1 py-0.5 rounded border shrink-0 font-mono uppercase leading-none transition-colors ${
          mix?.reverbBypassed
            ? "border-border/50 text-muted-foreground/50 bg-transparent"
            : "border-primary text-primary bg-primary/10"
        }`}
        onClick={(e) => { e.stopPropagation(); toggleReverbBypass(); }}
        title="Reverb"
      >
        RV
      </button>
    </div>
  );
}
