/**
 * ChannelPluginsPanel — PRE (EQ + Compressor) side-by-side and POST (Limiter) below.
 * EQ: 3-band frequency response graph (LPF, BPF, HPF).
 * Compressor: Knee/transfer graph + compact sliders.
 * Limiter: Transfer graph + threshold slider.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { getAudioEngine } from "@/lib/audioEngine";
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

// ─── EQ Frequency Response Graph ────────────────────────────

function EqGraph({ low, mid, high }: { low: number; mid: number; high: number }) {
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

    const dbMin = -14;
    const dbMax = 14;
    const range = dbMax - dbMin;

    // Freq range: 20 Hz – 20 kHz (log scale)
    const fMin = 20;
    const fMax = 20000;
    const logMin = Math.log10(fMin);
    const logMax = Math.log10(fMax);

    const toX = (f: number) => ((Math.log10(f) - logMin) / (logMax - logMin)) * w;
    const toY = (db: number) => h - ((db - dbMin) / range) * h;

    // Background
    ctx.fillStyle = "hsla(0, 0%, 5%, 0.95)";
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.07)";
    ctx.lineWidth = 1;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = toX(f);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let db = -12; db <= 12; db += 6) {
      const y = toY(db);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Freq labels
    ctx.fillStyle = "hsla(0, 0%, 100%, 0.2)";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    for (const [f, lbl] of [[100, "100"], [1000, "1k"], [10000, "10k"]] as [number, string][]) {
      ctx.fillText(lbl, toX(f), h - 2);
    }
    // dB labels
    ctx.textAlign = "right";
    for (const db of [-12, -6, 0, 6, 12]) {
      ctx.fillText(`${db > 0 ? "+" : ""}${db}`, w - 2, toY(db) + 3);
    }

    // Zero line
    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.15)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, toY(0)); ctx.lineTo(w, toY(0)); ctx.stroke();
    ctx.setLineDash([]);

    // EQ3 crossover frequencies (approximate Tone.EQ3 defaults)
    const lowFreq = 400;   // LPF shelf center
    const highFreq = 2500; // HPF shelf center

    // Compute per-band response at each frequency point
    const N = w;
    const combined = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      const norm = i / (N - 1);
      const freq = Math.pow(10, logMin + norm * (logMax - logMin));

      // Simple shelf model: low shelf, mid bell, high shelf
      // Low shelf: full below lowFreq, rolls off above
      const lowResp = low / (1 + Math.pow(freq / lowFreq, 2));
      // High shelf: full above highFreq, rolls off below
      const highResp = high / (1 + Math.pow(highFreq / freq, 2));
      // Mid: bell around geometric mean
      const midFreq = Math.sqrt(lowFreq * highFreq);
      const midQ = 1.2;
      const midResp = mid / (1 + Math.pow((freq / midFreq - midFreq / freq) * midQ, 2));

      combined[i] = lowResp + midResp + highResp;
    }

    // Draw individual band curves
    const bandConfigs = [
      { data: (i: number) => { const f = Math.pow(10, logMin + (i / (N-1)) * (logMax - logMin)); return low / (1 + Math.pow(f / lowFreq, 2)); }, color: "hsla(200, 70%, 55%, 0.4)", label: "LPF" },
      { data: (i: number) => { const f = Math.pow(10, logMin + (i / (N-1)) * (logMax - logMin)); const mf = Math.sqrt(lowFreq * highFreq); return mid / (1 + Math.pow((f / mf - mf / f) * 1.2, 2)); }, color: "hsla(50, 70%, 55%, 0.4)", label: "BPF" },
      { data: (i: number) => { const f = Math.pow(10, logMin + (i / (N-1)) * (logMax - logMin)); return high / (1 + Math.pow(highFreq / f, 2)); }, color: "hsla(340, 70%, 55%, 0.4)", label: "HPF" },
    ];

    for (const band of bandConfigs) {
      ctx.strokeStyle = band.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        const y = toY(band.data(i));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Draw combined curve
    ctx.strokeStyle = "hsl(200, 70%, 60%)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w;
      const y = toY(combined[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill under combined
    ctx.lineTo(w, toY(0));
    ctx.lineTo(0, toY(0));
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "hsla(200, 70%, 55%, 0.12)");
    grad.addColorStop(0.5, "hsla(200, 70%, 55%, 0.03)");
    grad.addColorStop(1, "hsla(200, 70%, 55%, 0.12)");
    ctx.fillStyle = grad;
    ctx.fill();

  }, [low, mid, high]);

  return (
    <div className="relative rounded-sm border border-border/40 overflow-hidden w-full" style={{ aspectRatio: "2.2" }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
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

    const computeOut = (input: number): number => {
      const halfKnee = knee / 2;
      if (input <= threshold - halfKnee) return input;
      if (input >= threshold + halfKnee) return threshold + (input - threshold) / ratio;
      const x = input - threshold + halfKnee;
      return input + ((1 / ratio - 1) * x * x) / (2 * knee);
    };

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

    // Unity line
    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.12)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(toX(dbMin), toY(dbMin)); ctx.lineTo(toX(dbMax), toY(dbMax)); ctx.stroke();
    ctx.setLineDash([]);

    // Threshold line
    ctx.strokeStyle = "hsla(50, 80%, 50%, 0.3)";
    ctx.setLineDash([2, 2]);
    const tx = toX(threshold);
    ctx.beginPath(); ctx.moveTo(tx, 0); ctx.lineTo(tx, h); ctx.stroke();
    ctx.setLineDash([]);

    // Transfer curve
    ctx.strokeStyle = "hsl(140, 70%, 55%)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= w; i++) {
      const inputDb = dbMin + (i / w) * range;
      const x = toX(inputDb);
      const y = toY(computeOut(inputDb));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill
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
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`T: ${threshold} dB`, tx + 2, 10);
  }, [threshold, ratio, knee]);

  return (
    <div className="relative rounded-sm border border-border/40 overflow-hidden w-full" style={{ aspectRatio: "1" }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}

// ─── Limiter Graph ──────────────────────────────────────────

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
    const computeOut = (input: number): number => input <= threshold ? input : threshold;

    ctx.fillStyle = "hsla(0, 0%, 5%, 0.95)";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.07)";
    ctx.lineWidth = 1;
    for (let db = -48; db <= 0; db += 12) {
      const x = toX(db); const y = toY(db);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Unity
    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.12)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(toX(dbMin), toY(dbMin)); ctx.lineTo(toX(dbMax), toY(dbMax)); ctx.stroke();
    ctx.setLineDash([]);

    // Threshold
    ctx.strokeStyle = "hsla(0, 70%, 55%, 0.3)";
    ctx.setLineDash([2, 2]);
    const ty = toY(threshold);
    ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(w, ty); ctx.stroke();
    ctx.setLineDash([]);

    // Curve
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

    ctx.lineTo(toX(dbMax), toY(dbMin));
    ctx.lineTo(toX(dbMin), toY(dbMin));
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
    fillGrad.addColorStop(0, "hsla(0, 70%, 50%, 0.15)");
    fillGrad.addColorStop(1, "hsla(0, 70%, 50%, 0.02)");
    ctx.fillStyle = fillGrad;
    ctx.fill();

    ctx.fillStyle = "hsla(0, 70%, 65%, 0.8)";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`T: ${threshold} dB`, 3, ty - 3);
  }, [threshold]);

  return (
    <div className="relative rounded-sm border border-border/40 overflow-hidden w-full" style={{ aspectRatio: "1" }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────

interface ChannelPluginsPanelProps {
  isRu: boolean;
  trackId: string | null;
  trackLabel?: string;
  trackColor?: string;
  onMixChange?: () => void;
}

export function ChannelPluginsPanel({ isRu, trackId, trackLabel, trackColor, onMixChange }: ChannelPluginsPanelProps) {
  const engine = getAudioEngine();

  // ── State ──
  const [eqLow, setEqLow] = useState(0);
  const [eqMid, setEqMid] = useState(0);
  const [eqHigh, setEqHigh] = useState(0);

  const [compThreshold, setCompThreshold] = useState(-24);
  const [compRatio, setCompRatio] = useState(3);
  const [compKnee, setCompKnee] = useState(10);
  const [compAttack, setCompAttack] = useState(0.01);
  const [compRelease, setCompRelease] = useState(0.1);

  const [limThreshold, setLimThreshold] = useState(-3);

  const [bypasses, setBypasses] = useState({ eq: true, comp: true, limiter: true });

  // ── Sync from engine ──
  useEffect(() => {
    if (!trackId) return;
    const sync = () => {
      const ms = engine.getTrackMixState(trackId);
      if (!ms) return;
      setEqLow(ms.eq.low); setEqMid(ms.eq.mid); setEqHigh(ms.eq.high);
      setCompThreshold(ms.comp.threshold); setCompRatio(ms.comp.ratio);
      setCompKnee(ms.comp.knee); setCompAttack(ms.comp.attack); setCompRelease(ms.comp.release);
      setLimThreshold(ms.limiter.threshold);
      setBypasses({ eq: ms.eq.bypassed, comp: ms.comp.bypassed, limiter: ms.limiter.bypassed });
    };
    sync();
    const iv = setInterval(sync, 500);
    return () => clearInterval(iv);
  }, [trackId, engine]);

  const toggleBypass = useCallback((section: "eq" | "comp" | "limiter") => {
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

  return (
    <div className="flex flex-col h-full px-3 py-2">
      {/* Header: Track label + PRE badge */}
      <div className="flex items-center gap-2 shrink-0 pb-2 border-b border-border/30 mb-2">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor ?? "hsl(var(--primary))" }} />
        <span className="text-[10px] font-mono text-foreground/80 uppercase tracking-wider truncate">
          {trackLabel ?? trackId}
        </span>
        <span className="text-[8px] font-mono text-muted-foreground/40 uppercase ml-auto">
          {isRu ? "Канальные плагины · PRE → POST" : "Channel Plugins · PRE → POST"}
        </span>
      </div>

      {/* Plugin columns — stretch to bottom */}
      <div className="flex gap-4 flex-1 min-h-0 overflow-auto divide-x divide-border/40">
        {/* ── EQ Column ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
              {isRu ? "3-полосный EQ" : "3-Band EQ"}
            </span>
            <BypassButton label="EQ" bypassed={bypasses.eq} onToggle={() => toggleBypass("eq")} />
          </div>
          <div className="flex gap-2 items-start">
            <div className="flex-1 min-w-0">
              <EqGraph low={bypasses.eq ? 0 : eqLow} mid={bypasses.eq ? 0 : eqMid} high={bypasses.eq ? 0 : eqHigh} />
            </div>
            <div className="flex flex-col gap-1.5 shrink-0" style={{ width: 100 }}>
              <ParamSlider label="Low" value={eqLow} min={-12} max={12} step={0.5} unit=" dB"
                onChange={v => { setEqLow(v); engine.setTrackEqLow(trackId, v); onMixChange?.(); }} disabled={bypasses.eq} />
              <ParamSlider label="Mid" value={eqMid} min={-12} max={12} step={0.5} unit=" dB"
                onChange={v => { setEqMid(v); engine.setTrackEqMid(trackId, v); onMixChange?.(); }} disabled={bypasses.eq} />
              <ParamSlider label="High" value={eqHigh} min={-12} max={12} step={0.5} unit=" dB"
                onChange={v => { setEqHigh(v); engine.setTrackEqHigh(trackId, v); onMixChange?.(); }} disabled={bypasses.eq} />
            </div>
          </div>
        </div>

        {/* ── Compressor Column ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-2 pl-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
              {isRu ? "Компрессор" : "Compressor"}
            </span>
            <BypassButton label="CMP" bypassed={bypasses.comp} onToggle={() => toggleBypass("comp")} />
          </div>
          <div className="flex gap-2 items-start">
            <div className="flex-1 min-w-0">
              <KneeGraph threshold={compThreshold} ratio={compRatio} knee={compKnee} />
            </div>
            <div className="flex flex-col gap-1.5 shrink-0" style={{ width: 100 }}>
              <ParamSlider label={isRu ? "Порог" : "Threshold"} value={compThreshold} min={-60} max={0} step={1} unit=" dB"
                onChange={v => { setCompThreshold(v); engine.setTrackCompThreshold(trackId, v); onMixChange?.(); }} disabled={bypasses.comp} />
              <ParamSlider label={isRu ? "Соотн." : "Ratio"} value={compRatio} min={1} max={20} step={0.5} unit=":1"
                onChange={v => { setCompRatio(v); engine.setTrackCompRatio(trackId, v); onMixChange?.(); }} disabled={bypasses.comp} />
              <ParamSlider label="Knee" value={compKnee} min={0} max={30} step={1} unit=" dB"
                onChange={v => { setCompKnee(v); engine.setTrackCompKnee(trackId, v); onMixChange?.(); }} disabled={bypasses.comp} />
              <ParamSlider label={isRu ? "Атака" : "Attack"} value={compAttack} min={0.001} max={0.5} step={0.001} unit=" s"
                onChange={v => { setCompAttack(v); engine.setTrackCompAttack(trackId, v); onMixChange?.(); }} disabled={bypasses.comp} />
              <ParamSlider label={isRu ? "Восст." : "Release"} value={compRelease} min={0.01} max={1.0} step={0.01} unit=" s"
                onChange={v => { setCompRelease(v); engine.setTrackCompRelease(trackId, v); onMixChange?.(); }} disabled={bypasses.comp} />
            </div>
          </div>
        </div>

        {/* ── Limiter Column (POST) ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-2 pl-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
              {isRu ? "Лимитер" : "Limiter"}
            </span>
            <BypassButton label="LIM" bypassed={bypasses.limiter} onToggle={() => toggleBypass("limiter")} />
          </div>
          <div className="flex gap-2 items-start">
            <div className="flex-1 min-w-0">
              <LimiterGraph threshold={bypasses.limiter ? 0 : limThreshold} />
            </div>
            <div className="flex flex-col gap-1.5 shrink-0" style={{ width: 100 }}>
              <ParamSlider label={isRu ? "Порог" : "Threshold"} value={limThreshold} min={-30} max={0} step={0.5} unit=" dB"
                onChange={v => { setLimThreshold(v); engine.setTrackLimiterThreshold(trackId, v); onMixChange?.(); }} disabled={bypasses.limiter} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
