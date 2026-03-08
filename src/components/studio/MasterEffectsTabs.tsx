/**
 * MasterEffectsTabs — tabbed panel placed in the spectrum analyzer area (right side).
 * Tab 1: FFT Spectrum Analyzer. Tabs 2-5: EQ, Compressor, Limiter, Reverb controls.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { getAudioEngine } from "@/lib/audioEngine";
import { SpectrumAnalyzer } from "@/components/studio/MasterMeterPanel";
import { FilterPanel } from "@/components/studio/FilterPanel";
import { MultibandCompPanel } from "@/components/studio/MultibandCompPanel";
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

// ─── Compressor Knee Graph ──────────────────────────────────

function KneeGraph({ threshold, ratio, knee }: { threshold: number; ratio: number; knee: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const dbMin = -60;
    const dbMax = 0;
    const range = dbMax - dbMin;

    const toX = (db: number) => ((db - dbMin) / range) * w;
    const toY = (db: number) => h - ((db - dbMin) / range) * h;

    // Compute output dB for a given input dB (soft-knee model)
    const computeOut = (input: number): number => {
      const halfKnee = knee / 2;
      if (input <= threshold - halfKnee) {
        return input; // below knee — unity
      } else if (input >= threshold + halfKnee) {
        return threshold + (input - threshold) / ratio; // above knee — full compression
      } else {
        // Soft knee quadratic interpolation
        const x = input - threshold + halfKnee;
        return input + ((1 / ratio - 1) * x * x) / (2 * knee);
      }
    };

    // Background
    ctx.fillStyle = "hsla(0, 0%, 5%, 0.95)";
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.07)";
    ctx.lineWidth = 1;
    for (let db = -48; db <= 0; db += 12) {
      const x = toX(db);
      const y = toY(db);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Grid labels
    ctx.fillStyle = "hsla(0, 0%, 100%, 0.2)";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    for (let db = -48; db <= 0; db += 12) {
      ctx.fillText(`${db}`, toX(db), h - 3);
    }
    ctx.textAlign = "right";
    for (let db = -48; db <= 0; db += 12) {
      ctx.fillText(`${db}`, w - 3, toY(db) + 3);
    }

    // Unity line (1:1)
    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.12)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(toX(dbMin), toY(dbMin));
    ctx.lineTo(toX(dbMax), toY(dbMax));
    ctx.stroke();
    ctx.setLineDash([]);

    // Threshold line
    ctx.strokeStyle = "hsla(50, 80%, 50%, 0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    const tx = toX(threshold);
    ctx.beginPath(); ctx.moveTo(tx, 0); ctx.lineTo(tx, h); ctx.stroke();
    ctx.setLineDash([]);

    // Transfer curve
    ctx.strokeStyle = "hsl(140, 70%, 55%)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = w;
    for (let i = 0; i <= steps; i++) {
      const inputDb = dbMin + (i / steps) * range;
      const outputDb = computeOut(inputDb);
      const x = toX(inputDb);
      const y = toY(outputDb);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill under curve
    ctx.lineTo(toX(dbMax), toY(dbMin));
    ctx.lineTo(toX(dbMin), toY(dbMin));
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
    fillGrad.addColorStop(0, "hsla(140, 70%, 50%, 0.15)");
    fillGrad.addColorStop(1, "hsla(140, 70%, 50%, 0.02)");
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // Threshold label
    ctx.fillStyle = "hsla(50, 80%, 60%, 0.8)";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`T: ${threshold} dB`, tx + 3, 12);

  }, [threshold, ratio, knee]);

  return (
    <div className="relative rounded-sm border border-border/40 overflow-hidden" style={{ aspectRatio: "1" }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
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
  const [knee, setKnee] = useState(params.compKnee);

  return (
    <div className="flex gap-4 max-w-lg items-stretch">
      {/* Knee graph — matches slider column height */}
      <div className="w-36 shrink-0 flex">
        <div className="w-full"><KneeGraph threshold={threshold} ratio={ratio} knee={knee} /></div>
      </div>
      {/* Sliders — half width */}
      <div className="flex flex-col gap-3 min-w-0 w-32">
        <ParamSlider label={isRu ? "Порог" : "Threshold"} value={threshold} min={-60} max={0} step={1} unit=" dB"
          onChange={v => { setThreshold(v); engine.setMasterCompThreshold(v); }} disabled={disabled} />
        <ParamSlider label={isRu ? "Соотн." : "Ratio"} value={ratio} min={1} max={20} step={0.5} unit=":1"
          onChange={v => { setRatio(v); engine.setMasterCompRatio(v); }} disabled={disabled} />
        <ParamSlider label="Knee" value={knee} min={0} max={30} step={1} unit=" dB"
          onChange={v => { setKnee(v); engine.setMasterCompKnee(v); }} disabled={disabled} />
        <ParamSlider label={isRu ? "Атака" : "Attack"} value={attack} min={0.001} max={0.5} step={0.001} unit=" s"
          onChange={v => { setAttack(v); engine.setMasterCompAttack(v); }} disabled={disabled} />
        <ParamSlider label={isRu ? "Восст." : "Release"} value={release} min={0.01} max={1.0} step={0.01} unit=" s"
          onChange={v => { setRelease(v); engine.setMasterCompRelease(v); }} disabled={disabled} />
      </div>
    </div>
  );
}

