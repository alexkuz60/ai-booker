/**
 * MasterMeterPanel — large stereo L/R output-level meter with dB scale
 * between the bars, mastering plugin chain with bypass.
 * Range: -96 dB … +3 dB. Red zone above 0 dB.
 * Plugins are wired to real Tone.js nodes in AudioEngine.
 */

import { useRef, useEffect, useState, useCallback } from "react";
import type { MasterMeterData } from "@/lib/audioEngine";
import { getAudioEngine } from "@/lib/audioEngine";
import { Sliders, Power } from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────

const DB_MIN = -96;
const DB_MAX = 3;
const DB_RANGE = DB_MAX - DB_MIN;

function dbToFraction(db: number): number {
  if (db <= DB_MIN) return 0;
  if (db >= DB_MAX) return 1;
  return (db - DB_MIN) / DB_RANGE;
}

const DB_MARKS = [3, 0, -3, -6, -12, -18, -24, -36, -48, -60, -72, -96];

// ─── dB Scale (horizontal, between bars) ────────────────────

function DbScale() {
  return (
    <div className="relative w-full h-4">
      {DB_MARKS.map(db => {
        const pct = dbToFraction(db) * 100;
        return (
          <span
            key={db}
            className={`absolute font-mono leading-none select-none ${
              db > 0
                ? "text-[10px] font-bold text-destructive"
                : db === 0
                  ? "text-[10px] font-bold text-foreground"
                  : "text-[9px] text-foreground/80"
            }`}
            style={{ left: `${pct}%`, transform: "translateX(-50%)", top: 0 }}
          >
            {db > 0 ? `+${db}` : db === 0 ? "0" : db}
          </span>
        );
      })}
    </div>
  );
}

// ─── Single-channel meter bar (canvas) with peak hold line ──

