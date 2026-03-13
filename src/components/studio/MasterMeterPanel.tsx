/**
 * MasterMeterPanel — left sidebar: stereo L/R output-level meter with dB scale,
 * vertical plugin bypass strip (EQ, COMP, LIMIT, REVERB) + master BYP toggle.
 * Range: -96 dB … +3 dB. Red zone above 0 dB.
 */

import { useRef, useEffect, useState, useCallback } from "react";
import type { MasterMeterData } from "@/lib/audioEngine";
import { getAudioEngine } from "@/lib/audioEngine";
import { Sliders, Power, Maximize, FileAudio } from "lucide-react";
import { Button } from "@/components/ui/button";

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

// ─── FFT Spectrum Analyzer (exported for use in MasterEffectsTabs) ───

type SpectrumMode = "bars" | "line" | "mirror";
const SPECTRUM_MODES: { id: SpectrumMode; label: string }[] = [
  { id: "bars", label: "▮▮" },
  { id: "line", label: "〜" },
  { id: "mirror", label: "⫼" },
];

export function SpectrumAnalyzer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<SpectrumMode>(() => {
    try { return (localStorage.getItem("spectrum-mode") as SpectrumMode) || "bars"; } catch { return "bars"; }
  });
  const [smoothing, setSmoothing] = useState(() => {
    try { const v = Number(localStorage.getItem("spectrum-smoothing")); return isFinite(v) ? v : 0.65; } catch { return 0.65; }
  });

  useEffect(() => {
    try {
      localStorage.setItem("spectrum-mode", mode);
      localStorage.setItem("spectrum-smoothing", String(smoothing));
    } catch {}
  }, [mode, smoothing]);

  useEffect(() => {
    getAudioEngine().setFFTSize(128);
  }, []);

  const smoothRef = useRef<Float32Array | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const smoothingRef = useRef(smoothing);
  smoothingRef.current = smoothing;
  const rmsHoldRef = useRef(DB_MIN);
  const rmsHoldTimeRef = useRef(0);

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

      // Horizontal dB grid lines
      const dbGridLevels = [-6, -12, -24, -48];
      ctx.strokeStyle = "hsla(0, 0%, 100%, 0.08)";
      ctx.lineWidth = 1;
      ctx.font = "9px monospace";
      ctx.fillStyle = "hsla(0, 0%, 100%, 0.25)";
      ctx.textAlign = "left";
      dbGridLevels.forEach(dbLvl => {
        const normalized = Math.max(0, Math.min(1, (dbLvl - (-80)) / 80));
        const gy = h - normalized * h;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
        ctx.fillText(`${dbLvl}`, 2, gy - 2);
      });

      const rawData = getAudioEngine().getFFTData();
      if (!rawData || rawData.length === 0) { raf = requestAnimationFrame(draw); return; }
      const usableBins = Math.max(1, Math.floor(rawData.length * 0.9));
      const barWidth = w / usableBins;
      const dbMin = DB_MIN;
      const dbMax = 0;
      const dbRange = dbMax - dbMin;

      const alpha = smoothingRef.current;
      if (!smoothRef.current || smoothRef.current.length !== rawData.length) {
        smoothRef.current = new Float32Array(rawData.length);
        for (let i = 0; i < rawData.length; i++) {
          smoothRef.current[i] = Number.isFinite(rawData[i]) ? rawData[i] : dbMin;
        }
      } else {
        for (let i = 0; i < rawData.length; i++) {
          const raw = Number.isFinite(rawData[i]) ? rawData[i] : dbMin;
          const prev = Number.isFinite(smoothRef.current[i]) ? smoothRef.current[i] : raw;
          smoothRef.current[i] = alpha * prev + (1 - alpha) * raw;
        }
      }
      const fftData = smoothRef.current;
      const currentMode = modeRef.current;

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
        const gridMarkers = [2, 6, 12, 24, 48, 80];
        ctx.strokeStyle = "hsla(0, 0%, 100%, 0.07)";
        ctx.lineWidth = 1;
        gridMarkers.forEach(bin => {
          if (bin < usableBins) {
            const gx = bin * barWidth;
            ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
          }
        });
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
        ctx.lineTo((usableBins - 1) * barWidth + barWidth / 2, h);
        ctx.lineTo(barWidth / 2, h);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
        fillGrad.addColorStop(0, "hsla(140, 70%, 50%, 0.95)");
        fillGrad.addColorStop(0.3, "hsla(80, 70%, 48%, 0.7)");
        fillGrad.addColorStop(0.7, "hsla(50, 80%, 50%, 0.4)");
        fillGrad.addColorStop(1, "hsla(140, 60%, 35%, 0.25)");
        ctx.fillStyle = fillGrad;
        ctx.fill();
      } else if (currentMode === "mirror") {
        const halfH = h / 2;
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

      ctx.fillStyle = "hsla(0, 0%, 100%, 0.7)";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      const markers = [
        { bin: 2, label: "100" }, { bin: 6, label: "500" },
        { bin: 12, label: "1k" }, { bin: 24, label: "2k" },
        { bin: 48, label: "5k" }, { bin: 80, label: "10k" },
      ];
      markers.forEach(m => {
        if (m.bin < usableBins) ctx.fillText(m.label, m.bin * barWidth, h - 2);
      });

      // ─── RMS / Peak overlay (top-right) ───────────────────
      const meter = getAudioEngine().getMasterMeter();
      const fmtDb = (db: number) => {
        const safe = Number.isFinite(db) ? Math.max(DB_MIN, db) : DB_MIN;
        return `${safe >= 0 ? "+" : ""}${safe.toFixed(1)}`;
      };
      // Compute RMS from FFT bins (approximate power sum)
      let powerSum = 0;
      for (let i = 0; i < usableBins; i++) {
        const lin = Math.pow(10, fftData[i] / 20);
        powerSum += lin * lin;
      }
      const rmsDb = usableBins > 0 ? 10 * Math.log10(powerSum / usableBins) : DB_MIN;
      // Peak-hold behaviour: only update displayed RMS if new value is higher, else decay after 1.5s
      const now = performance.now();
      const RMS_HOLD_MS = 1500;
      const RMS_FALL_RATE = 20; // dB/sec
      if (rmsDb >= rmsHoldRef.current) {
        rmsHoldRef.current = rmsDb;
        rmsHoldTimeRef.current = now;
      } else if (now - rmsHoldTimeRef.current > RMS_HOLD_MS) {
        rmsHoldRef.current -= RMS_FALL_RATE * (1 / 60);
      }
      const rmsStr = fmtDb(rmsHoldRef.current);

      const peakL = meter.peakL;
      const peakR = meter.peakR;
      const peakMax = Math.max(peakL, peakR);
      const isClip = peakMax >= 0;

      // Background pill
      const pillW = 130;
      const pillH = 28;
      const px = w - pillW - 4;
      const py = 4;
      ctx.fillStyle = "hsla(0, 0%, 0%, 0.65)";
      ctx.fillRect(px, py, pillW, pillH);

      ctx.font = "bold 9px monospace";
      ctx.textAlign = "left";
      const col1 = px + 4;
      const col2 = px + 68;

      // RMS row
      ctx.fillStyle = "hsla(140, 60%, 60%, 0.9)";
      ctx.fillText("RMS", col1, py + 11);
      ctx.fillStyle = "hsla(0, 0%, 100%, 0.85)";
      ctx.fillText(rmsStr + " dB", col1 + 26, py + 11);

      // Peak row
      ctx.fillStyle = isClip ? "hsl(0, 90%, 60%)" : "hsla(50, 80%, 60%, 0.9)";
      ctx.fillText("PK", col1, py + 23);
      ctx.fillStyle = "hsla(0, 0%, 100%, 0.7)";
      ctx.font = "9px monospace";
      const pkLStr = fmtDb(peakL);
      const pkRStr = fmtDb(peakR);
      ctx.fillText(`L${pkLStr}`, col1 + 18, py + 23);
      ctx.fillText(`R${pkRStr}`, col2, py + 23);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col gap-1 h-full">
      <div className="flex items-center justify-between shrink-0 gap-1">
        <span className="text-xs text-foreground font-body uppercase tracking-wider font-semibold shrink-0">
          Spectrum
        </span>
        <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
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
          <input
            type="range"
            min={0}
            max={0.95}
            step={0.05}
            value={smoothing}
            onChange={e => setSmoothing(Number(e.target.value))}
            className="w-[72px] h-0.5 accent-primary cursor-pointer volume-slider-sm shrink-0"
            title={`Smoothing ${(smoothing * 100).toFixed(0)}%`}
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 relative rounded-sm border border-border/40 overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>
    </div>
  );
}

