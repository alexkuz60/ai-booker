import { useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

export function LimiterGraph({ threshold, className }: { threshold: number; className?: string }) {
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

    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.12)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(toX(dbMin), toY(dbMin)); ctx.lineTo(toX(dbMax), toY(dbMax)); ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "hsla(0, 70%, 55%, 0.3)";
    ctx.setLineDash([2, 2]);
    const ty = toY(threshold);
    ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(w, ty); ctx.stroke();
    ctx.setLineDash([]);

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