function LimiterGraph({ threshold }: { threshold: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const dbMin = -60;
    const dbMax = 0;
    const range = dbMax - dbMin;
    const toX = (db: number) => ((db - dbMin) / range) * w;
    const toY = (db: number) => h - ((db - dbMin) / range) * h;

    const computeOut = (input: number): number =>
      input <= threshold ? input : threshold;

    // Background
    ctx.fillStyle = "hsla(0, 0%, 5%, 0.95)";
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.07)";
    ctx.lineWidth = 1;
    for (let db = -48; db <= 0; db += 12) {
      const x = toX(db); const y = toY(db);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Grid labels
    ctx.fillStyle = "hsla(0, 0%, 100%, 0.2)";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    for (let db = -48; db <= 0; db += 12) ctx.fillText(`${db}`, toX(db), h - 3);
    ctx.textAlign = "right";
    for (let db = -48; db <= 0; db += 12) ctx.fillText(`${db}`, w - 3, toY(db) + 3);

    // Unity line
    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.12)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(toX(dbMin), toY(dbMin)); ctx.lineTo(toX(dbMax), toY(dbMax)); ctx.stroke();
    ctx.setLineDash([]);

    // Threshold line
    ctx.strokeStyle = "hsla(0, 70%, 55%, 0.3)";
    ctx.setLineDash([2, 2]);
    const ty = toY(threshold);
    ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(w, ty); ctx.stroke();
    ctx.setLineDash([]);

    // Transfer curve
    ctx.strokeStyle = "hsl(0, 70%, 60%)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= w; i++) {
      const inputDb = dbMin + (i / w) * range;
      const x = toX(inputDb);
      const y = toY(computeOut(inputDb));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill under curve
    ctx.lineTo(toX(dbMax), toY(dbMin));
    ctx.lineTo(toX(dbMin), toY(dbMin));
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
    fillGrad.addColorStop(0, "hsla(0, 70%, 50%, 0.15)");
    fillGrad.addColorStop(1, "hsla(0, 70%, 50%, 0.02)");
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // Threshold label
    ctx.fillStyle = "hsla(0, 70%, 65%, 0.8)";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`T: ${threshold} dB`, 4, ty - 4);
  }, [threshold]);

  return (
    <div className="relative rounded-sm border border-border/40 overflow-hidden" style={{ aspectRatio: "1" }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}

function LimitPanel({ isRu, disabled }: { isRu: boolean; disabled: boolean }) {
  const engine = getAudioEngine();
  const params = engine.getMasterPluginParams();
  const [threshold, setThreshold] = useState(params.limiterThreshold);

  return (
    <div className="flex gap-4 max-w-lg items-stretch">
      <div className="w-36 shrink-0 flex">
        <div className="w-full"><LimiterGraph threshold={threshold} /></div>
      </div>
      <div className="flex flex-col gap-3 min-w-0 w-32">
        <span className="text-[10px] text-muted-foreground/60 font-body">
          {isRu ? "Лимитер" : "Limiter"}
        </span>
        <ParamSlider label={isRu ? "Порог" : "Threshold"} value={threshold} min={-30} max={0} step={0.5} unit=" dB"
          onChange={v => { setThreshold(v); engine.setMasterLimiterThreshold(v); }} disabled={disabled} />
      </div>
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

type EffectTab = "spectrum" | "eq" | "filter" | "mbc" | "comp" | "limit" | "reverb";

const TABS: { id: EffectTab; label: string; labelRu: string }[] = [
  { id: "spectrum", label: "FFT", labelRu: "FFT" },
  { id: "eq", label: "EQ", labelRu: "EQ" },
  { id: "filter", label: "FLT", labelRu: "ФЛТ" },
  { id: "mbc", label: "MBC", labelRu: "МБК" },
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
    return { eq: s.eqBypassed, filter: s.filterBypassed, mbc: s.mbcBypassed, comp: s.compBypassed, limit: s.limiterBypassed, reverb: s.reverbBypassed };
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
      setPluginStates({ eq: s.eqBypassed, filter: s.filterBypassed, mbc: s.mbcBypassed, comp: s.compBypassed, limit: s.limiterBypassed, reverb: s.reverbBypassed });
      setMasterBypassed(s.chainBypassed);
    }, 500);
    return () => clearInterval(iv);
  }, [engine]);

  const togglePlugin = useCallback((id: "eq" | "filter" | "mbc" | "comp" | "limit" | "reverb") => {
    setPluginStates(prev => {
      const newBypassed = !prev[id];
      switch (id) {
        case "eq": engine.setMasterEqBypassed(newBypassed); break;
        case "filter": engine.setMasterFilterBypassed(newBypassed); break;
        case "mbc": engine.setMasterMBCBypassed(newBypassed); break;
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
          const pluginId = tab.id === "spectrum" ? null : (tab.id as "eq" | "filter" | "mbc" | "comp" | "limit" | "reverb");
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
            onClick={() => togglePlugin(activeTab as "eq" | "filter" | "mbc" | "comp" | "limit" | "reverb")}
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
        {activeTab === "filter" && (
          <div className="p-2">
            <span className="text-[10px] text-muted-foreground/60 font-body block mb-1">
              {isRu ? "5-полосный параметрический фильтр" : "5-Band Parametric Filter"}
            </span>
            <FilterPanel isRu={isRu} disabled={isTabDisabled("filter")} />
          </div>
        )}
        {activeTab === "mbc" && (
          <div className="p-2">
            <span className="text-[10px] text-muted-foreground/60 font-body block mb-1">
              {isRu ? "Многополосный динамический компрессор" : "Multiband Dynamic Compressor"}
            </span>
            <MultibandCompPanel isRu={isRu} disabled={isTabDisabled("mbc")} />
          </div>
        )}
        {activeTab === "comp" && (
          <div className="p-3">
            <span className="text-[10px] text-muted-foreground/60 font-body block mb-2">
              {isRu ? "Компрессор" : "Compressor"}
            </span>
            <CompPanel isRu={isRu} disabled={isTabDisabled("comp")} />
          </div>
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
