/**
 * WaveformEditor — professional stereo L/R waveform display with selection,
 * trim, fade in/out, normalize. Canvas-based with virtual rendering.
 * Synced with timeline zoom, scroll, and transport.
 */

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Loader2, Scissors, ArrowUpRight, ArrowDownRight, Maximize, AudioWaveform } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chooseLod, type MultiLodPeaks, type StereoPeaks } from "@/lib/waveformPeaks";
import { useWaveformPeaks, type WaveformStatus } from "@/hooks/useWaveformPeaks";
import type { TimelineClip } from "@/hooks/useTimelineClips";

interface WaveformEditorProps {
  clips: TimelineClip[];
  trackId: string | null;
  trackLabel: string;
  trackColor: string;
  zoom: number;
  duration: number;
  positionSec: number;
  scrollLeft: number;
  visibleWidth: number;
  mixerWidth: number;
  isRu: boolean;
  onSeek: (sec: number) => void;
}

// ── Selection state ──────────────────────────────────────────
interface Selection {
  startSec: number;
  endSec: number;
}

const CHANNEL_HEIGHT = 96;
const CHANNEL_GAP = 2;
const EDITOR_HEIGHT = CHANNEL_HEIGHT * 2 + CHANNEL_GAP + 24; // 2 channels + gap + toolbar

/** Resolve a CSS custom property to a usable hsl() string for Canvas */
function resolveHsl(varName: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return raw ? `hsl(${raw})` : "hsl(190 80% 60%)";
}

// ── Canvas waveform renderer ─────────────────────────────────
function drawChannel(
  ctx: CanvasRenderingContext2D,
  peaks: StereoPeaks,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  scrollLeftPx: number,
  totalWidthPx: number,
  selection: Selection | null,
  totalDuration: number,
  channelLabel: string,
) {
  const dpr = window.devicePixelRatio || 1;

  // Which portion of the peaks to draw
  const startFrac = scrollLeftPx / totalWidthPx;
  const endFrac = Math.min(1, (scrollLeftPx + w) / totalWidthPx);
  const peakCount = peaks.left.length;
  const startIdx = Math.floor(startFrac * peakCount);
  const endIdx = Math.ceil(endFrac * peakCount);
  const visiblePeaks = endIdx - startIdx;

  if (visiblePeaks <= 0) return;

  const data = channelLabel === "L" ? peaks.left : peaks.right;
  const mid = y + h / 2;
  const amp = h / 2 * 0.9;

  // Draw waveform fill
  ctx.beginPath();
  for (let i = 0; i <= visiblePeaks; i++) {
    const idx = startIdx + i;
    if (idx >= peakCount) break;
    const px = ((idx / peakCount) * totalWidthPx - scrollLeftPx) * dpr;
    const val = data[idx] || 0;
    const yPos = mid - val * amp;
    if (i === 0) ctx.moveTo(px, yPos * dpr);
    else ctx.lineTo(px, yPos * dpr);
  }
  // Mirror bottom
  for (let i = visiblePeaks; i >= 0; i--) {
    const idx = startIdx + i;
    if (idx >= peakCount) continue;
    const px = ((idx / peakCount) * totalWidthPx - scrollLeftPx) * dpr;
    const val = data[idx] || 0;
    const yPos = mid + val * amp;
    ctx.lineTo(px, yPos * dpr);
  }
  ctx.closePath();

  // Fill with alpha
  ctx.fillStyle = color.replace(")", " / 0.2)").replace("hsl(", "hsl(");
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Center line
  ctx.strokeStyle = color.replace(")", " / 0.3)").replace("hsl(", "hsl(");
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, mid * dpr);
  ctx.lineTo(w * dpr, mid * dpr);
  ctx.stroke();

  // Channel label
  ctx.fillStyle = color.replace(")", " / 0.5)").replace("hsl(", "hsl(");
  ctx.font = `${10 * dpr}px monospace`;
  ctx.fillText(channelLabel, 4 * dpr, (y + 12) * dpr);

  // Selection highlight
  if (selection) {
    const selStartPx = (selection.startSec / totalDuration) * totalWidthPx - scrollLeftPx;
    const selEndPx = (selection.endSec / totalDuration) * totalWidthPx - scrollLeftPx;
    const sx = Math.max(0, selStartPx) * dpr;
    const sw = (Math.min(w, selEndPx) - Math.max(0, selStartPx)) * dpr;
    if (sw > 0) {
      ctx.fillStyle = resolveHsl("--primary").replace(")", " / 0.15)").replace("hsl(", "hsl(");
      ctx.fillRect(sx, y * dpr, sw, h * dpr);
      // Selection edges
      ctx.strokeStyle = resolveHsl("--primary").replace(")", " / 0.6)").replace("hsl(", "hsl(");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, y * dpr);
      ctx.lineTo(sx, (y + h) * dpr);
      ctx.moveTo(sx + sw, y * dpr);
      ctx.lineTo(sx + sw, (y + h) * dpr);
      ctx.stroke();
    }
  }
}

