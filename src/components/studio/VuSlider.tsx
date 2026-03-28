/**
 * VuSlider — horizontal slider with dynamic VU-meter background.
 *
 * Modes:
 *   "volume" — single meter bar from left, slider on top
 *   "pan"    — split L/R meter bars from center
 */

import { useRef, useEffect, useCallback, useState } from "react";
import * as Tone from "tone";

interface VuSliderProps {
  mode: "volume" | "pan";
  /** Current slider value: 0-100 for volume, -100..100 for pan */
  value: number;
  /** Meter level(s) in dB. Volume: single number. Pan: [L, R] */
  meterDb: number | [number, number];
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}

const SLIDER_H = 18;
const THUMB_W = 8;

/** Map dB to 0..1 linear for display (-60dB = 0, 0dB = 1) */
function dbToLinear(db: number): number {
  if (db <= -60) return 0;
  if (db >= 0) return 1;
  return (db + 60) / 60;
}

/** Convert volume 0–100 to dB string */
function volumeToDb(v: number): string {
  if (v <= 0) return "-∞ dB";
  return `${Tone.gainToDb(v / 100).toFixed(1)} dB`;
}

export function VuSlider({
  mode,
  value,
  meterDb,
  onChange,
  disabled = false,
  className = "",
  label,
}: VuSliderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  
  const smoothedRef = useRef<{ l: number; r: number }>({ l: 0, r: 0 });

  // Store meterDb in a ref so the draw loop doesn't need to restart on every change
  const meterDbRef = useRef(meterDb);
  meterDbRef.current = meterDb;

  // Stable draw function that reads meterDb from ref
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, w, h);

    const currentMeterDb = meterDbRef.current;
    let mL: number, mR: number;
    if (Array.isArray(currentMeterDb)) {
      mL = dbToLinear(currentMeterDb[0]);
      mR = dbToLinear(currentMeterDb[1]);
    } else {
      mL = mR = dbToLinear(currentMeterDb);
    }

    const alpha = 0.3;
    smoothedRef.current.l += (mL - smoothedRef.current.l) * alpha;
    smoothedRef.current.r += (mR - smoothedRef.current.r) * alpha;
    const sL = smoothedRef.current.l;
    const sR = smoothedRef.current.r;

    const radius = 3 * dpr;

    if (mode === "volume") {
      const meterW = sL * w;
      if (meterW > 0) {
        ctx.fillStyle = "hsla(142, 50%, 50%, 0.35)";
        ctx.beginPath();
        ctx.roundRect(0, 0, meterW, h, radius);
        ctx.fill();
      }
    } else {
      const cx = w / 2;
      const barL = sL * cx;
      const barR = sR * cx;

      if (barL > 0) {
        ctx.fillStyle = "hsla(200, 60%, 50%, 0.35)";
        ctx.beginPath();
        ctx.roundRect(cx - barL, 0, barL, h, radius);
        ctx.fill();
      }
      if (barR > 0) {
        ctx.fillStyle = "hsla(350, 60%, 50%, 0.35)";
        ctx.beginPath();
        ctx.roundRect(cx, 0, barR, h, radius);
        ctx.fill();
      }

      // Center line — light red
      ctx.fillStyle = "hsla(0, 70%, 65%, 0.6)";
      ctx.fillRect(cx - 0.5 * dpr, 0, 1 * dpr, h);
    }
  }, [mode]); // only depends on mode, reads meterDb from ref

  // Stable draw loop — doesn't restart when meterDb changes
  useEffect(() => {
    let running = true;
    const interval = setInterval(() => {
      if (running) draw();
    }, 33);
    return () => {
      running = false;
      clearInterval(interval);
    };
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = container.clientWidth * dpr;
      canvas.height = SLIDER_H * dpr;
      canvas.style.width = `${container.clientWidth}px`;
      canvas.style.height = `${SLIDER_H}px`;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const getValueFromX = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return value;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      if (mode === "volume") return Math.round(ratio * 100);
      return Math.round((ratio * 200) - 100);
    },
    [mode, value]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      dragging.current = true;
      setIsDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      onChange(getValueFromX(e.clientX));
    },
    [disabled, onChange, getValueFromX]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      onChange(getValueFromX(e.clientX));
    },
    [onChange, getValueFromX]
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
    setIsDragging(false);
  }, []);

  const thumbRatio = mode === "volume" ? value / 100 : (value + 100) / 200;

  const titleText = label ?? (mode === "volume" ? volumeToDb(value) : `${value > 0 ? "R" : value < 0 ? "L" : "C"} ${Math.abs(value)}`);

  return (
    <div
      ref={containerRef}
      className={`relative select-none ${disabled ? "opacity-40 pointer-events-none" : "cursor-pointer"} ${className}`}
      style={{ height: `${SLIDER_H}px` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title={titleText}
    >
      {/* Canvas background (meter) */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 rounded-sm pointer-events-none"
        style={{ width: "100%", height: `${SLIDER_H}px` }}
      />

      {/* Track background */}
      <div className="absolute inset-0 rounded-sm border border-foreground/30 bg-muted/30 pointer-events-none" />

      {/* Thumb with center red mark */}
      <div
        className="absolute top-0 bottom-0 rounded-sm bg-foreground/90 shadow-sm transition-[left] duration-75 flex items-center justify-center"
        style={{
          left: `calc(${thumbRatio * 100}% - ${THUMB_W / 2}px)`,
          width: `${THUMB_W}px`,
        }}
      >
        <div className="w-px h-[60%] rounded-full" style={{ backgroundColor: "hsla(0, 70%, 65%, 0.8)" }} />
      </div>

      {/* Floating tooltip during drag */}
      {isDragging && (
        <div
          className="absolute -top-6 px-1 py-0.5 rounded bg-popover text-popover-foreground text-[9px] font-mono tabular-nums whitespace-nowrap shadow-md border border-border pointer-events-none z-50"
          style={{
            left: `calc(${thumbRatio * 100}% - 20px)`,
          }}
        >
          {titleText}
        </div>
      )}
    </div>
  );
}
