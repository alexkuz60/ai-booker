/**
 * ChannelPluginsPanel — PRE (EQ + Compressor) and POST (Limiter) channel plugin controls
 * for the selected track in StudioTimeline.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { getAudioEngine, type ChannelEqState, type ChannelCompState, type ChannelLimiterState } from "@/lib/audioEngine";
import { Power } from "lucide-react";

// ─── Shared parameter slider ───────────────────────────────

function ParamSlider({ label, value, min, max, step, unit, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground font-mono uppercase">{label}</span>
        <span className="text-[10px] text-foreground/70 font-mono tabular-nums">
          {step < 0.01 ? value.toFixed(3) : step < 1 ? value.toFixed(1) : value.toFixed(0)}{unit ?? ""}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-full h-1 accent-primary cursor-pointer volume-slider-sm disabled:opacity-30"
      />
    </div>
  );
}

// ─── BypassButton ───────────────────────────────────────────

function BypassButton({ label, bypassed, onToggle }: { label: string; bypassed: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase leading-none transition-colors font-semibold ${
        bypassed
          ? "text-muted-foreground/40 bg-transparent border border-border/50"
          : "text-accent bg-accent/15 border border-accent/50"
      }`}
    >
      <Power className="h-2.5 w-2.5" />
      {label}: {bypassed ? "OFF" : "ON"}
    </button>
  );
}

// ─── EQ Panel (PRE) ─────────────────────────────────────────

function ChannelEqPanel({ trackId, isRu, disabled }: { trackId: string; isRu: boolean; disabled: boolean }) {
  const engine = getAudioEngine();
  const ms = engine.getTrackMixState(trackId);
  const init = ms?.eq ?? { low: 0, mid: 0, high: 0, bypassed: true };
  const [low, setLow] = useState(init.low);
  const [mid, setMid] = useState(init.mid);
  const [high, setHigh] = useState(init.high);

  // Sync when trackId changes
  useEffect(() => {
    const s = engine.getTrackMixState(trackId)?.eq;
    if (s) { setLow(s.low); setMid(s.mid); setHigh(s.high); }
  }, [trackId]);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] text-muted-foreground/60 font-body">
        {isRu ? "3-полосный эквалайзер" : "3-Band Equalizer"}
      </span>
      <ParamSlider label="Low" value={low} min={-12} max={12} step={0.5} unit=" dB"
        onChange={v => { setLow(v); engine.setTrackEqLow(trackId, v); }} disabled={disabled} />
      <ParamSlider label="Mid" value={mid} min={-12} max={12} step={0.5} unit=" dB"
        onChange={v => { setMid(v); engine.setTrackEqMid(trackId, v); }} disabled={disabled} />
      <ParamSlider label="High" value={high} min={-12} max={12} step={0.5} unit=" dB"
        onChange={v => { setHigh(v); engine.setTrackEqHigh(trackId, v); }} disabled={disabled} />
    </div>
  );
}

// ─── Compressor Panel (PRE) ─────────────────────────────────

function ChannelCompPanel({ trackId, isRu, disabled }: { trackId: string; isRu: boolean; disabled: boolean }) {
  const engine = getAudioEngine();
  const ms = engine.getTrackMixState(trackId);
  const init = ms?.comp ?? { threshold: -24, ratio: 3, attack: 0.01, release: 0.1, bypassed: true };
  const [threshold, setThreshold] = useState(init.threshold);
  const [ratio, setRatio] = useState(init.ratio);
  const [attack, setAttack] = useState(init.attack);
  const [release, setRelease] = useState(init.release);

  useEffect(() => {
    const s = engine.getTrackMixState(trackId)?.comp;
    if (s) { setThreshold(s.threshold); setRatio(s.ratio); setAttack(s.attack); setRelease(s.release); }
  }, [trackId]);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] text-muted-foreground/60 font-body">
        {isRu ? "Компрессор" : "Compressor"}
      </span>
      <ParamSlider label={isRu ? "Порог" : "Threshold"} value={threshold} min={-60} max={0} step={1} unit=" dB"
        onChange={v => { setThreshold(v); engine.setTrackCompThreshold(trackId, v); }} disabled={disabled} />
      <ParamSlider label={isRu ? "Соотн." : "Ratio"} value={ratio} min={1} max={20} step={0.5} unit=":1"
        onChange={v => { setRatio(v); engine.setTrackCompRatio(trackId, v); }} disabled={disabled} />
      <ParamSlider label={isRu ? "Атака" : "Attack"} value={attack} min={0.001} max={0.5} step={0.001} unit=" s"
        onChange={v => { setAttack(v); engine.setTrackCompAttack(trackId, v); }} disabled={disabled} />
      <ParamSlider label={isRu ? "Восст." : "Release"} value={release} min={0.01} max={1.0} step={0.01} unit=" s"
        onChange={v => { setRelease(v); engine.setTrackCompRelease(trackId, v); }} disabled={disabled} />
    </div>
  );
}

// ─── Limiter Panel (POST) ───────────────────────────────────

function ChannelLimiterPanel({ trackId, isRu, disabled }: { trackId: string; isRu: boolean; disabled: boolean }) {
  const engine = getAudioEngine();
  const ms = engine.getTrackMixState(trackId);
  const init = ms?.limiter ?? { threshold: -3, bypassed: true };
  const [threshold, setThreshold] = useState(init.threshold);

  useEffect(() => {
    const s = engine.getTrackMixState(trackId)?.limiter;
    if (s) setThreshold(s.threshold);
  }, [trackId]);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] text-muted-foreground/60 font-body">
        {isRu ? "Лимитер" : "Limiter"}
      </span>
      <ParamSlider label={isRu ? "Порог" : "Threshold"} value={threshold} min={-30} max={0} step={0.5} unit=" dB"
        onChange={v => { setThreshold(v); engine.setTrackLimiterThreshold(trackId, v); }} disabled={disabled} />
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────

type PluginSection = "eq" | "comp" | "limiter";

const SECTIONS: { id: PluginSection; label: string; labelRu: string; group: "pre" | "post" }[] = [
  { id: "eq", label: "EQ", labelRu: "EQ", group: "pre" },
  { id: "comp", label: "CMP", labelRu: "КМП", group: "pre" },
  { id: "limiter", label: "LIM", labelRu: "ЛИМ", group: "post" },
];

interface ChannelPluginsPanelProps {
  isRu: boolean;
  /** The engine track ID (clip ID) to control. Null = no track selected. */
  trackId: string | null;
  trackLabel?: string;
  trackColor?: string;
  onMixChange?: () => void;
}

