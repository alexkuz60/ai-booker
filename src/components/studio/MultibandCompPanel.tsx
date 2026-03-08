/**
 * MultibandCompPanel — 3-band multiband dynamic compressor UI with interactive graph + controls.
 * Layout: graph left (showing 3 band transfer curves + crossover points), controls right.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getAudioEngine, MultibandCompParams, MultibandCompBandParams } from "@/lib/audioEngine";

// ─── Band colors & labels ───────────────────────────────────

const BAND_COLORS = ["hsl(200, 70%, 55%)", "hsl(140, 70%, 50%)", "hsl(25, 80%, 55%)"];
const BAND_COLORS_DIM = ["hsla(200, 70%, 55%, 0.25)", "hsla(140, 70%, 50%, 0.25)", "hsla(25, 80%, 55%, 0.25)"];
const BAND_KEYS = ["low", "mid", "high"] as const;
const BAND_LABELS = { low: "LOW", mid: "MID", high: "HIGH" };

// ─── Graph constants ────────────────────────────────────────

const F_MIN = 20, F_MAX = 20000;
const DB_MIN = -60, DB_MAX = 0, DB_RANGE = DB_MAX - DB_MIN;
const LOG_MIN = Math.log10(F_MIN), LOG_MAX = Math.log10(F_MAX);

function freqToNorm(f: number) { return (Math.log10(f) - LOG_MIN) / (LOG_MAX - LOG_MIN); }
function normToFreq(n: number) { return Math.pow(10, LOG_MIN + n * (LOG_MAX - LOG_MIN)); }

// ─── Interactive Multiband Graph ────────────────────────────

function MultibandGraph({
  params, selectedBand, onSelectBand, onDragCrossover,
}: {
  params: MultibandCompParams;
  selectedBand: number;
  onSelectBand: (i: number) => void;
  onDragCrossover: (which: "low" | "high", freq: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<{ which: "low" | "high" } | null>(null);

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

    const fToX = (f: number) => freqToNorm(f) * w;
    const dbToY = (db: number) => h - ((db - DB_MIN) / DB_RANGE) * h;

    const computeOut = (input: number, band: MultibandCompBandParams): number => {
      const halfKnee = band.knee / 2;
      if (input <= band.threshold - halfKnee) return input;
      if (input >= band.threshold + halfKnee) return band.threshold + (input - band.threshold) / band.ratio;
      const x = input - band.threshold + halfKnee;
      return input + ((1 / band.ratio - 1) * x * x) / (2 * band.knee);
    };

    // Background
    ctx.fillStyle = "hsla(0, 0%, 5%, 0.95)";
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.07)"; ctx.lineWidth = 1;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = fToX(f);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let db = -48; db <= 0; db += 12) {
      const y = dbToY(db);
      ctx.strokeStyle = db === 0 ? "hsla(0, 0%, 100%, 0.15)" : "hsla(0, 0%, 100%, 0.05)";
      ctx.lineWidth = db === 0 ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // dB labels
    ctx.fillStyle = "hsla(0, 0%, 100%, 0.2)"; ctx.font = "9px monospace"; ctx.textAlign = "right";
    for (let db = -48; db <= 0; db += 12) {
      ctx.fillText(`${db}`, w - 3, dbToY(db) + 3);
    }

    // Unity line (1:1)
    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.1)"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, dbToY(DB_MIN)); ctx.lineTo(w, dbToY(DB_MAX)); ctx.stroke();
    ctx.setLineDash([]);

    // Crossover lines
    const crossovers = [params.lowFrequency, params.highFrequency];
    const crossoverColors = ["hsla(200, 60%, 60%, 0.6)", "hsla(25, 70%, 60%, 0.6)"];
    for (let c = 0; c < 2; c++) {
      const x = fToX(crossovers[c]);
      ctx.strokeStyle = crossoverColors[c]; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.setLineDash([]);
      // Crossover handle
      ctx.fillStyle = crossoverColors[c];
      ctx.beginPath(); ctx.arc(x, h / 2, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "hsla(0, 0%, 100%, 0.4)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, h / 2, 5, 0, Math.PI * 2); ctx.stroke();
    }

    // Band regions + transfer curves
    const bandDefs: { key: typeof BAND_KEYS[number]; startFreq: number; endFreq: number }[] = [
      { key: "low", startFreq: F_MIN, endFreq: params.lowFrequency },
      { key: "mid", startFreq: params.lowFrequency, endFreq: params.highFrequency },
      { key: "high", startFreq: params.highFrequency, endFreq: F_MAX },
    ];

    for (let b = 0; b < 3; b++) {
      const def = bandDefs[b];
      const bandParams = params[def.key];
      const isSel = b === selectedBand;
      const color = isSel ? BAND_COLORS[b] : BAND_COLORS_DIM[b];

      // Band region fill
      const x1 = fToX(def.startFreq);
      const x2 = fToX(def.endFreq);
      ctx.fillStyle = isSel ? `${BAND_COLORS[b].replace(")", ", 0.08)")}` : `${BAND_COLORS[b].replace(")", ", 0.03)")}`;
      ctx.fillRect(x1, 0, x2 - x1, h);

      // Transfer curve within band region
      ctx.strokeStyle = color; ctx.lineWidth = isSel ? 2 : 1; ctx.beginPath();
      const steps = Math.max(50, Math.round(x2 - x1));
      for (let i = 0; i <= steps; i++) {
        const inputDb = DB_MIN + (i / steps) * DB_RANGE;
        const outputDb = computeOut(inputDb, bandParams);
        const x = x1 + (i / steps) * (x2 - x1);
        const y = dbToY(outputDb);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Threshold marker within band
      const tx = (x1 + x2) / 2;
      const ty = dbToY(bandParams.threshold);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(tx, ty, isSel ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
      if (isSel) {
        ctx.fillStyle = BAND_COLORS_DIM[b];
        ctx.beginPath(); ctx.arc(tx, ty, 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = BAND_COLORS[b];
        ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI * 2); ctx.fill();
      }

      // Band label
      ctx.fillStyle = color; ctx.font = "bold 10px monospace"; ctx.textAlign = "center";
      ctx.fillText(BAND_LABELS[def.key], (x1 + x2) / 2, 13);
    }
  }, [params, selectedBand]);

  // Pointer handlers
  const getFreq = useCallback((e: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return 1000;
    const rect = canvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return Math.round(Math.max(F_MIN, Math.min(F_MAX, normToFreq(nx))));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;

    // Check if near a crossover handle
    const lowX = freqToNorm(params.lowFrequency) * rect.width;
    const highX = freqToNorm(params.highFrequency) * rect.width;
    if (Math.abs(mx - lowX) < 15) {
      dragging.current = { which: "low" };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault(); return;
    }
    if (Math.abs(mx - highX) < 15) {
      dragging.current = { which: "high" };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault(); return;
    }

    // Select band by click region
    const nx = mx / rect.width;
    const lowNorm = freqToNorm(params.lowFrequency);
    const highNorm = freqToNorm(params.highFrequency);
    if (nx < lowNorm) onSelectBand(0);
    else if (nx < highNorm) onSelectBand(1);
    else onSelectBand(2);
  }, [params, onSelectBand]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current) {
      // Cursor hint
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const lowX = freqToNorm(params.lowFrequency) * rect.width;
      const highX = freqToNorm(params.highFrequency) * rect.width;
      canvas.style.cursor = (Math.abs(mx - lowX) < 15 || Math.abs(mx - highX) < 15) ? "ew-resize" : "crosshair";
      return;
    }
    const freq = getFreq(e);
    onDragCrossover(dragging.current.which, freq);
  }, [params, getFreq, onDragCrossover]);

  const handlePointerUp = useCallback(() => { dragging.current = null; }, []);

  return (
    <div className="flex flex-col flex-1 min-w-0">
      <div className="relative rounded-sm border border-border/40 overflow-hidden flex-1 min-w-0" style={{ minHeight: 130 }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>
      {/* Frequency scale below graph */}
      <div className="relative w-full h-4 shrink-0">
        {[50, 100, 200, 500, 1000, 2000, 5000, 10000].map(f => (
          <span
            key={f}
            className="absolute text-[9px] font-mono text-muted-foreground/50 -translate-x-1/2"
            style={{ left: `${freqToNorm(f) * 100}%`, top: 1 }}
          >
            {f >= 1000 ? `${f / 1000}k` : f}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Param slider (shared style) ───────────────────────────

function MBCSlider({ label, value, min, max, step, unit, onChange, disabled }: {
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

// ─── Main panel ─────────────────────────────────────────────

export function MultibandCompPanel({ isRu, disabled }: { isRu: boolean; disabled: boolean }) {
  const engine = getAudioEngine();
  const [params, setParams] = useState<MultibandCompParams>(() => engine.getMasterMBCParams());
  const [selected, setSelected] = useState(0);
  const bandKey = BAND_KEYS[selected];
  const band = params[bandKey];

  const updateBand = useCallback((key: typeof BAND_KEYS[number], p: Partial<MultibandCompBandParams>) => {
    setParams(prev => ({
      ...prev,
      [key]: { ...prev[key], ...p },
    }));
    engine.setMasterMBCBand(key, p);
  }, [engine]);

  const updateCrossover = useCallback((which: "low" | "high", freq: number) => {
    setParams(prev => {
      // Ensure low < high with minimum 50Hz gap
      let lowF = which === "low" ? freq : prev.lowFrequency;
      let highF = which === "high" ? freq : prev.highFrequency;
      if (lowF >= highF - 50) {
        if (which === "low") lowF = highF - 50;
        else highF = lowF + 50;
      }
      lowF = Math.max(40, Math.min(lowF, 5000));
      highF = Math.max(200, Math.min(highF, 18000));
      engine.setMasterMBCCrossover(lowF, highF);
      return { ...prev, lowFrequency: lowF, highFrequency: highF };
    });
  }, [engine]);

  const handleDragCrossover = useCallback((which: "low" | "high", freq: number) => {
    updateCrossover(which, freq);
  }, [updateCrossover]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3">
        {/* Graph */}
        <MultibandGraph
          params={params}
          selectedBand={selected}
          onSelectBand={setSelected}
          onDragCrossover={handleDragCrossover}
        />

        {/* Controls column */}
        <div className="flex flex-col gap-1.5 w-[160px] shrink-0">
          {/* Band selector */}
          <div className="flex items-center gap-0.5">
            {BAND_KEYS.map((key, i) => (
              <button
                key={key}
                onClick={() => setSelected(i)}
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold leading-none transition-colors ${
                  i === selected
                    ? "bg-primary/20 text-primary"
                    : "text-foreground/40 hover:text-foreground/60"
                }`}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: BAND_COLORS[i] }}
                />
                {BAND_LABELS[key]}
              </button>
            ))}
          </div>

          {/* Crossover frequencies */}
          <LogFreqSlider
            label={isRu ? "Кросс. L→M" : "X-over L→M"}
            value={params.lowFrequency} min={40} max={5000}
            onChange={v => updateCrossover("low", v)} disabled={disabled}
          />
          <LogFreqSlider
            label={isRu ? "Кросс. M→H" : "X-over M→H"}
            value={params.highFrequency} min={200} max={18000}
            onChange={v => updateCrossover("high", v)} disabled={disabled}
          />

          {/* Separator */}
          <div className="h-px bg-border/40 my-0.5" />

          {/* Per-band params */}
          <MBCSlider
            label={isRu ? "Порог" : "Threshold"}
            value={band.threshold} min={-60} max={0} step={1} unit=" dB"
            onChange={v => updateBand(bandKey, { threshold: v })} disabled={disabled}
          />
          <MBCSlider
            label={isRu ? "Соотн." : "Ratio"}
            value={band.ratio} min={1} max={20} step={0.5} unit=":1"
            onChange={v => updateBand(bandKey, { ratio: v })} disabled={disabled}
          />
          <MBCSlider
            label="Knee"
            value={band.knee} min={0} max={30} step={1} unit=" dB"
            onChange={v => updateBand(bandKey, { knee: v })} disabled={disabled}
          />
          <MBCSlider
            label={isRu ? "Атака" : "Attack"}
            value={band.attack} min={0.001} max={0.5} step={0.001} unit=" s"
            onChange={v => updateBand(bandKey, { attack: v })} disabled={disabled}
          />
          <MBCSlider
            label={isRu ? "Восст." : "Release"}
            value={band.release} min={0.01} max={1.0} step={0.01} unit=" s"
            onChange={v => updateBand(bandKey, { release: v })} disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
