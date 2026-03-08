/**
 * FilterPanel — 5-band parametric filter UI with frequency response graph.
 * Each band: frequency, type, Q, gain, rolloff.
 * Canvas renders combined frequency response of all 5 bands.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getAudioEngine, FilterBandParams, FilterType, FilterRolloff } from "@/lib/audioEngine";

// ─── Band colors (HSL hues) ────────────────────────────────

const BAND_COLORS = [
  "hsl(200, 70%, 55%)",  // cyan
  "hsl(140, 70%, 50%)",  // green
  "hsl(50, 80%, 55%)",   // yellow
  "hsl(25, 80%, 55%)",   // orange
  "hsl(320, 70%, 55%)",  // magenta
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

// ─── Biquad frequency response computation ─────────────────

function computeBiquadResponse(
  type: BiquadFilterType, frequency: number, Q: number, gain: number,
  sampleRate: number, freqs: Float32Array
): Float32Array {
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  const biquad = ctx.createBiquadFilter();
  biquad.type = type;
  biquad.frequency.value = frequency;
  biquad.Q.value = Q;
  biquad.gain.value = gain;

  const magResponse = new Float32Array(freqs.length);
  const phaseResponse = new Float32Array(freqs.length);
  biquad.getFrequencyResponse(freqs as any, magResponse as any, phaseResponse as any);
  return magResponse;
}

function computeFilterResponse(
  band: FilterBandParams, sampleRate: number, freqs: Float32Array
): Float32Array {
  const mag = computeBiquadResponse(
    band.type as BiquadFilterType, band.frequency, band.Q, band.gain,
    sampleRate, freqs
  );
  // For rolloff steeper than -12, cascade identical biquads
  const cascades = Math.abs(band.rolloff) / 12;
  if (cascades > 1) {
    for (let i = 0; i < mag.length; i++) {
      mag[i] = Math.pow(mag[i], cascades);
    }
  }
  return mag;
}

// ─── Frequency Response Graph ──────────────────────────────

function FilterResponseGraph({
  bands,
  selectedBand,
  onSelectBand,
}: {
  bands: FilterBandParams[];
  selectedBand: number;
  onSelectBand: (i: number) => void;
}) {
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

    const sampleRate = 48000;
    const fMin = 20;
    const fMax = 20000;
    const dbMin = -24;
    const dbMax = 24;
    const dbRange = dbMax - dbMin;
    const numPoints = Math.max(w, 200);

    // Generate log-spaced frequency array
    const freqs = new Float32Array(numPoints);
    const logMin = Math.log10(fMin);
    const logMax = Math.log10(fMax);
    for (let i = 0; i < numPoints; i++) {
      freqs[i] = Math.pow(10, logMin + (i / (numPoints - 1)) * (logMax - logMin));
    }

    const toX = (i: number) => (i / (numPoints - 1)) * w;
    const dbToY = (db: number) => h * (1 - (db - dbMin) / dbRange);
    const freqToX = (f: number) => {
      const logF = Math.log10(f);
      return ((logF - logMin) / (logMax - logMin)) * w;
    };

    // Compute per-band responses
    const bandMags: Float32Array[] = [];
    for (const band of bands) {
      bandMags.push(computeFilterResponse(band, sampleRate, freqs));
    }

    // Combined magnitude (multiply all)
    const combined = new Float32Array(numPoints).fill(1);
    for (const mag of bandMags) {
      for (let i = 0; i < numPoints; i++) combined[i] *= mag[i];
    }

    // ── Background
    ctx.fillStyle = "hsla(0, 0%, 5%, 0.95)";
    ctx.fillRect(0, 0, w, h);

    // ── Grid: frequency lines
    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.07)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "hsla(0, 0%, 100%, 0.18)";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";

    for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      const x = freqToX(f);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
      ctx.fillText(label, x, h - 2);
    }

    // ── Grid: dB lines
    ctx.textAlign = "right";
    for (let db = -24; db <= 24; db += 6) {
      const y = dbToY(db);
      ctx.strokeStyle = db === 0 ? "hsla(0, 0%, 100%, 0.15)" : "hsla(0, 0%, 100%, 0.05)";
      ctx.lineWidth = db === 0 ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      if (db % 12 === 0) {
        ctx.fillStyle = "hsla(0, 0%, 100%, 0.2)";
        ctx.fillText(`${db > 0 ? "+" : ""}${db}`, w - 2, y - 2);
      }
    }

    // ── Per-band curves (dimmed, non-selected bands first)
    for (let b = 0; b < 5; b++) {
      if (b === selectedBand) continue;
      const mag = bandMags[b];
      ctx.strokeStyle = BAND_COLORS_DIM[b];
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < numPoints; i++) {
        const x = toX(i);
        const db = 20 * Math.log10(Math.max(mag[i], 1e-6));
        const y = dbToY(db);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // ── Selected band curve (bright)
    {
      const mag = bandMags[selectedBand];
      ctx.strokeStyle = BAND_COLORS[selectedBand];
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < numPoints; i++) {
        const x = toX(i);
        const db = 20 * Math.log10(Math.max(mag[i], 1e-6));
        const y = dbToY(db);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // ── Combined curve (white)
    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < numPoints; i++) {
      const x = toX(i);
      const db = 20 * Math.log10(Math.max(combined[i], 1e-6));
      const y = dbToY(db);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill under combined curve (subtle)
    ctx.lineTo(w, dbToY(0));
    ctx.lineTo(0, dbToY(0));
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
    fillGrad.addColorStop(0, "hsla(0, 0%, 100%, 0.06)");
    fillGrad.addColorStop(0.5, "hsla(0, 0%, 100%, 0.0)");
    fillGrad.addColorStop(1, "hsla(0, 0%, 100%, 0.06)");
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // ── Band frequency markers
    for (let b = 0; b < 5; b++) {
      const band = bands[b];
      const x = freqToX(band.frequency);
      ctx.fillStyle = b === selectedBand ? BAND_COLORS[b] : BAND_COLORS_DIM[b];
      ctx.beginPath();
      ctx.arc(x, dbToY(0), b === selectedBand ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
      // Label
      ctx.fillStyle = BAND_COLORS[b];
      ctx.font = "bold 8px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${b + 1}`, x, 10);
    }
  }, [bands, selectedBand]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    const fMin = 20, fMax = 20000;
    const logMin = Math.log10(fMin), logMax = Math.log10(fMax);
    const clickFreq = Math.pow(10, logMin + (x / w) * (logMax - logMin));

    // Find closest band by frequency
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < bands.length; i++) {
      const dist = Math.abs(Math.log10(bands[i].frequency) - Math.log10(clickFreq));
      if (dist < minDist) { minDist = dist; closest = i; }
    }
    onSelectBand(closest);
  }, [bands, onSelectBand]);

  return (
    <div className="relative rounded-sm border border-border/40 overflow-hidden" style={{ height: 140 }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full cursor-crosshair"
        onClick={handleClick}
      />
    </div>
  );
}

// ─── Param slider (compact) ────────────────────────────────

function FltSlider({ label, value, min, max, step, unit, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-muted-foreground font-mono uppercase">{label}</span>
        <span className="text-[9px] text-foreground/70 font-mono tabular-nums">
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

// ─── Main FilterPanel ──────────────────────────────────────

export function FilterPanel({ isRu, disabled }: { isRu: boolean; disabled: boolean }) {
  const engine = getAudioEngine();
  const [bands, setBands] = useState<FilterBandParams[]>(() => engine.getMasterFilterBands());
  const [selected, setSelected] = useState(0);

  const band = bands[selected];

  const updateBand = useCallback((params: Partial<FilterBandParams>) => {
    setBands(prev => {
      const next = [...prev];
      next[selected] = { ...next[selected], ...params };
      return next;
    });
    engine.setMasterFilterBand(selected, params);
  }, [selected, engine]);

  return (
    <div className="flex flex-col gap-2">
      {/* Frequency response graph */}
      <FilterResponseGraph bands={bands} selectedBand={selected} onSelectBand={setSelected} />

      {/* Band selector */}
      <div className="flex items-center gap-1">
        {bands.map((b, i) => (
          <button
            key={i}
            onClick={() => setSelected(i)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold leading-none transition-colors ${
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
        <span className="ml-auto text-[9px] text-muted-foreground/50 font-mono">
          {TYPE_LABELS[band.type]} {band.frequency >= 1000 ? `${(band.frequency / 1000).toFixed(1)}k` : band.frequency}Hz
        </span>
      </div>

      {/* Controls for selected band */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <LogFreqSlider
          label={isRu ? "Частота" : "Freq"}
          value={band.frequency} min={20} max={20000}
          onChange={v => updateBand({ frequency: v })} disabled={disabled}
        />
        <div className="flex flex-col gap-0">
          <span className="text-[9px] text-muted-foreground font-mono uppercase">
            {isRu ? "Тип" : "Type"}
          </span>
          <select
            value={band.type}
            onChange={e => updateBand({ type: e.target.value as FilterType })}
            disabled={disabled}
            className="h-5 bg-background border border-border/60 rounded text-[9px] font-mono text-foreground/80 px-1 disabled:opacity-30"
          >
            {FILTER_TYPES.map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t]} — {t}</option>
            ))}
          </select>
        </div>
        <FltSlider
          label="Q"
          value={band.Q} min={0.1} max={20} step={0.1}
          onChange={v => updateBand({ Q: v })} disabled={disabled}
        />
        <FltSlider
          label={isRu ? "Усил." : "Gain"}
          value={band.gain} min={-24} max={24} step={0.5} unit=" dB"
          onChange={v => updateBand({ gain: v })} disabled={disabled}
        />
        <div className="flex flex-col gap-0">
          <span className="text-[9px] text-muted-foreground font-mono uppercase">
            {isRu ? "Крутизна" : "Rolloff"}
          </span>
          <select
            value={band.rolloff}
            onChange={e => updateBand({ rolloff: Number(e.target.value) as FilterRolloff })}
            disabled={disabled}
            className="h-5 bg-background border border-border/60 rounded text-[9px] font-mono text-foreground/80 px-1 disabled:opacity-30"
          >
            {ROLLOFFS.map(r => (
              <option key={r} value={r}>{r} dB/oct</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
