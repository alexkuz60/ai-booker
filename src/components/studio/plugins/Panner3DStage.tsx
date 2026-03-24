/**
 * Panner3DStage — Interactive 2D top-down canvas for placing sound sources
 * relative to the listener. Shows ALL clips/characters on stage simultaneously.
 * The selected clip is highlighted and draggable; others are dimmed.
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { Maximize2 } from "lucide-react";
import { ParamSlider } from "./ParamSlider";
import { BypassButton } from "./BypassButton";
import { Panner3DExpandedDialog } from "./Panner3DExpandedDialog";
import type { ClipPanner3dConfig } from "@/hooks/useClipPluginConfigs";

/** Info about a clip to render on the stage */
export interface StageClipInfo {
  id: string;
  label: string;
  color?: string;
  panner3d: ClipPanner3dConfig;
}

interface Panner3DStageProps {
  isRu: boolean;
  /** All clips in the scene to display on stage */
  allClips: StageClipInfo[];
  /** Currently selected clip ID (draggable) */
  selectedClipId: string | null;
  config: ClipPanner3dConfig;
  disabled?: boolean;
  onToggle: () => void;
  onUpdate: (params: Partial<ClipPanner3dConfig>) => void;
}

const STAGE_RADIUS = 10; // world units

export function Panner3DStage({ isRu, allClips, selectedClipId, config, disabled, onToggle, onUpdate }: Panner3DStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState(120);
  const draggingRef = useRef(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; color?: string } | null>(null);
  const [expandedOpen, setExpandedOpen] = useState(false);

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

    // Listener icon — top-down head silhouette (nose pointing up = forward)
    const hs = Math.max(5, canvasSize * 0.04); // head scale
    ctx.save();
    ctx.translate(half, half);

    // Head oval
    ctx.fillStyle = "hsla(220, 25%, 40%, 0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 0, hs * 1.1, hs * 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "hsla(220, 20%, 50%, 0.4)";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Left ear
    ctx.fillStyle = "hsla(220, 25%, 38%, 0.35)";
    ctx.beginPath();
    ctx.ellipse(-hs * 1.3, 0, hs * 0.25, hs * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Right ear
    ctx.beginPath();
    ctx.ellipse(hs * 1.3, 0, hs * 0.25, hs * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Nose (triangle pointing up = forward/+Z)
    ctx.fillStyle = "hsla(220, 30%, 50%, 0.4)";
    ctx.beginPath();
    ctx.moveTo(0, -hs * 1.7);
    ctx.lineTo(-hs * 0.35, -hs * 1.15);
    ctx.lineTo(hs * 0.35, -hs * 1.15);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // ── Draw all clips (non-selected first, then selected on top) ──
    const sortedClips = [...allClips].sort((a, b) => {
      if (a.id === selectedClipId) return 1;  // selected on top
      if (b.id === selectedClipId) return -1;
      return 0;
    });

    for (const clip of sortedClips) {
      const p3d = clip.panner3d;
      const isSelected = clip.id === selectedClipId;
      const isEnabled = p3d.enabled;

      const sx = half + p3d.positionX * scale;
      const sz = half - p3d.positionZ * scale;
      const dotR = isSelected ? 6 : 4;

      // Distance line
      if (isEnabled) {
        ctx.strokeStyle = isSelected
          ? "hsla(160, 60%, 50%, 0.4)"
          : `${clip.color ?? "hsla(220, 40%, 50%, 0.2)"}`;
        ctx.lineWidth = isSelected ? 1 : 0.5;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(half, half);
        ctx.lineTo(sx, sz);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Dot color
      const baseColor = clip.color ?? (isEnabled ? "hsl(160, 70%, 55%)" : "hsl(0, 0%, 40%)");

      if (isSelected) {
        // Selected: bright dot
        ctx.fillStyle = isEnabled ? "hsl(160, 70%, 55%)" : "hsl(0, 0%, 40%)";
        ctx.beginPath();
        ctx.arc(sx, sz, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = isEnabled ? "hsl(160, 90%, 70%)" : "hsl(0, 0%, 55%)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        // Non-selected: dimmed with track color
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

      // Height indicator (Y) for selected clip only
      if (isSelected && Math.abs(p3d.positionY) > 0.1) {
        ctx.font = "7px monospace";
        ctx.fillStyle = "hsl(45, 80%, 60%)";
        ctx.textAlign = "center";
        ctx.fillText(`Y:${p3d.positionY.toFixed(1)}`, sx, sz - dotR - 3);
      }
    }
  }, [canvasSize, allClips, selectedClipId, config]);

  // Tooltip on hover — find nearest clip dot
  const handleCanvasHover = useCallback((e: React.PointerEvent) => {
    if (draggingRef.current) { setTooltip(null); return; }
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const half = canvasSize / 2;
    const scale = half / STAGE_RADIUS;
    const HIT_R = 10; // px hit radius

    for (const clip of allClips) {
      const sx = half + clip.panner3d.positionX * scale;
      const sz = half - clip.panner3d.positionZ * scale;
      const dx = mx - sx, dy = my - sz;
      if (dx * dx + dy * dy <= HIT_R * HIT_R) {
        setTooltip({ x: sx, y: sz, label: clip.label, color: clip.color });
        return;
      }
    }
    setTooltip(null);
  }, [canvasSize, allClips]);

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
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpandedOpen(true)}
            disabled={disabled}
            className="p-0.5 rounded hover:bg-muted/40 text-muted-foreground/50 hover:text-muted-foreground transition-colors disabled:opacity-30"
            title={isRu ? "Развернуть" : "Expand"}
          >
            <Maximize2 className="w-3 h-3" />
          </button>
          <BypassButton label="3D" bypassed={!config.enabled} onToggle={onToggle} />
        </div>
      </div>

      <div className="flex gap-3 flex-1 min-h-0">
        {/* Canvas */}
        <div
          ref={containerRef}
          className={`flex-1 min-w-0 min-h-0 flex items-center justify-center relative ${disabled || !config.enabled ? "opacity-40 pointer-events-none" : ""}`}
        >
          <div className="relative" style={{ width: canvasSize, height: canvasSize }}>
            <canvas
              ref={canvasRef}
              style={{ width: canvasSize, height: canvasSize, borderRadius: 6, cursor: config.enabled ? "crosshair" : "default" }}
              onPointerDown={handlePointerDown}
              onPointerMove={(e) => { handlePointerMove(e); handleCanvasHover(e); }}
              onPointerUp={handlePointerUp}
              onPointerLeave={(e) => { handlePointerUp(); setTooltip(null); }}
            />
            {/* Tooltip overlay */}
            {tooltip && (
              <div
                className="absolute pointer-events-none px-1.5 py-0.5 rounded text-[10px] font-mono text-foreground bg-popover border border-border shadow-md whitespace-nowrap z-10"
                style={{
                  left: tooltip.x,
                  top: tooltip.y - 20,
                  transform: "translateX(-50%)",
                }}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ backgroundColor: tooltip.color ?? "hsl(var(--primary))" }} />
                {tooltip.label}
              </div>
            )}
          </div>
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

      <Panner3DExpandedDialog
        open={expandedOpen}
        onOpenChange={setExpandedOpen}
        isRu={isRu}
        allClips={allClips}
        selectedClipId={selectedClipId}
        config={config}
        onUpdate={onUpdate}
      />
    </div>
  );
}
