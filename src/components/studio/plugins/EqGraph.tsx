import { useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

export function EqGraph({ low, mid, high, className }: { low: number; mid: number; high: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
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

    const fMin = 20;
    const fMax = 20000;
    const logMin = Math.log10(fMin);
    const logMax = Math.log10(fMax);

    const toX = (f: number) => ((Math.log10(f) - logMin) / (logMax - logMin)) * w;
    const toY = (db: number) => h - ((db - dbMin) / range) * h;

    ctx.fillStyle = "hsla(0, 0%, 5%, 0.95)";
    ctx.fillRect(0, 0, w, h);

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

    ctx.fillStyle = "hsla(0, 0%, 100%, 0.2)";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    for (const [f, lbl] of [[100, "100"], [1000, "1k"], [10000, "10k"]] as [number, string][]) {
      ctx.fillText(lbl, toX(f), h - 2);
    }
    ctx.textAlign = "right";
    for (const db of [-12, -6, 0, 6, 12]) {
      ctx.fillText(`${db > 0 ? "+" : ""}${db}`, w - 2, toY(db) + 3);
    }

    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.15)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, toY(0)); ctx.lineTo(w, toY(0)); ctx.stroke();
    ctx.setLineDash([]);

    const lowFreq = 400;
    const highFreq = 2500;

    const N = w;
    const combined = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      const norm = i / (N - 1);
      const freq = Math.pow(10, logMin + norm * (logMax - logMin));
      const lowResp = low / (1 + Math.pow(freq / lowFreq, 2));
      const highResp = high / (1 + Math.pow(highFreq / freq, 2));
      const midFreq = Math.sqrt(lowFreq * highFreq);
      const midQ = 1.2;
      const midResp = mid / (1 + Math.pow((freq / midFreq - midFreq / freq) * midQ, 2));
      combined[i] = lowResp + midResp + highResp;
    }

    const bandConfigs = [
      { data: (i: number) => { const f = Math.pow(10, logMin + (i / (N-1)) * (logMax - logMin)); return low / (1 + Math.pow(f / lowFreq, 2)); }, color: "hsla(200, 70%, 55%, 0.4)" },
      { data: (i: number) => { const f = Math.pow(10, logMin + (i / (N-1)) * (logMax - logMin)); const mf = Math.sqrt(lowFreq * highFreq); return mid / (1 + Math.pow((f / mf - mf / f) * 1.2, 2)); }, color: "hsla(50, 70%, 55%, 0.4)" },
      { data: (i: number) => { const f = Math.pow(10, logMin + (i / (N-1)) * (logMax - logMin)); return high / (1 + Math.pow(highFreq / f, 2)); }, color: "hsla(340, 70%, 55%, 0.4)" },
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

    ctx.strokeStyle = "hsl(200, 70%, 60%)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w;
      const y = toY(combined[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

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

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas.parentElement!);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <div className={cn("relative rounded-sm border border-border/40 overflow-hidden w-full", className)}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