function LargeMeterSingleChannel({ channel, peakDb }: { channel: "L" | "R"; peakDb: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = getAudioEngine();

  useEffect(() => {
    let raf: number;
    const draw = () => {
      const meter = engine.getMasterMeter();
      const canvas = canvasRef.current;
      if (!canvas) { raf = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) { raf = requestAnimationFrame(draw); return; }

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const db = channel === "L" ? meter.levelL : meter.levelR;
      const frac = dbToFraction(db);
      const zeroPct = dbToFraction(0);
      const fillW = frac * w;
      const zeroX = zeroPct * w;

      ctx.fillStyle = "hsla(0, 0%, 50%, 0.08)";
      ctx.fillRect(0, 0, w, h);

      if (fillW <= zeroX) {
        const grad = ctx.createLinearGradient(0, 0, zeroX, 0);
        grad.addColorStop(0, "hsl(140, 60%, 42%)");
        grad.addColorStop(0.55, "hsl(80, 60%, 48%)");
        grad.addColorStop(1, "hsl(50, 80%, 50%)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, fillW, h);
      } else {
        const grad = ctx.createLinearGradient(0, 0, zeroX, 0);
        grad.addColorStop(0, "hsl(140, 60%, 42%)");
        grad.addColorStop(0.55, "hsl(80, 60%, 48%)");
        grad.addColorStop(1, "hsl(50, 80%, 50%)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, zeroX, h);
        ctx.fillStyle = "hsl(0, 75%, 50%)";
        ctx.fillRect(zeroX, 0, fillW - zeroX, h);
      }

      // 0 dB reference line
      ctx.fillStyle = "hsla(0, 0%, 100%, 0.3)";
      ctx.fillRect(zeroX, 0, 1, h);

      // Peak hold line
      const pk = channel === "L" ? meter.peakL : meter.peakR;
      const peakFrac = dbToFraction(pk);
      if (peakFrac > 0) {
        const peakX = peakFrac * w;
        const isClip = pk >= 0;
        ctx.fillStyle = isClip ? "hsl(0, 90%, 60%)" : "hsla(50, 100%, 80%, 0.9)";
        ctx.fillRect(peakX - 1, 0, 2, h);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, channel]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

// ─── Peak readout (numeric dB) ──────────────────────────────

function PeakReadout({ peakDb }: { peakDb: number }) {
  const isClip = peakDb >= 0;
  const display = peakDb <= DB_MIN
    ? "-∞"
    : `${peakDb >= 0 ? "+" : ""}${peakDb.toFixed(1)}`;

  return (
    <span
      className={`font-mono text-[9px] leading-none w-8 text-right shrink-0 font-bold ${
        isClip ? "text-destructive" : "text-foreground/70"
      }`}
      title="Peak hold (dB)"
    >
      {display}
    </span>
  );
}
// ─── Meter section with peak hold ───────────────────────────

function PeakMeterSection() {
  const engine = getAudioEngine();
  const [peaks, setPeaks] = useState({ peakL: -Infinity, peakR: -Infinity });

  useEffect(() => {
    let raf: number;
    const tick = () => {
      const m = engine.getMasterMeter();
      setPeaks({ peakL: m.peakL, peakR: m.peakR });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return (
    <div className="flex flex-col gap-0">
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-foreground/60 font-mono w-3 shrink-0 font-bold">L</span>
        <div className="flex-1 h-5 rounded-sm overflow-hidden border border-border/40 bg-background/40">
          <LargeMeterSingleChannel channel="L" peakDb={peaks.peakL} />
        </div>
        <PeakReadout peakDb={peaks.peakL} />
      </div>
      <div className="pl-4 pr-0 mr-9">
        <DbScale />
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-foreground/60 font-mono w-3 shrink-0 font-bold">R</span>
        <div className="flex-1 h-5 rounded-sm overflow-hidden border border-border/40 bg-background/40">
          <LargeMeterSingleChannel channel="R" peakDb={peaks.peakR} />
        </div>
        <PeakReadout peakDb={peaks.peakR} />
      </div>
    </div>
  );
}

// ─── FFT Spectrum Analyzer ──────────────────────────────────

type SpectrumMode = "bars" | "line" | "mirror";
const SPECTRUM_MODES: { id: SpectrumMode; label: string }[] = [
  { id: "bars", label: "▮▮" },
  { id: "line", label: "〜" },
  { id: "mirror", label: "⫼" },
];

const FFT_SIZES = [64, 128, 256] as const;
type FFTSize = typeof FFT_SIZES[number];

export function SpectrumAnalyzer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = getAudioEngine();

  const [mode, setMode] = useState<SpectrumMode>(() => {
    try { return (localStorage.getItem("spectrum-mode") as SpectrumMode) || "bars"; } catch { return "bars"; }
  });
  const [fftSize, setFftSize] = useState<FFTSize>(() => {
    try { const v = Number(localStorage.getItem("spectrum-fft-size")); return FFT_SIZES.includes(v as FFTSize) ? v as FFTSize : 128; } catch { return 128; }
  });
  const [smoothing, setSmoothing] = useState(() => {
    try { const v = Number(localStorage.getItem("spectrum-smoothing")); return isFinite(v) ? v : 0.65; } catch { return 0.65; }
  });

  // Persist settings
  useEffect(() => {
    try {
      localStorage.setItem("spectrum-mode", mode);
      localStorage.setItem("spectrum-fft-size", String(fftSize));
      localStorage.setItem("spectrum-smoothing", String(smoothing));
    } catch { /* ignore */ }
  }, [mode, fftSize, smoothing]);

  // Apply FFT size to engine
  useEffect(() => {
    engine.setFFTSize(fftSize);
  }, [engine, fftSize]);

  // Smoothing buffer ref
  const smoothRef = useRef<Float32Array | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const smoothingRef = useRef(smoothing);
  smoothingRef.current = smoothing;

  useEffect(() => {
    let raf: number;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) { raf = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) { raf = requestAnimationFrame(draw); return; }

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = "hsla(0, 0%, 5%, 0.95)";
      ctx.fillRect(0, 0, w, h);

      const rawData = engine.getFFTData();
      if (!rawData || rawData.length === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const usableBins = Math.max(1, Math.floor(rawData.length * 0.9));
      const barWidth = w / usableBins;
      const dbMin = -80;
      const dbMax = 0;
      const dbRange = dbMax - dbMin;

      // Apply temporal smoothing
      const alpha = smoothingRef.current;
      if (!smoothRef.current || smoothRef.current.length !== rawData.length) {
        smoothRef.current = new Float32Array(rawData);
      } else {
        for (let i = 0; i < rawData.length; i++) {
          smoothRef.current[i] = alpha * smoothRef.current[i] + (1 - alpha) * rawData[i];
        }
      }
      const fftData = smoothRef.current;

      const currentMode = modeRef.current;

      // Gradient (reused across modes)
      const gradient = ctx.createLinearGradient(0, h, 0, 0);
      gradient.addColorStop(0, "hsl(140, 60%, 35%)");
      gradient.addColorStop(0.4, "hsl(80, 70%, 45%)");
      gradient.addColorStop(0.7, "hsl(50, 80%, 50%)");
      gradient.addColorStop(0.9, "hsl(25, 90%, 50%)");
      gradient.addColorStop(1, "hsl(0, 75%, 50%)");

      if (currentMode === "bars") {
        ctx.fillStyle = gradient;
        for (let i = 0; i < usableBins; i++) {
          const normalized = Math.max(0, Math.min(1, (fftData[i] - dbMin) / dbRange));
          ctx.fillRect(i * barWidth, h - normalized * h, barWidth - 0.5, normalized * h);
        }
      } else if (currentMode === "line") {
        ctx.strokeStyle = "hsl(140, 70%, 55%)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < usableBins; i++) {
          const normalized = Math.max(0, Math.min(1, (fftData[i] - dbMin) / dbRange));
          const x = i * barWidth + barWidth / 2;
          const y = h - normalized * h;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // Fill under line
        ctx.lineTo((usableBins - 1) * barWidth + barWidth / 2, h);
        ctx.lineTo(barWidth / 2, h);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, h, 0, 0);
        fillGrad.addColorStop(0, "hsla(140, 60%, 35%, 0.05)");
        fillGrad.addColorStop(0.5, "hsla(80, 70%, 45%, 0.15)");
        fillGrad.addColorStop(1, "hsla(50, 80%, 50%, 0.25)");
        ctx.fillStyle = fillGrad;
        ctx.fill();
      } else if (currentMode === "mirror") {
        const halfH = h / 2;
        // Center line
        ctx.fillStyle = "hsla(0, 0%, 100%, 0.06)";
        ctx.fillRect(0, halfH, w, 1);

        const mirrorGradUp = ctx.createLinearGradient(0, halfH, 0, 0);
        mirrorGradUp.addColorStop(0, "hsl(140, 60%, 35%)");
        mirrorGradUp.addColorStop(0.5, "hsl(80, 70%, 45%)");
        mirrorGradUp.addColorStop(1, "hsl(50, 80%, 50%)");

        const mirrorGradDown = ctx.createLinearGradient(0, halfH, 0, h);
        mirrorGradDown.addColorStop(0, "hsl(200, 60%, 35%)");
        mirrorGradDown.addColorStop(0.5, "hsl(220, 70%, 45%)");
        mirrorGradDown.addColorStop(1, "hsl(260, 60%, 40%)");

        for (let i = 0; i < usableBins; i++) {
          const normalized = Math.max(0, Math.min(1, (fftData[i] - dbMin) / dbRange));
          const barH = normalized * halfH;
          const x = i * barWidth;
          ctx.fillStyle = mirrorGradUp;
          ctx.fillRect(x, halfH - barH, barWidth - 0.5, barH);
          ctx.fillStyle = mirrorGradDown;
          ctx.fillRect(x, halfH + 1, barWidth - 0.5, barH);
        }
      }

      // Frequency markers
      ctx.fillStyle = "hsla(0, 0%, 100%, 0.7)";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      const markers = [
        { bin: 2, label: "100" }, { bin: 6, label: "500" },
        { bin: 12, label: "1k" }, { bin: 24, label: "2k" },
        { bin: 48, label: "5k" }, { bin: 80, label: "10k" },
      ];
      const markerY = currentMode === "mirror" ? h - 2 : h - 2;
      markers.forEach(m => {
        if (m.bin < usableBins) ctx.fillText(m.label, m.bin * barWidth, markerY);
      });

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return (
    <div className="flex flex-col gap-1 h-full">
      <div className="flex items-center justify-between shrink-0 gap-1">
        <span className="text-xs text-foreground font-body uppercase tracking-wider font-semibold shrink-0">
          Spectrum
        </span>
        <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
          {/* FFT Size selector */}
          <div className="flex gap-0.5 shrink-0">
            {FFT_SIZES.map(s => (
              <button
                key={s}
                onClick={() => { setFftSize(s); smoothRef.current = null; }}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono leading-none transition-colors ${
                  fftSize === s
                    ? "text-foreground bg-accent/20 font-bold"
                    : "text-foreground/50 hover:text-foreground/80"
                }`}
                title={`FFT ${s}`}
              >
                {s}
              </button>
            ))}
          </div>
          <span className="text-foreground/30 shrink-0">│</span>
          {/* Mode selector */}
          <div className="flex gap-0.5 shrink-0">
            {SPECTRUM_MODES.map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-mono leading-none transition-colors ${
                  mode === m.id
                    ? "text-foreground bg-primary/20 font-bold"
                    : "text-foreground/50 hover:text-foreground/80"
                }`}
                title={m.id}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="text-foreground/30 shrink-0">│</span>
          {/* Smoothing slider — compact, inline */}
          <input
            type="range"
            min={0}
            max={0.95}
            step={0.05}
            value={smoothing}
            onChange={e => setSmoothing(Number(e.target.value))}
            className="w-12 h-2 accent-primary cursor-pointer shrink-0 [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-moz-range-thumb]:w-2 [&::-moz-range-thumb]:h-2"
            title={`Smoothing ${(smoothing * 100).toFixed(0)}%`}
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 relative rounded-sm border border-border/40 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
        />
      </div>
    </div>
  );
}


interface PluginSlot {
  id: "eq" | "comp" | "limit" | "reverb";
  label: string;
  labelRu: string;
  type: "pre" | "post";
}

const PLUGIN_SLOTS: PluginSlot[] = [
  { id: "eq", label: "EQ", labelRu: "EQ", type: "pre" },
  { id: "comp", label: "COMP", labelRu: "КОМП", type: "pre" },
  { id: "limit", label: "LIMIT", labelRu: "ЛИМИТ", type: "pre" },
  { id: "reverb", label: "REVERB", labelRu: "РЕВЕРБ", type: "post" },
];

// ─── Exported Panel ─────────────────────────────────────────

interface MasterMeterPanelProps {
  isRu: boolean;
  width: number;
}

export function MasterMeterPanel({ isRu, width }: MasterMeterPanelProps) {
  const engine = getAudioEngine();

  // Read initial state from engine
  const [pluginStates, setPluginStates] = useState(() => {
    const s = engine.getMasterPluginState();
    return {
      eq: s.eqBypassed,
      comp: s.compBypassed,
      limit: s.limiterBypassed,
      reverb: s.reverbBypassed,
    };
  });

  const [masterBypassed, setMasterBypassed] = useState(() => {
    return engine.getMasterPluginState().chainBypassed;
  });

  // Persist to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem("master-plugins-state", JSON.stringify(pluginStates));
      localStorage.setItem("master-bypass", String(masterBypassed));
    } catch { /* ignore */ }
  }, [pluginStates, masterBypassed]);

  // Restore from localStorage on mount
  useEffect(() => {
    try {
      const savedPlugins = localStorage.getItem("master-plugins-state");
      const savedBypass = localStorage.getItem("master-bypass");
      if (savedPlugins) {
        const parsed = JSON.parse(savedPlugins);
        setPluginStates(parsed);
        engine.setMasterEqBypassed(parsed.eq ?? true);
        engine.setMasterCompBypassed(parsed.comp ?? true);
        engine.setMasterLimiterBypassed(parsed.limit ?? true);
        engine.setMasterReverbBypassed(parsed.reverb ?? true);
      }
      if (savedBypass === "true" || savedBypass === "false") {
        const byp = savedBypass === "true";
        setMasterBypassed(byp);
        engine.setMasterChainBypassed(byp);
      }
    } catch { /* ignore */ }
  }, [engine]);

  const togglePlugin = useCallback((id: "eq" | "comp" | "limit" | "reverb") => {
    setPluginStates(prev => {
      const newBypassed = !prev[id];
      // Apply to real engine
      switch (id) {
        case "eq": engine.setMasterEqBypassed(newBypassed); break;
        case "comp": engine.setMasterCompBypassed(newBypassed); break;
        case "limit": engine.setMasterLimiterBypassed(newBypassed); break;
        case "reverb": engine.setMasterReverbBypassed(newBypassed); break;
      }
      return { ...prev, [id]: newBypassed };
    });
  }, [engine]);

  const toggleMasterBypass = useCallback(() => {
    setMasterBypassed(prev => {
      const next = !prev;
      engine.setMasterChainBypassed(next);
      return next;
    });
  }, [engine]);

  const isCompact = width < 200;

  const prePlugins = PLUGIN_SLOTS.filter(p => p.type === "pre");
  const postPlugins = PLUGIN_SLOTS.filter(p => p.type === "post");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-6 border-b border-border flex items-center px-2 justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <Sliders className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] font-body text-muted-foreground uppercase tracking-wider">
            {isRu ? "Мастер" : "Master"}
          </span>
        </div>
        <button
          onClick={toggleMasterBypass}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase leading-none transition-colors font-semibold ${
            masterBypassed
              ? "text-muted-foreground/50 bg-transparent"
              : "text-primary bg-primary/15"
          }`}
          title={isRu ? "Байпасс мастер-цепи" : "Bypass master chain"}
        >
          <Power className="h-2.5 w-2.5" />
          {isCompact ? "" : "BYP"}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col gap-1.5 p-2 min-h-0 overflow-auto">
        {/* Meter section */}
        <PeakMeterSection />

        {/* Pre-processing plugins (EQ, Comp, Limiter) */}
        <div className="flex flex-col gap-1 mt-1">
          <span className="text-[9px] text-muted-foreground/50 font-body uppercase tracking-wider">
            {isRu ? "Пре-обработка" : "Pre-FX"}
          </span>
          {prePlugins.map(plugin => {
            const bypassed = pluginStates[plugin.id];
            return (
              <button
                key={plugin.id}
                onClick={() => togglePlugin(plugin.id)}
                className={`flex items-center justify-between px-2 py-1.5 rounded border transition-colors text-[10px] font-mono uppercase tracking-wide ${
                  bypassed
                    ? "border-border/50 text-muted-foreground/40 bg-transparent hover:bg-muted/20"
                    : masterBypassed
                      ? "border-border text-muted-foreground/60 bg-muted/10"
                      : "border-accent/50 text-accent bg-accent/10 hover:bg-accent/15"
                }`}
              >
                <span className="font-semibold">{isRu ? plugin.labelRu : plugin.label}</span>
                <span className={`text-[8px] ${bypassed ? "text-muted-foreground/30" : masterBypassed ? "text-muted-foreground/40" : "text-accent/70"}`}>
                  {bypassed ? "OFF" : masterBypassed ? "BYP" : "ON"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Post-processing plugins (Reverb) */}
        <div className="flex flex-col gap-1 mt-1">
          <span className="text-[9px] text-muted-foreground/50 font-body uppercase tracking-wider">
            {isRu ? "Пост-обработка" : "Post-FX"}
          </span>
          {postPlugins.map(plugin => {
            const bypassed = pluginStates[plugin.id];
            return (
              <button
                key={plugin.id}
                onClick={() => togglePlugin(plugin.id)}
                className={`flex items-center justify-between px-2 py-1.5 rounded border transition-colors text-[10px] font-mono uppercase tracking-wide ${
                  bypassed
                    ? "border-border/50 text-muted-foreground/40 bg-transparent hover:bg-muted/20"
                    : masterBypassed
                      ? "border-border text-muted-foreground/60 bg-muted/10"
                      : "border-primary/50 text-primary bg-primary/10 hover:bg-primary/15"
                }`}
              >
                <span className="font-semibold">{isRu ? plugin.labelRu : plugin.label}</span>
                <span className={`text-[8px] ${bypassed ? "text-muted-foreground/30" : masterBypassed ? "text-muted-foreground/40" : "text-primary/70"}`}>
                  {bypassed ? "OFF" : masterBypassed ? "BYP" : "ON"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
