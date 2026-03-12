/**
 * Panner3DStage — Interactive 2D top-down canvas for placing a sound source
 * relative to the listener. Renders a grid, listener at center,
 * and a draggable dot for the character's 3D position (X/Z plane, Y=height).
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { ParamSlider } from "./ParamSlider";
import { BypassButton } from "./BypassButton";
import type { ClipPanner3dConfig } from "@/hooks/useClipPluginConfigs";

interface Panner3DStageProps {
  isRu: boolean;
  config: ClipPanner3dConfig;
  disabled?: boolean;
  onToggle: () => void;
  onUpdate: (params: Partial<ClipPanner3dConfig>) => void;
}

const STAGE_RADIUS = 10; // world units

export function Panner3DStage({ isRu, config, disabled, onToggle, onUpdate }: Panner3DStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState(120);
  const draggingRef = useRef(false);

  // Responsive canvas
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const s = Math.min(el.clientWidth, el.clientHeight, 200);
      setCanvasSize(Math.max(80, s));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = canvasSize * dpr;
    c.height = canvasSize * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const half = canvasSize / 2;
    const scale = half / STAGE_RADIUS;

    // Background
    ctx.fillStyle = "hsl(220 15% 8%)";
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    // Grid circles
    ctx.strokeStyle = "hsla(220, 10%, 30%, 0.4)";
    ctx.lineWidth = 0.5;
    for (let r = 2; r <= STAGE_RADIUS; r += 2) {
      ctx.beginPath();
      ctx.arc(half, half, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Grid crosshair
    ctx.beginPath();
    ctx.moveTo(half, 0); ctx.lineTo(half, canvasSize);
    ctx.moveTo(0, half); ctx.lineTo(canvasSize, half);
    ctx.stroke();

    // Listener icon (ear/triangle at center)
    ctx.fillStyle = "hsla(220, 30%, 60%, 0.8)";
    ctx.beginPath();
    ctx.arc(half, half, 4, 0, Math.PI * 2);
    ctx.fill();
    // Label
    ctx.font = "7px monospace";
    ctx.fillStyle = "hsla(220, 20%, 50%, 0.7)";
    ctx.textAlign = "center";
    ctx.fillText("L", half, half + 11);

    // Source dot
    const sx = half + config.positionX * scale;
    const sz = half - config.positionZ * scale; // Z is forward = up on screen
    const dotR = 6;

    // Distance line
    ctx.strokeStyle = config.enabled ? "hsla(var(--primary-hsl, 160 60% 50%), 0.4)" : "hsla(0, 0%, 50%, 0.2)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(half, half);
    ctx.lineTo(sx, sz);
    ctx.stroke();
    ctx.setLineDash([]);

    // Source
    ctx.fillStyle = config.enabled ? "hsl(160 70% 55%)" : "hsl(0 0% 40%)";
    ctx.beginPath();
    ctx.arc(sx, sz, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = config.enabled ? "hsl(160 90% 70%)" : "hsl(0 0% 55%)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Height indicator (Y) as a small label
    if (Math.abs(config.positionY) > 0.1) {
      ctx.font = "7px monospace";
      ctx.fillStyle = "hsl(45 80% 60%)";
      ctx.textAlign = "center";
      ctx.fillText(`Y:${config.positionY.toFixed(1)}`, sx, sz - dotR - 3);
    }
  }, [canvasSize, config.positionX, config.positionY, config.positionZ, config.enabled]);

  // Drag handler
  const worldFromCanvas = useCallback((clientX: number, clientY: number) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, z: 0 };
    const rect = c.getBoundingClientRect();
    const half = canvasSize / 2;
    const scale = half / STAGE_RADIUS;
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const x = Math.max(-STAGE_RADIUS, Math.min(STAGE_RADIUS, (cx - half) / scale));
    const z = Math.max(-STAGE_RADIUS, Math.min(STAGE_RADIUS, -(cy - half) / scale));
    return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
  }, [canvasSize]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled || !config.enabled) return;
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const { x, z } = worldFromCanvas(e.clientX, e.clientY);
    onUpdate({ positionX: x, positionZ: z });
  }, [disabled, config.enabled, worldFromCanvas, onUpdate]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const { x, z } = worldFromCanvas(e.clientX, e.clientY);
    onUpdate({ positionX: x, positionZ: z });
  }, [worldFromCanvas, onUpdate]);

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
          {isRu ? "3D Позиция" : "3D Position"}
        </span>
        <BypassButton label="3D" bypassed={!config.enabled} onToggle={onToggle} />
      </div>

      <div className="flex gap-3 flex-1 min-h-0">
        {/* Canvas */}
        <div
          ref={containerRef}
          className={`flex-1 min-w-0 min-h-0 flex items-center justify-center ${disabled || !config.enabled ? "opacity-40 pointer-events-none" : ""}`}
        >
          <canvas
            ref={canvasRef}
            style={{ width: canvasSize, height: canvasSize, borderRadius: 6, cursor: config.enabled ? "crosshair" : "default" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />
        </div>

        {/* Sliders */}
        <div className={`flex flex-col gap-1 shrink-0 justify-center ${disabled || !config.enabled ? "opacity-40 pointer-events-none" : ""}`} style={{ width: 100 }}>
          <ParamSlider label="X" value={config.positionX} min={-10} max={10} step={0.1} onChange={v => onUpdate({ positionX: v })} disabled={!config.enabled} />
          <ParamSlider label="Y" value={config.positionY} min={-10} max={10} step={0.1} onChange={v => onUpdate({ positionY: v })} disabled={!config.enabled} />
          <ParamSlider label="Z" value={config.positionZ} min={-10} max={10} step={0.1} onChange={v => onUpdate({ positionZ: v })} disabled={!config.enabled} />
          <ParamSlider label={isRu ? "Расст." : "RefDist"} value={config.refDistance} min={0.1} max={20} step={0.1} onChange={v => onUpdate({ refDistance: v })} disabled={!config.enabled} />
          <ParamSlider label="Rolloff" value={config.rolloffFactor} min={0} max={5} step={0.1} onChange={v => onUpdate({ rolloffFactor: v })} disabled={!config.enabled} />
        </div>
      </div>
    </div>
  );
}
