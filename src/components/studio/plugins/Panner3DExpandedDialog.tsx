/**
 * Panner3DExpandedDialog — Full-size 3D panner in a dialog (canvas ~3x larger).
 * Synced with the inline Panner3DStage via shared config/callbacks.
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ParamSlider } from "./ParamSlider";
import type { ClipPanner3dConfig } from "@/hooks/useClipPluginConfigs";
import type { StageClipInfo } from "./Panner3DStage";

interface Panner3DExpandedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isRu: boolean;
  allClips: StageClipInfo[];
  selectedClipId: string | null;
  config: ClipPanner3dConfig;
  onUpdate: (params: Partial<ClipPanner3dConfig>) => void;
}

const STAGE_RADIUS = 10;
const CANVAS_SIZE = 420; // ~3x the inline 120–140px

export function Panner3DExpandedDialog({
  open, onOpenChange, isRu, allClips, selectedClipId, config, onUpdate,
}: Panner3DExpandedDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; color?: string } | null>(null);

  // Draw
  useEffect(() => {
    if (!open) return;
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const size = CANVAS_SIZE;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const half = size / 2;
    const scale = half / STAGE_RADIUS;

    // Background
    ctx.fillStyle = "hsl(220 15% 8%)";
    ctx.fillRect(0, 0, size, size);

    // Grid circles
    ctx.strokeStyle = "hsla(220, 10%, 30%, 0.4)";
    ctx.lineWidth = 0.5;
    for (let r = 2; r <= STAGE_RADIUS; r += 2) {
      ctx.beginPath();
      ctx.arc(half, half, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Distance labels
    ctx.font = "9px monospace";
    ctx.fillStyle = "hsla(220, 10%, 45%, 0.6)";
    ctx.textAlign = "left";
    for (let r = 2; r <= STAGE_RADIUS; r += 2) {
      ctx.fillText(`${r}`, half + 3, half - r * scale + 11);
    }

    // Crosshair
    ctx.strokeStyle = "hsla(220, 10%, 30%, 0.4)";
    ctx.beginPath();
    ctx.moveTo(half, 0); ctx.lineTo(half, size);
    ctx.moveTo(0, half); ctx.lineTo(size, half);
    ctx.stroke();

    // Axis labels
    ctx.font = "10px monospace";
    ctx.fillStyle = "hsla(220, 10%, 50%, 0.5)";
    ctx.textAlign = "center";
    ctx.fillText(isRu ? "Перед" : "Front", half, 12);
    ctx.fillText(isRu ? "Зад" : "Back", half, size - 4);
    ctx.textAlign = "left";
    ctx.fillText(isRu ? "Лев" : "L", 4, half - 4);
    ctx.textAlign = "right";
    ctx.fillText(isRu ? "Пр" : "R", size - 4, half - 4);

    // Listener head
    const hs = Math.max(8, size * 0.03);
    ctx.save();
    ctx.translate(half, half);
    ctx.fillStyle = "hsla(220, 25%, 40%, 0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 0, hs * 1.1, hs * 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "hsla(220, 20%, 50%, 0.4)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // Ears
    ctx.fillStyle = "hsla(220, 25%, 38%, 0.35)";
    ctx.beginPath();
    ctx.ellipse(-hs * 1.3, 0, hs * 0.25, hs * 0.55, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(hs * 1.3, 0, hs * 0.25, hs * 0.55, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // Nose
    ctx.fillStyle = "hsla(220, 30%, 50%, 0.4)";
    ctx.beginPath();
    ctx.moveTo(0, -hs * 1.7);
    ctx.lineTo(-hs * 0.35, -hs * 1.15);
    ctx.lineTo(hs * 0.35, -hs * 1.15);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Clips
    const sorted = [...allClips].sort((a, b) => {
      if (a.id === selectedClipId) return 1;
      if (b.id === selectedClipId) return -1;
      return 0;
    });

    for (const clip of sorted) {
      const p3d = clip.panner3d;
      const isSelected = clip.id === selectedClipId;
      const isEnabled = p3d.enabled;
      const sx = half + p3d.positionX * scale;
      const sz = half - p3d.positionZ * scale;
      const dotR = isSelected ? 8 : 5;

      // Distance line
      if (isEnabled) {
        ctx.strokeStyle = isSelected
          ? "hsla(160, 60%, 50%, 0.4)"
          : `${clip.color ?? "hsla(220, 40%, 50%, 0.2)"}`;
        ctx.lineWidth = isSelected ? 1.5 : 0.7;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(half, half);
        ctx.lineTo(sx, sz);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const baseColor = clip.color ?? (isEnabled ? "hsl(160, 70%, 55%)" : "hsl(0, 0%, 40%)");

      if (isSelected) {
        ctx.fillStyle = isEnabled ? "hsl(160, 70%, 55%)" : "hsl(0, 0%, 40%)";
        ctx.beginPath();
        ctx.arc(sx, sz, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = isEnabled ? "hsl(160, 90%, 70%)" : "hsl(0, 0%, 55%)";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.globalAlpha = isEnabled ? 0.75 : 0.3;
        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.arc(sx, sz, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Label for all clips in expanded view
      if (isEnabled || isSelected) {
        ctx.font = isSelected ? "bold 11px sans-serif" : "10px sans-serif";
        ctx.fillStyle = isSelected ? "hsl(160, 70%, 75%)" : "hsla(220, 10%, 60%, 0.8)";
        ctx.textAlign = "center";
        ctx.fillText(clip.label, sx, sz - dotR - 5);
      }

      // Height indicator
      if (isSelected && Math.abs(p3d.positionY) > 0.1) {
        ctx.font = "9px monospace";
        ctx.fillStyle = "hsl(45, 80%, 60%)";
        ctx.textAlign = "center";
        ctx.fillText(`Y:${p3d.positionY.toFixed(1)}`, sx, sz + dotR + 12);
      }
    }
  }, [open, allClips, selectedClipId, config, isRu]);

  const worldFromCanvas = useCallback((clientX: number, clientY: number) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, z: 0 };
    const rect = c.getBoundingClientRect();
    const half = CANVAS_SIZE / 2;
    const scale = half / STAGE_RADIUS;
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const x = Math.max(-STAGE_RADIUS, Math.min(STAGE_RADIUS, (cx - half) / scale));
    const z = Math.max(-STAGE_RADIUS, Math.min(STAGE_RADIUS, -(cy - half) / scale));
    return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!config.enabled) return;
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const { x, z } = worldFromCanvas(e.clientX, e.clientY);
    onUpdate({ positionX: x, positionZ: z });
  }, [config.enabled, worldFromCanvas, onUpdate]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    // Tooltip
    if (!draggingRef.current) {
      const c = canvasRef.current;
      if (c) {
        const rect = c.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const half = CANVAS_SIZE / 2;
        const scale = half / STAGE_RADIUS;
        const HIT_R = 14;
        let found = false;
        for (const clip of allClips) {
          const sx = half + clip.panner3d.positionX * scale;
          const sz = half - clip.panner3d.positionZ * scale;
          const dx = mx - sx, dy = my - sz;
          if (dx * dx + dy * dy <= HIT_R * HIT_R) {
            setTooltip({ x: sx, y: sz, label: clip.label, color: clip.color });
            found = true;
            break;
          }
        }
        if (!found) setTooltip(null);
      }
    }
    // Drag
    if (draggingRef.current) {
      const { x, z } = worldFromCanvas(e.clientX, e.clientY);
      onUpdate({ positionX: x, positionZ: z });
    }
  }, [worldFromCanvas, onUpdate, allClips]);

  const handlePointerUp = useCallback(() => { draggingRef.current = false; }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[540px] p-4 gap-3 bg-background border-border">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-sm font-mono">
            {isRu ? "3D Панорама — расширенный вид" : "3D Panner — Expanded View"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-4">
          {/* Large canvas */}
          <div className="relative shrink-0" style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}>
            <canvas
              ref={canvasRef}
              style={{ width: CANVAS_SIZE, height: CANVAS_SIZE, borderRadius: 8, cursor: config.enabled ? "crosshair" : "default" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={() => { handlePointerUp(); setTooltip(null); }}
            />
            {tooltip && (
              <div
                className="absolute pointer-events-none px-2 py-1 rounded text-[11px] font-mono text-foreground bg-popover border border-border shadow-md whitespace-nowrap z-10"
                style={{ left: tooltip.x, top: tooltip.y - 24, transform: "translateX(-50%)" }}
              >
                <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: tooltip.color ?? "hsl(var(--primary))" }} />
                {tooltip.label}
              </div>
            )}
          </div>

          {/* Sliders */}
          <div className={`flex flex-col gap-2 justify-center min-w-[90px] ${!config.enabled ? "opacity-40 pointer-events-none" : ""}`}>
            <ParamSlider label="X" value={config.positionX} min={-10} max={10} step={0.1} onChange={v => onUpdate({ positionX: v })} disabled={!config.enabled} />
            <ParamSlider label="Y" value={config.positionY} min={-10} max={10} step={0.1} onChange={v => onUpdate({ positionY: v })} disabled={!config.enabled} />
            <ParamSlider label="Z" value={config.positionZ} min={-10} max={10} step={0.1} onChange={v => onUpdate({ positionZ: v })} disabled={!config.enabled} />
            <div className="h-px bg-border my-1" />
            <ParamSlider label={isRu ? "Расст." : "RefDist"} value={config.refDistance} min={0.1} max={20} step={0.1} onChange={v => onUpdate({ refDistance: v })} disabled={!config.enabled} />
            <ParamSlider label="Rolloff" value={config.rolloffFactor} min={0} max={5} step={0.1} onChange={v => onUpdate({ rolloffFactor: v })} disabled={!config.enabled} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
