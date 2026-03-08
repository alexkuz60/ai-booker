/**
 * FilterPanel — 5-band parametric filter UI with frequency response graph + drag.
 * Layout: graph left, controls right. Band dots are draggable (X=freq, Y=gain).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getAudioEngine, FilterBandParams, FilterType, FilterRolloff } from "@/lib/audioEngine";

// ─── Band colors ───────────────────────────────────────────

const BAND_COLORS = [
  "hsl(200, 70%, 55%)",
  "hsl(140, 70%, 50%)",
  "hsl(50, 80%, 55%)",
  "hsl(25, 80%, 55%)",
  "hsl(320, 70%, 55%)",
];
const BAND_COLORS_DIM = [
  "hsla(200, 70%, 55%, 0.3)",
  "hsla(140, 70%, 50%, 0.3)",
  "hsla(50, 80%, 55%, 0.3)",
  "hsla(25, 80%, 55%, 0.3)",
  "hsla(320, 70%, 55%, 0.3)",
];

const FILTER_TYPES: FilterType[] = ["lowpass", "highpass", "bandpass", "lowshelf", "highshelf", "notch", "allpass", "peaking"];
const ROLLOFFS: FilterRolloff[] = [-12, -24, -48, -96];
const TYPE_LABELS: Record<FilterType, string> = {
  lowpass: "LP", highpass: "HP", bandpass: "BP",
  lowshelf: "LS", highshelf: "HS", notch: "N",
  allpass: "AP", peaking: "PK",
};

// Types where bandwidth (octaves) makes sense
const BW_TYPES: FilterType[] = ["bandpass", "peaking", "notch"];
function qToBw(Q: number): number { return (2 / Math.LN2) * Math.asinh(1 / (2 * Q)); }
function bwToQ(bw: number): number { return 1 / (2 * Math.sinh(Math.LN2 / 2 * bw)); }

// ─── Graph constants ───────────────────────────────────────

const F_MIN = 20, F_MAX = 20000;
const DB_MIN = -24, DB_MAX = 24, DB_RANGE = DB_MAX - DB_MIN;
const LOG_MIN = Math.log10(F_MIN), LOG_MAX = Math.log10(F_MAX);

function freqToNorm(f: number) { return (Math.log10(f) - LOG_MIN) / (LOG_MAX - LOG_MIN); }
function normToFreq(n: number) { return Math.pow(10, LOG_MIN + n * (LOG_MAX - LOG_MIN)); }
function gainToNorm(g: number) { return 1 - (g - DB_MIN) / DB_RANGE; }
function normToGain(n: number) { return DB_MAX - n * DB_RANGE; }

// ─── Biquad coefficients (Audio EQ Cookbook) ────────────────

function computeBiquadCoeffs(
  type: FilterType, freq: number, Q: number, gainDb: number, sr: number
) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sr;
  const cosW0 = Math.cos(w0), sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Q);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

  switch (type) {
    case "lowpass":
      b0 = (1 - cosW0) / 2; b1 = 1 - cosW0; b2 = b0;
      a0 = 1 + alpha; a1 = -2 * cosW0; a2 = 1 - alpha; break;
    case "highpass":
      b0 = (1 + cosW0) / 2; b1 = -(1 + cosW0); b2 = b0;
      a0 = 1 + alpha; a1 = -2 * cosW0; a2 = 1 - alpha; break;
    case "bandpass":
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cosW0; a2 = 1 - alpha; break;
    case "notch":
      b0 = 1; b1 = -2 * cosW0; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * cosW0; a2 = 1 - alpha; break;
    case "allpass":
      b0 = 1 - alpha; b1 = -2 * cosW0; b2 = 1 + alpha;
      a0 = 1 + alpha; a1 = -2 * cosW0; a2 = 1 - alpha; break;
    case "peaking":
      b0 = 1 + alpha * A; b1 = -2 * cosW0; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cosW0; a2 = 1 - alpha / A; break;
    case "lowshelf": {
      const sq = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cosW0 + sq);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
      b2 = A * ((A + 1) - (A - 1) * cosW0 - sq);
      a0 = (A + 1) + (A - 1) * cosW0 + sq;
      a1 = -2 * ((A - 1) + (A + 1) * cosW0);
      a2 = (A + 1) + (A - 1) * cosW0 - sq; break;
    }
    case "highshelf": {
      const sq = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cosW0 + sq);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
      b2 = A * ((A + 1) + (A - 1) * cosW0 - sq);
      a0 = (A + 1) - (A - 1) * cosW0 + sq;
      a1 = 2 * ((A - 1) - (A + 1) * cosW0);
      a2 = (A + 1) - (A - 1) * cosW0 - sq; break;
    }
  }
  return { b0, b1, b2, a0, a1, a2 };
}

function computeFilterResponse(band: FilterBandParams, sr: number, freqs: Float32Array): Float32Array {
  const cascades = Math.max(1, Math.abs(band.rolloff) / 12);
  const { b0, b1, b2, a0, a1, a2 } = computeBiquadCoeffs(band.type, band.frequency, band.Q, band.gain, sr);
  const mag = new Float32Array(freqs.length);
  for (let i = 0; i < freqs.length; i++) {
    const w = (2 * Math.PI * freqs[i]) / sr;
    const cosW = Math.cos(w), cos2W = Math.cos(2 * w), sinW = Math.sin(w), sin2W = Math.sin(2 * w);
    const nR = b0 / a0 + (b1 / a0) * cosW + (b2 / a0) * cos2W;
    const nI = -(b1 / a0) * sinW - (b2 / a0) * sin2W;
    const dR = 1 + (a1 / a0) * cosW + (a2 / a0) * cos2W;
    const dI = -(a1 / a0) * sinW - (a2 / a0) * sin2W;
    const dM = dR * dR + dI * dI;
    const re = (nR * dR + nI * dI) / dM;
    const im = (nI * dR - nR * dI) / dM;
    mag[i] = Math.pow(Math.sqrt(re * re + im * im), cascades);
  }
  return mag;
}

// ─── Frequency Response Graph with drag-n-drop ─────────────

function FilterResponseGraph({
  bands, selectedBand, onSelectBand, onDragBand,
}: {
  bands: FilterBandParams[];
  selectedBand: number;
  onSelectBand: (i: number) => void;
  onDragBand: (i: number, freq: number, gain: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<{ band: number } | null>(null);

  // Draw
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

    const sr = 48000;
    const numPts = Math.max(w, 200);
    const freqs = new Float32Array(numPts);
    for (let i = 0; i < numPts; i++) freqs[i] = normToFreq(i / (numPts - 1));

    const toX = (i: number) => (i / (numPts - 1)) * w;
    const dbToY = (db: number) => h * (1 - (db - DB_MIN) / DB_RANGE);
    const fToX = (f: number) => freqToNorm(f) * w;

    const bandMags = bands.map(b => computeFilterResponse(b, sr, freqs));
    const combined = new Float32Array(numPts).fill(1);
    for (const m of bandMags) for (let i = 0; i < numPts; i++) combined[i] *= m[i];

    // Background
    ctx.fillStyle = "hsla(0, 0%, 5%, 0.95)";
    ctx.fillRect(0, 0, w, h);

    // Grid: freq
    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.07)"; ctx.lineWidth = 1;
    ctx.fillStyle = "hsla(0, 0%, 100%, 0.18)"; ctx.font = "11px monospace"; ctx.textAlign = "center";
    for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      const x = fToX(f);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x, h - 2);
    }

    // Grid: dB
    ctx.textAlign = "right";
    for (let db = -24; db <= 24; db += 6) {
      const y = dbToY(db);
      ctx.strokeStyle = db === 0 ? "hsla(0, 0%, 100%, 0.15)" : "hsla(0, 0%, 100%, 0.05)";
      ctx.lineWidth = db === 0 ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      if (db % 12 === 0) {
        ctx.fillStyle = "hsla(0, 0%, 100%, 0.2)"; ctx.font = "10px monospace";
        ctx.fillText(`${db > 0 ? "+" : ""}${db}`, w - 2, y - 2);
      }
    }

    // Per-band curves (dimmed)
    for (let b = 0; b < 5; b++) {
      if (b === selectedBand) continue;
      const m = bandMags[b];
      ctx.strokeStyle = BAND_COLORS_DIM[b]; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < numPts; i++) {
        const x = toX(i), y = dbToY(20 * Math.log10(Math.max(m[i], 1e-6)));
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Selected band curve
    {
      const m = bandMags[selectedBand];
      ctx.strokeStyle = BAND_COLORS[selectedBand]; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i < numPts; i++) {
        const x = toX(i), y = dbToY(20 * Math.log10(Math.max(m[i], 1e-6)));
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Combined curve
    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.8)"; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < numPts; i++) {
      const x = toX(i), y = dbToY(20 * Math.log10(Math.max(combined[i], 1e-6)));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill under combined
    ctx.lineTo(w, dbToY(0)); ctx.lineTo(0, dbToY(0)); ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "hsla(0, 0%, 100%, 0.06)");
    grad.addColorStop(0.5, "hsla(0, 0%, 100%, 0.0)");
    grad.addColorStop(1, "hsla(0, 0%, 100%, 0.06)");
    ctx.fillStyle = grad; ctx.fill();

    const TOP_LABEL_H = 16; // reserved space for top labels

    // Vertical dashed lines at each band frequency (start below top labels)
    for (let b = 0; b < 5; b++) {
      const band = bands[b];
      const x = fToX(band.frequency);
      ctx.save();
      ctx.strokeStyle = b === selectedBand ? BAND_COLORS[b] : BAND_COLORS_DIM[b];
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, TOP_LABEL_H); ctx.lineTo(x, h); ctx.stroke();
      ctx.restore();
      // BW label at bottom for bandpass/peaking/notch
      if (["bandpass", "peaking", "notch"].includes(band.type)) {
        ctx.fillStyle = b === selectedBand ? BAND_COLORS[b] : BAND_COLORS_DIM[b];
        const bw = qToBw(band.Q);
        ctx.font = "9px monospace"; ctx.textAlign = "center";
        ctx.fillText(`${bw.toFixed(1)} oct`, x, h - 3);
      }
    }

    // Band dots (at their gain position, not at 0dB)
    for (let b = 0; b < 5; b++) {
      const band = bands[b];
      const x = fToX(band.frequency);
      const y = dbToY(band.gain);
      const r = b === selectedBand ? 5 : 3.5;

      // Glow for selected
      if (b === selectedBand) {
        ctx.fillStyle = BAND_COLORS_DIM[b];
        ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
      }

      ctx.fillStyle = b === selectedBand ? BAND_COLORS[b] : BAND_COLORS_DIM[b];
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

      // Outline
      ctx.strokeStyle = BAND_COLORS[b]; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();

      // Top label: "N: freq"
      const freqLabel = band.frequency >= 1000 ? `${(band.frequency / 1000).toFixed(1)}k` : `${band.frequency}`;
      ctx.fillStyle = BAND_COLORS[b]; ctx.font = "bold 10px monospace"; ctx.textAlign = "center";
      ctx.fillText(`${b + 1}: ${freqLabel}`, x, 11);
    }
  }, [bands, selectedBand]);

  // ─── Pointer handlers for drag ───────────────────────────

  const getFreqGain = useCallback((e: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { freq: 1000, gain: 0 };
    const rect = canvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return {
      freq: Math.round(Math.max(F_MIN, Math.min(F_MAX, normToFreq(nx)))),
      gain: Math.round(Math.max(DB_MIN, Math.min(DB_MAX, normToGain(ny))) * 2) / 2,
    };
  }, []);

  const findClosestBand = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let closest = 0, minD = Infinity;
    for (let i = 0; i < bands.length; i++) {
      const bx = freqToNorm(bands[i].frequency) * rect.width;
      const by = gainToNorm(bands[i].gain) * rect.height;
      const d = Math.hypot(mx - bx, my - by);
      if (d < minD) { minD = d; closest = i; }
    }
    return closest;
  }, [bands]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Check if close to a band dot (within 15px)
    let hitBand = -1, hitDist = Infinity;
    for (let i = 0; i < bands.length; i++) {
      const bx = freqToNorm(bands[i].frequency) * rect.width;
      const by = gainToNorm(bands[i].gain) * rect.height;
      const d = Math.hypot(mx - bx, my - by);
      if (d < hitDist) { hitDist = d; hitBand = i; }
    }

    if (hitDist < 20) {
      dragging.current = { band: hitBand };
      onSelectBand(hitBand);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    } else {
      // Just select closest band
      const closest = findClosestBand(e);
      onSelectBand(closest);
    }
  }, [bands, onSelectBand, findClosestBand]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current) {
      // Change cursor if near a dot
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      let near = false;
      for (let i = 0; i < bands.length; i++) {
        const bx = freqToNorm(bands[i].frequency) * rect.width;
        const by = gainToNorm(bands[i].gain) * rect.height;
        if (Math.hypot(mx - bx, my - by) < 20) { near = true; break; }
      }
      canvas.style.cursor = near ? "grab" : "crosshair";
      return;
    }
    const { freq, gain } = getFreqGain(e);
    onDragBand(dragging.current.band, freq, gain);
  }, [bands, getFreqGain, onDragBand]);

  const handlePointerUp = useCallback(() => {
    dragging.current = null;
  }, []);

  return (
    <div className="relative rounded-sm border border-border/40 overflow-hidden flex-1 min-w-0" style={{ minHeight: 140 }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
    </div>
  );
}

// ─── Param slider (matches ParamSlider style from MasterEffectsTabs) ───

function FltSlider({ label, value, min, max, step, unit, onChange, disabled }: {
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
        onChange={e => onChange(Number(e.target.value))} disabled={disabled}
        className="w-full h-1 accent-primary cursor-pointer volume-slider-sm disabled:opacity-30"
      />
    </div>
  );
}

function LogFreqSlider({ label, value, min, max, onChange, disabled }: {
  label: string; value: number; min: number; max: number;
  onChange: (v: number) => void; disabled?: boolean;
}) {
  const logMin = Math.log10(min), logMax = Math.log10(max);
  const sliderVal = ((Math.log10(value) - logMin) / (logMax - logMin)) * 1000;
  const display = value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value)}`;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground font-mono uppercase">{label}</span>
        <span className="text-[10px] text-foreground/70 font-mono tabular-nums">{display} Hz</span>
      </div>
      <input
        type="range" min={0} max={1000} step={1} value={Math.round(sliderVal)}
        onChange={e => {
          const t = Number(e.target.value) / 1000;
          onChange(Math.round(Math.pow(10, logMin + t * (logMax - logMin))));
        }}
        disabled={disabled}
        className="w-full h-1 accent-primary cursor-pointer volume-slider-sm disabled:opacity-30"
      />
    </div>
  );
}

// ─── Main FilterPanel ──────────────────────────────────────

export function FilterPanel({ isRu, disabled }: { isRu: boolean; disabled: boolean }) {
  const engine = getAudioEngine();
  const [bands, setBands] = useState<FilterBandParams[]>(() => engine.getMasterFilterBands());
  const [selected, setSelected] = useState(0);
  const band = bands[selected];

  const updateBand = useCallback((idx: number, params: Partial<FilterBandParams>) => {
    setBands(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...params };
      return next;
    });
    engine.setMasterFilterBand(idx, params);
  }, [engine]);

  const handleDragBand = useCallback((idx: number, freq: number, gain: number) => {
    updateBand(idx, { frequency: freq, gain });
  }, [updateBand]);

  return (
    <div className="flex flex-col gap-2">
      {/* Graph + Controls side by side */}
      <div className="flex gap-3">
        {/* Graph (takes remaining space) */}
        <FilterResponseGraph
          bands={bands}
          selectedBand={selected}
          onSelectBand={setSelected}
          onDragBand={handleDragBand}
        />

        {/* Controls column (fixed width, matching compressor style) */}
        <div className="flex flex-col gap-1.5 w-[160px] shrink-0">
          {/* Band selector */}
          <div className="flex items-center gap-0.5">
            {bands.map((_, i) => (
              <button
                key={i}
                onClick={() => setSelected(i)}
                className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-mono font-semibold leading-none transition-colors ${
                  i === selected
                    ? "bg-primary/20 text-primary"
                    : "text-foreground/40 hover:text-foreground/60"
                }`}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: BAND_COLORS[i] }}
                />
                {i + 1}
              </button>
            ))}
          </div>

          {/* Type select — above sliders */}
          <div className="flex flex-col gap-0">
            <span className="text-[10px] text-muted-foreground font-mono uppercase">{isRu ? "Тип" : "Type"}</span>
            <select
              value={band.type}
              onChange={e => updateBand(selected, { type: e.target.value as FilterType })}
              disabled={disabled}
              className="h-5 bg-background border border-border/60 rounded text-[9px] font-mono text-foreground/80 px-1 disabled:opacity-30"
            >
              {FILTER_TYPES.map(t => (
                <option key={t} value={t}>{TYPE_LABELS[t]} — {t}</option>
              ))}
            </select>
          </div>

          {/* Rolloff select — above sliders */}
          <div className="flex flex-col gap-0">
            <span className="text-[10px] text-muted-foreground font-mono uppercase">{isRu ? "Крутизна" : "Rolloff"}</span>
            <select
              value={band.rolloff}
              onChange={e => updateBand(selected, { rolloff: Number(e.target.value) as FilterRolloff })}
              disabled={disabled}
              className="h-5 bg-background border border-border/60 rounded text-[9px] font-mono text-foreground/80 px-1 disabled:opacity-30"
            >
              {ROLLOFFS.map(r => (
                <option key={r} value={r}>{r} dB/oct</option>
              ))}
            </select>
          </div>

          {/* Sliders */}
          <LogFreqSlider
            label={isRu ? "Частота" : "Freq"}
            value={band.frequency} min={20} max={20000}
            onChange={v => updateBand(selected, { frequency: v })} disabled={disabled}
          />
          <FltSlider
            label={isRu ? "Усил." : "Gain"}
            value={band.gain} min={-24} max={24} step={0.5} unit=" dB"
            onChange={v => updateBand(selected, { gain: v })} disabled={disabled}
          />
          <FltSlider
            label="Q"
            value={band.Q} min={0.1} max={20} step={0.1}
            onChange={v => updateBand(selected, { Q: v })} disabled={disabled}
          />

          {/* Bandwidth slider — only for bandpass/peaking/notch */}
          {BW_TYPES.includes(band.type) && (
            <FltSlider
              label={isRu ? "Ширина" : "BW"}
              value={Math.round(qToBw(band.Q) * 100) / 100}
              min={0.1} max={4} step={0.01} unit=" oct"
              onChange={v => updateBand(selected, { Q: Math.round(bwToQ(v) * 100) / 100 })}
              disabled={disabled}
            />
          )}
        </div>
      </div>
    </div>
  );
}
