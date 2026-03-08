import { useRef, useEffect } from "react";
import { getAudioEngine } from "@/lib/audioEngine";

function dbToLinear(db: number): number {
  if (db <= -60) return 0;
  if (db >= 0) return 1;
  return Math.pow(10, db / 20);
}

export function TimelineMasterMeter() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = getAudioEngine();
  const meterRef = useRef({ levelL: -60, levelR: -60 });

  useEffect(() => {
    let raf: number;
    const draw = () => {
      meterRef.current = engine.getMasterMeter();
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
        ctx.scale(dpr, dpr);
      }

      ctx.clearRect(0, 0, w, h);

      const linL = dbToLinear(meterRef.current.levelL);
      const linR = dbToLinear(meterRef.current.levelR);
      const barH = (h - 2) / 2;
      const gap = 2;

      const wL = linL * w;
      const gradL = ctx.createLinearGradient(0, 0, w, 0);
      gradL.addColorStop(0, "hsl(140 60% 50%)");
      gradL.addColorStop(0.7, "hsl(50 80% 55%)");
      gradL.addColorStop(1, "hsl(0 70% 55%)");
      ctx.fillStyle = gradL;
      ctx.fillRect(0, 0, wL, barH);

      const wR = linR * w;
      ctx.fillStyle = gradL;
      ctx.fillRect(0, barH + gap, wR, barH);

      ctx.fillStyle = "hsla(0,0%,50%,0.15)";
      ctx.fillRect(wL, 0, w - wL, barH);
      ctx.fillRect(wR, barH + gap, w - wR, barH);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return (
    <canvas
      ref={canvasRef}
      className="h-3.5 w-[48px] rounded-sm shrink-0 ml-1"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