// ─── Plugin slot definition ─────────────────────────────────

interface PluginSlot {
  id: "eq" | "filter" | "mbc" | "comp" | "limit" | "reverb";
  label: string;
  labelRu: string;
}

interface PluginGroup {
  title: string;
  titleRu: string;
  slots: PluginSlot[];
}

const PLUGIN_GROUPS: PluginGroup[] = [
  {
    title: "Master", titleRu: "Мастер",
    slots: [
      { id: "filter", label: "FLT", labelRu: "ФЛТ" },
      { id: "mbc", label: "MBC", labelRu: "МБК" },
      { id: "reverb", label: "REV", labelRu: "РЕВ" },
    ],
  },
];

// ─── Exported Panel (left sidebar: meter + vertical plugin bypass strip) ───

interface MasterMeterPanelProps {
  isRu: boolean;
  width: number;
  onNormalize?: () => void;
  onRender?: () => void;
  normalizeDisabled?: boolean;
  renderDisabled?: boolean;
}

export function MasterMeterPanel({ isRu, width, onNormalize, onRender, normalizeDisabled, renderDisabled }: MasterMeterPanelProps) {
  const engine = getAudioEngine();

  const [pluginStates, setPluginStates] = useState(() => {
    const s = engine.getMasterPluginState();
    return { eq: s.eqBypassed, filter: s.filterBypassed, mbc: s.mbcBypassed, comp: s.compBypassed, limit: s.limiterBypassed, reverb: s.reverbBypassed };
  });

  const [masterBypassed, setMasterBypassed] = useState(() => engine.getMasterPluginState().chainBypassed);

  // Persist
  useEffect(() => {
    try {
      localStorage.setItem("master-plugins-state", JSON.stringify(pluginStates));
      localStorage.setItem("master-bypass", String(masterBypassed));
    } catch {}
  }, [pluginStates, masterBypassed]);

  // Restore on mount
  useEffect(() => {
    try {
      const savedPlugins = localStorage.getItem("master-plugins-state");
      const savedBypass = localStorage.getItem("master-bypass");
      if (savedPlugins) {
        const parsed = JSON.parse(savedPlugins);
        setPluginStates(parsed);
        engine.setMasterEqBypassed(parsed.eq ?? true);
        engine.setMasterFilterBypassed(parsed.filter ?? true);
        engine.setMasterMBCBypassed(parsed.mbc ?? true);
        engine.setMasterCompBypassed(parsed.comp ?? true);
        engine.setMasterLimiterBypassed(parsed.limit ?? true);
        engine.setMasterReverbBypassed(parsed.reverb ?? true);
      }
      if (savedBypass === "true" || savedBypass === "false") {
        const byp = savedBypass === "true";
        setMasterBypassed(byp);
        engine.setMasterChainBypassed(byp);
      }
    } catch {}
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

  const toggleMasterBypass = useCallback(() => {
    setMasterBypassed(prev => {
      const next = !prev;
      engine.setMasterChainBypassed(next);
      return next;
    });
  }, [engine]);

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
          BYP
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col gap-2 p-2 min-h-0 overflow-hidden">
        {/* Meter section */}
        <PeakMeterSection />

        {/* Vertical plugin bypass strip — grouped */}
        <div className="flex flex-col gap-2 mt-1">
          {PLUGIN_GROUPS.map(group => (
            <div key={group.title} className="flex flex-col gap-0.5">
              <span className="text-[8px] font-body text-muted-foreground/60 uppercase tracking-widest px-1 pb-0.5 border-b border-border/30">
                {isRu ? group.titleRu : group.title}
              </span>
              {group.slots.map(slot => {
                const isBypassed = pluginStates[slot.id];
                return (
                  <button
                    key={slot.id}
                    onClick={() => togglePlugin(slot.id)}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] font-mono uppercase leading-none transition-colors w-full ${
                      isBypassed
                        ? masterBypassed
                          ? "text-muted-foreground/30 bg-transparent"
                          : "text-muted-foreground/50 bg-muted/20 hover:bg-muted/30"
                        : masterBypassed
                          ? "text-muted-foreground/60 bg-muted/10"
                          : "text-primary bg-primary/15 font-bold hover:bg-primary/20"
                    }`}
                  >
                    <Power className="h-2.5 w-2.5 shrink-0" />
                    <span className="flex-1 text-left">{isRu ? slot.labelRu : slot.label}</span>
                    <span className={`text-[8px] ${isBypassed ? "text-muted-foreground/40" : "text-accent"}`}>
                      {isBypassed ? "OFF" : masterBypassed ? "BYP" : "ON"}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-1.5 mt-auto pt-2 border-t border-border/30">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] gap-1.5 font-mono uppercase w-full justify-start"
            disabled={normalizeDisabled}
            onClick={onNormalize}
            title={isRu ? "Нормализация громкости всех сцен до -0.5 dB" : "Normalize all scenes loudness to -0.5 dB"}
          >
            <Maximize className="h-3 w-3 shrink-0" />
            {isRu ? "Нормализация" : "Normalize"}
          </Button>
          <Button
            variant="hero"
            size="sm"
            className="h-7 text-[10px] gap-1.5 font-mono uppercase w-full justify-start"
            disabled={renderDisabled}
            onClick={onRender}
            title={isRu ? "Рендер финального файла главы/части" : "Render final chapter/part file"}
          >
            <FileAudio className="h-3 w-3 shrink-0" />
            {isRu ? "Рендер" : "Render"}
          </Button>
        </div>
      </div>
    </div>
  );
}
