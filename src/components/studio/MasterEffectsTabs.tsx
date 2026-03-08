/**
 * MasterEffectsTabs — tabbed panel placed in the spectrum analyzer area (right side).
 * Tab 1: FFT Spectrum Analyzer. Tabs 2-5: EQ, Compressor, Limiter, Reverb controls.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { getAudioEngine } from "@/lib/audioEngine";
import { SpectrumAnalyzer } from "@/components/studio/MasterMeterPanel";
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
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-full h-1 accent-primary cursor-pointer volume-slider-sm disabled:opacity-30"
      />
    </div>
  );
}

// ─── Plugin panels ──────────────────────────────────────────

function EqPanel({ isRu, disabled }: { isRu: boolean; disabled: boolean }) {
  const engine = getAudioEngine();
  const params = engine.getMasterPluginParams();
  const [low, setLow] = useState(params.eqLow);
  const [mid, setMid] = useState(params.eqMid);
  const [high, setHigh] = useState(params.eqHigh);

  return (
    <div className="flex flex-col gap-3 max-w-sm">
      <span className="text-[10px] text-muted-foreground/60 font-body">
        {isRu ? "3-полосный эквалайзер" : "3-Band Equalizer"}
      </span>
      <ParamSlider label="Low" value={low} min={-12} max={12} step={0.5} unit=" dB"
        onChange={v => { setLow(v); engine.setMasterEqLow(v); }} disabled={disabled} />
      <ParamSlider label="Mid" value={mid} min={-12} max={12} step={0.5} unit=" dB"
        onChange={v => { setMid(v); engine.setMasterEqMid(v); }} disabled={disabled} />
      <ParamSlider label="High" value={high} min={-12} max={12} step={0.5} unit=" dB"
        onChange={v => { setHigh(v); engine.setMasterEqHigh(v); }} disabled={disabled} />
    </div>
  );
}

function CompPanel({ isRu, disabled }: { isRu: boolean; disabled: boolean }) {
  const engine = getAudioEngine();
  const params = engine.getMasterPluginParams();
  const [threshold, setThreshold] = useState(params.compThreshold);
  const [ratio, setRatio] = useState(params.compRatio);
  const [attack, setAttack] = useState(params.compAttack);
  const [release, setRelease] = useState(params.compRelease);

  return (
    <div className="flex flex-col gap-3 max-w-sm">
      <span className="text-[10px] text-muted-foreground/60 font-body">
        {isRu ? "Компрессор" : "Compressor"}
      </span>
      <ParamSlider label={isRu ? "Порог" : "Threshold"} value={threshold} min={-60} max={0} step={1} unit=" dB"
        onChange={v => { setThreshold(v); engine.setMasterCompThreshold(v); }} disabled={disabled} />
      <ParamSlider label={isRu ? "Соотн." : "Ratio"} value={ratio} min={1} max={20} step={0.5} unit=":1"
        onChange={v => { setRatio(v); engine.setMasterCompRatio(v); }} disabled={disabled} />
      <ParamSlider label={isRu ? "Атака" : "Attack"} value={attack} min={0.001} max={0.5} step={0.001} unit=" s"
        onChange={v => { setAttack(v); engine.setMasterCompAttack(v); }} disabled={disabled} />
      <ParamSlider label={isRu ? "Восст." : "Release"} value={release} min={0.01} max={1.0} step={0.01} unit=" s"
        onChange={v => { setRelease(v); engine.setMasterCompRelease(v); }} disabled={disabled} />
    </div>
  );
}

function LimitPanel({ isRu, disabled }: { isRu: boolean; disabled: boolean }) {
  const engine = getAudioEngine();
  const params = engine.getMasterPluginParams();
  const [threshold, setThreshold] = useState(params.limiterThreshold);

  return (
    <div className="flex flex-col gap-3 max-w-sm">
      <span className="text-[10px] text-muted-foreground/60 font-body">
        {isRu ? "Лимитер" : "Limiter"}
      </span>
      <ParamSlider label={isRu ? "Порог" : "Threshold"} value={threshold} min={-30} max={0} step={0.5} unit=" dB"
        onChange={v => { setThreshold(v); engine.setMasterLimiterThreshold(v); }} disabled={disabled} />
    </div>
  );
}

function ReverbPanel({ isRu, disabled }: { isRu: boolean; disabled: boolean }) {
  const engine = getAudioEngine();
  const params = engine.getMasterPluginParams();
  const [decay, setDecay] = useState(params.reverbDecay);
  const [wet, setWet] = useState(params.reverbWet);

  return (
    <div className="flex flex-col gap-3 max-w-sm">
      <span className="text-[10px] text-muted-foreground/60 font-body">
        {isRu ? "Реверберация" : "Reverb"}
      </span>
      <ParamSlider label={isRu ? "Затухание" : "Decay"} value={decay} min={0.1} max={10} step={0.1} unit=" s"
        onChange={v => { setDecay(v); engine.setMasterReverbDecay(v); }} disabled={disabled} />
      <ParamSlider label="Wet" value={wet} min={0} max={1} step={0.01}
        onChange={v => { setWet(v); engine.setMasterReverbWet(v); }} disabled={disabled} />
    </div>
  );
}

// ─── Tabs definition ────────────────────────────────────────

type EffectTab = "spectrum" | "eq" | "comp" | "limit" | "reverb";

const TABS: { id: EffectTab; label: string; labelRu: string }[] = [
  { id: "spectrum", label: "FFT", labelRu: "FFT" },
  { id: "eq", label: "EQ", labelRu: "EQ" },
  { id: "comp", label: "CMP", labelRu: "КМП" },
  { id: "limit", label: "LIM", labelRu: "ЛИМ" },
  { id: "reverb", label: "REV", labelRu: "РЕВ" },
];

// ─── Main component ─────────────────────────────────────────

interface MasterEffectsTabsProps {
  isRu: boolean;
}

export function MasterEffectsTabs({ isRu }: MasterEffectsTabsProps) {
  const engine = getAudioEngine();

  const [activeTab, setActiveTab] = useState<EffectTab>(() => {
    try { return (localStorage.getItem("master-fx-tab") as EffectTab) || "spectrum"; } catch { return "spectrum"; }
  });

  const [pluginStates, setPluginStates] = useState(() => {
    const s = engine.getMasterPluginState();
    return { eq: s.eqBypassed, comp: s.compBypassed, limit: s.limiterBypassed, reverb: s.reverbBypassed };
  });

  const [masterBypassed, setMasterBypassed] = useState(() => engine.getMasterPluginState().chainBypassed);

  // Persist
  useEffect(() => {
    try { localStorage.setItem("master-fx-tab", activeTab); } catch {}
  }, [activeTab]);

  // Sync from MasterMeterPanel bypass states (poll every 500ms)
  useEffect(() => {
    const iv = setInterval(() => {
      const s = engine.getMasterPluginState();
      setPluginStates({ eq: s.eqBypassed, comp: s.compBypassed, limit: s.limiterBypassed, reverb: s.reverbBypassed });
      setMasterBypassed(s.chainBypassed);
    }, 500);
    return () => clearInterval(iv);
  }, [engine]);

  const togglePlugin = useCallback((id: "eq" | "comp" | "limit" | "reverb") => {
    setPluginStates(prev => {
      const newBypassed = !prev[id];
      switch (id) {
        case "eq": engine.setMasterEqBypassed(newBypassed); break;
        case "comp": engine.setMasterCompBypassed(newBypassed); break;
        case "limit": engine.setMasterLimiterBypassed(newBypassed); break;
        case "reverb": engine.setMasterReverbBypassed(newBypassed); break;
      }
      return { ...prev, [id]: newBypassed };
    });
  }, [engine]);

  const isTabDisabled = (tab: EffectTab): boolean => {
    if (tab === "spectrum") return false;
    return masterBypassed || pluginStates[tab as keyof typeof pluginStates];
  };

  return (
    <div className="flex flex-col h-full gap-1">
      {/* Tab bar + plugin bypass */}
      <div className="flex items-center gap-1 shrink-0 px-1">
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          const pluginId = tab.id === "spectrum" ? null : (tab.id as "eq" | "comp" | "limit" | "reverb");
          const isBypassed = pluginId ? (masterBypassed || pluginStates[pluginId]) : false;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-2 py-1 rounded text-[10px] font-mono uppercase leading-none transition-colors ${
                isActive
                  ? isBypassed
                    ? "bg-muted/40 text-muted-foreground font-bold"
                    : "bg-primary/20 text-primary font-bold"
                  : isBypassed
                    ? "text-muted-foreground/30 hover:text-muted-foreground/50"
                    : "text-foreground/50 hover:text-foreground/80"
              }`}
            >
              {isRu ? tab.labelRu : tab.label}
            </button>
          );
        })}

        {/* Per-plugin bypass for active plugin tab */}
        {activeTab !== "spectrum" && (
          <button
            onClick={() => togglePlugin(activeTab as "eq" | "comp" | "limit" | "reverb")}
            className={`ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase leading-none transition-colors font-semibold ${
              pluginStates[activeTab as keyof typeof pluginStates]
                ? "text-muted-foreground/40 bg-transparent border border-border/50"
                : masterBypassed
                  ? "text-muted-foreground/60 bg-muted/10 border border-border"
                  : "text-accent bg-accent/15 border border-accent/50"
            }`}
          >
            <Power className="h-2.5 w-2.5" />
            {pluginStates[activeTab as keyof typeof pluginStates] ? "OFF" : masterBypassed ? "BYP" : "ON"}
          </button>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === "spectrum" && <SpectrumAnalyzer />}
        {activeTab === "eq" && (
          <div className="p-3"><EqPanel isRu={isRu} disabled={isTabDisabled("eq")} /></div>
        )}
        {activeTab === "comp" && (
          <div className="p-3"><CompPanel isRu={isRu} disabled={isTabDisabled("comp")} /></div>
        )}
        {activeTab === "limit" && (
          <div className="p-3"><LimitPanel isRu={isRu} disabled={isTabDisabled("limit")} /></div>
        )}
        {activeTab === "reverb" && (
          <div className="p-3"><ReverbPanel isRu={isRu} disabled={isTabDisabled("reverb")} /></div>
        )}
      </div>
    </div>
  );
}