export function WaveformEditor({
  clips,
  trackId,
  trackLabel,
  trackColor,
  zoom,
  duration,
  positionSec,
  scrollLeft,
  visibleWidth,
  isRu,
  onSeek,
}: WaveformEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<number>(0);

  // Filter clips for selected track
  const trackClips = useMemo(
    () => clips.filter((c) => c.trackId === trackId),
    [clips, trackId],
  );

  const { status, peaks, error } = useWaveformPeaks(trackClips, trackId);

  const totalWidthPx = duration * zoom * 4;

  // Choose LOD based on visible area
  const visibleDurationSec = visibleWidth > 0 ? (visibleWidth / totalWidthPx) * duration : duration;
  const lodLevel = useMemo(
    () => chooseLod(visibleWidth, duration, visibleDurationSec),
    [visibleWidth, duration, visibleDurationSec],
  );

  const currentPeaks = peaks?.lods.get(lodLevel) ?? peaks?.lods.get(200) ?? null;

  // ── Canvas rendering ──────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentPeaks) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (h < 4) return; // not laid out yet
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const chH = (h - CHANNEL_GAP) / 2;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Background
    ctx.fillStyle = resolveHsl("--background");
    ctx.fillRect(0, 0, w * dpr, h * dpr);

    const waveColor = resolveHsl("--cyan-glow");

    // Draw L channel
    drawChannel(ctx, currentPeaks, 0, 0, w, chH, waveColor, scrollLeft, totalWidthPx, selection, duration, "L");

    // Gap line
    const borderColor = resolveHsl("--border");
    ctx.fillStyle = borderColor.replace(")", " / 0.5)").replace("hsl(", "hsl(");
    ctx.fillRect(0, chH * dpr, w * dpr, CHANNEL_GAP * dpr);

    // Draw R channel
    drawChannel(ctx, currentPeaks, 0, chH + CHANNEL_GAP, w, chH, waveColor, scrollLeft, totalWidthPx, selection, duration, "R");

    // Playhead
    const playheadPx = (positionSec / duration) * totalWidthPx - scrollLeft;
    if (playheadPx >= 0 && playheadPx <= w) {
      ctx.strokeStyle = resolveHsl("--primary");
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadPx * dpr, 0);
      ctx.lineTo(playheadPx * dpr, h * dpr);
      ctx.stroke();
    }
  }, [currentPeaks, trackColor, scrollLeft, totalWidthPx, selection, duration, positionSec]);

  // Redraw on RAF when playing
  const rafRef = useRef<number>(0);
  useEffect(() => {
    draw();
  }, [draw]);

  // Re-request draw each frame for smooth playhead
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  // ── Mouse handlers for selection + seek ───────────────────
  const pxToSec = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left + scrollLeft;
      return Math.max(0, Math.min(duration, (px / totalWidthPx) * duration));
    },
    [scrollLeft, totalWidthPx, duration],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const sec = pxToSec(e.clientX);
      if (e.shiftKey) {
        // Extend selection
        setSelection((prev) =>
          prev ? { startSec: Math.min(prev.startSec, sec), endSec: Math.max(prev.endSec, sec) } : { startSec: sec, endSec: sec },
        );
      } else {
        dragStartRef.current = sec;
        setSelection(null);
        setIsDragging(true);
      }
    },
    [pxToSec],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const sec = pxToSec(e.clientX);
      const start = Math.min(dragStartRef.current, sec);
      const end = Math.max(dragStartRef.current, sec);
      if (end - start > 0.05) {
        setSelection({ startSec: start, endSec: end });
      }
    },
    [isDragging, pxToSec],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      setIsDragging(false);
      const sec = pxToSec(e.clientX);
      const start = Math.min(dragStartRef.current, sec);
      const end = Math.max(dragStartRef.current, sec);
      if (end - start < 0.05) {
        // Click — seek
        setSelection(null);
        onSeek(sec);
      }
    },
    [isDragging, pxToSec, onSeek],
  );

  // ── Selection info ─────────────────────────────────────────
  const selectionInfo = selection
    ? `${formatTimePrecise(selection.startSec)} → ${formatTimePrecise(selection.endSec)} (${(selection.endSec - selection.startSec).toFixed(2)}s)`
    : null;

  if (!trackId) {
    return (
      <div
        className="flex-1 flex items-center justify-center border-t border-border bg-card/30 min-h-[120px]"
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-body">
          <AudioWaveform className="h-4 w-4" />
          {isRu ? "Выберите стем для просмотра волны" : "Select a stem to view waveform"}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col border-t border-border bg-card/30 flex-1 min-h-[120px]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border/50 shrink-0 h-6">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: trackColor }} />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider font-body">
            {trackLabel} — Wave
          </span>
          {status === "loading" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
          {error && <span className="text-[10px] text-destructive">{error}</span>}
        </div>

        <div className="flex items-center gap-1">
          {selectionInfo && (
            <span className="text-[10px] text-muted-foreground font-mono mr-2">{selectionInfo}</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] gap-0.5"
            disabled={!selection}
            title={isRu ? "Обрезка" : "Trim"}
          >
            <Scissors className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] gap-0.5"
            disabled={!selection}
            title={isRu ? "Fade In" : "Fade In"}
          >
            <ArrowUpRight className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] gap-0.5"
            disabled={!selection}
            title={isRu ? "Fade Out" : "Fade Out"}
          >
            <ArrowDownRight className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] gap-0.5"
            disabled={!selection}
            title={isRu ? "Нормализация" : "Normalize"}
          >
            <Maximize className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 min-h-0 relative cursor-crosshair">
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            if (isDragging) setIsDragging(false);
          }}
        />
      </div>
    </div>
  );
}

function formatTimePrecise(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toFixed(2).padStart(5, "0")}`;
}