export function ChannelPluginsPanel({ isRu, trackId, trackLabel, trackColor, onMixChange }: ChannelPluginsPanelProps) {
  const engine = getAudioEngine();
  const [activeSection, setActiveSection] = useState<PluginSection>("eq");

  // Bypass states
  const [bypasses, setBypasses] = useState({ eq: true, comp: true, limiter: true });

  // Poll bypass states
  useEffect(() => {
    if (!trackId) return;
    const sync = () => {
      const ms = engine.getTrackMixState(trackId);
      if (ms) {
        setBypasses({ eq: ms.eq.bypassed, comp: ms.comp.bypassed, limiter: ms.limiter.bypassed });
      }
    };
    sync();
    const iv = setInterval(sync, 500);
    return () => clearInterval(iv);
  }, [trackId, engine]);

  const toggleBypass = useCallback((section: PluginSection) => {
    if (!trackId) return;
    setBypasses(prev => {
      const next = !prev[section];
      switch (section) {
        case "eq": engine.setTrackEqBypassed(trackId, next); break;
        case "comp": engine.setTrackPreFxBypassed(trackId, next); break;
        case "limiter": engine.setTrackLimiterBypassed(trackId, next); break;
      }
      onMixChange?.();
      return { ...prev, [section]: next };
    });
  }, [trackId, engine, onMixChange]);

  if (!trackId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/50 text-xs font-body">
        {isRu ? "Выберите дорожку для настройки плагинов" : "Select a track to configure plugins"}
      </div>
    );
  }

  const currentGroup = SECTIONS.find(s => s.id === activeSection)?.group ?? "pre";
  const disabled = bypasses[activeSection];

  return (
    <div className="flex flex-col h-full gap-1 px-2 py-1">
      {/* Track label */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor ?? "hsl(var(--primary))" }} />
        <span className="text-[10px] font-mono text-foreground/80 uppercase tracking-wider truncate">
          {trackLabel ?? trackId}
        </span>
      </div>

      {/* PRE / POST groups + section tabs */}
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[8px] font-mono text-muted-foreground/40 uppercase">PRE</span>
        {SECTIONS.filter(s => s.group === "pre").map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase leading-none transition-colors ${
              activeSection === s.id
                ? bypasses[s.id]
                  ? "bg-muted/40 text-muted-foreground font-bold"
                  : "bg-primary/20 text-primary font-bold"
                : bypasses[s.id]
                  ? "text-muted-foreground/30 hover:text-muted-foreground/50"
                  : "text-foreground/50 hover:text-foreground/80"
            }`}
          >
            {isRu ? s.labelRu : s.label}
          </button>
        ))}

        <div className="w-px h-3 bg-border mx-1" />

        <span className="text-[8px] font-mono text-muted-foreground/40 uppercase">POST</span>
        {SECTIONS.filter(s => s.group === "post").map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase leading-none transition-colors ${
              activeSection === s.id
                ? bypasses[s.id]
                  ? "bg-muted/40 text-muted-foreground font-bold"
                  : "bg-primary/20 text-primary font-bold"
                : bypasses[s.id]
                  ? "text-muted-foreground/30 hover:text-muted-foreground/50"
                  : "text-foreground/50 hover:text-foreground/80"
            }`}
          >
            {isRu ? s.labelRu : s.label}
          </button>
        ))}

        {/* Bypass toggle for active section */}
        <button
          onClick={() => toggleBypass(activeSection)}
          className={`ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase leading-none transition-colors font-semibold ${
            bypasses[activeSection]
              ? "text-muted-foreground/40 bg-transparent border border-border/50"
              : "text-accent bg-accent/15 border border-accent/50"
          }`}
        >
          <Power className="h-2.5 w-2.5" />
          {bypasses[activeSection] ? "OFF" : "ON"}
        </button>
      </div>

      {/* Plugin content */}
      <div className="flex-1 min-h-0 overflow-auto py-1">
        {activeSection === "eq" && <ChannelEqPanel trackId={trackId} isRu={isRu} disabled={disabled} />}
        {activeSection === "comp" && <ChannelCompPanel trackId={trackId} isRu={isRu} disabled={disabled} />}
        {activeSection === "limiter" && <ChannelLimiterPanel trackId={trackId} isRu={isRu} disabled={disabled} />}
      </div>
    </div>
  );
}
