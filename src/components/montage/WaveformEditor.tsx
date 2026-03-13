/**
 * WaveformEditor — professional stereo L/R waveform display with selection,
 * trim, fade in/out, normalize. Canvas-based with virtual rendering.
 * Operates in SCENE-LOCAL coordinates: 100% zoom = full scene visible.
 * Transport position is relative to scene start.
 */

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Loader2, Scissors, ArrowUpRight, ArrowDownRight, Maximize, AudioWaveform, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chooseLod, type MultiLodPeaks, type StereoPeaks } from "@/lib/waveformPeaks";
import { useWaveformPeaks, type WaveformStatus } from "@/hooks/useWaveformPeaks";
import type { TimelineClip } from "@/hooks/useTimelineClips";

interface WaveformEditorProps {
  /** Clips for the selected track WITHIN the current scene (scene-local startSec) */
  sceneClips: TimelineClip[];
  trackId: string | null;
  trackLabel: string;
  trackColor: string;
  /** Duration of the current scene in seconds */
  sceneDuration: number;
  /** Transport position relative to scene start */
  scenePositionSec: number;
  /** Current scene label for display */
  sceneLabel: string;
  mixerWidth: number;
  isRu: boolean;
  /** Seek callback — receives scene-relative seconds */
  onSeek: (sceneRelativeSec: number) => void;
  onTrim?: (trackId: string, startSec: number, endSec: number) => void;
  onFadeIn?: (trackId: string, durationSec: number) => void;
  onFadeOut?: (trackId: string, durationSec: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

// ── Selection state ──────────────────────────────────────────
interface Selection {
  startSec: number;
  endSec: number;
}

const CHANNEL_HEIGHT = 96;
const CHANNEL_GAP = 2;

const EDITOR_ZOOM_PRESETS = [100, 200, 300, 400, 500] as const;

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
  signalStartFrac: number,
  signalEndFrac: number,
) {
  const dpr = window.devicePixelRatio || 1;

  const peakCount = peaks.left.length;
  const clampedStartFrac = Math.max(0, Math.min(1, signalStartFrac));
  const clampedEndFrac = Math.max(clampedStartFrac + 1 / Math.max(1, peakCount), Math.min(1, signalEndFrac));
  const spanFrac = Math.max(1 / Math.max(1, peakCount), clampedEndFrac - clampedStartFrac);

  // Which portion of the SIGNAL window to draw
  const viewStartFrac = scrollLeftPx / totalWidthPx;
  const viewEndFrac = Math.min(1, (scrollLeftPx + w) / totalWidthPx);
  const globalStartFrac = clampedStartFrac + viewStartFrac * spanFrac;
  const globalEndFrac = clampedStartFrac + viewEndFrac * spanFrac;

  const startIdx = Math.max(0, Math.floor(globalStartFrac * peakCount));
  const endIdx = Math.min(peakCount, Math.ceil(globalEndFrac * peakCount));
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
    const idxFrac = idx / peakCount;
    const localFrac = (idxFrac - clampedStartFrac) / spanFrac;
    const px = (x + localFrac * totalWidthPx - scrollLeftPx) * dpr;
    const val = data[idx] || 0;
    const yPos = mid - val * amp;
    if (i === 0) ctx.moveTo(px, yPos * dpr);
    else ctx.lineTo(px, yPos * dpr);
  }
  // Mirror bottom
  for (let i = visiblePeaks; i >= 0; i--) {
    const idx = startIdx + i;
    if (idx >= peakCount) continue;
    const idxFrac = idx / peakCount;
    const localFrac = (idxFrac - clampedStartFrac) / spanFrac;
    const px = (x + localFrac * totalWidthPx - scrollLeftPx) * dpr;
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
  ctx.moveTo(x * dpr, mid * dpr);
  ctx.lineTo((x + w) * dpr, mid * dpr);
  ctx.stroke();

  // Channel label
  ctx.fillStyle = color.replace(")", " / 0.5)").replace("hsl(", "hsl(");
  ctx.font = `${10 * dpr}px monospace`;
  ctx.fillText(channelLabel, (x + 4) * dpr, (y + 12) * dpr);

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
  sceneClips,
  trackId,
  trackLabel,
  trackColor,
  sceneDuration,
  scenePositionSec,
  sceneLabel,
  mixerWidth,
  isRu,
  onSeek,
  onTrim,
  onFadeIn,
  onFadeOut,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: WaveformEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<number>(0);

  // ── Editor-local zoom (100% = scene fits entire width) ─────
  const [editorZoomPercent, setEditorZoomPercent] = useState(100);
  const [editorContainerWidth, setEditorContainerWidth] = useState(0);

  // Measure available waveform width (excluding mixer sidebar)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - mixerWidth;
      setEditorContainerWidth(w > 0 ? w : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mixerWidth]);

  // At 100% zoom: totalWidthPx === editorContainerWidth (scene fills editor exactly).
  // At N%: totalWidthPx = editorContainerWidth * N / 100.
  const totalWidthPx = editorContainerWidth > 0
    ? editorContainerWidth * editorZoomPercent / 100
    : 100;

  // Reset zoom + scroll when scene changes
  const prevSceneLabelRef = useRef(sceneLabel);
  useEffect(() => {
    if (sceneLabel !== prevSceneLabelRef.current) {
      prevSceneLabelRef.current = sceneLabel;
      setEditorZoomPercent(100);
      setSelection(null);
      setScrollLeft(0);
      const el = editorScrollRef.current;
      if (el) el.scrollLeft = 0;
    }
  }, [sceneLabel]);

  // ── Editor-local scroll ──────────────────────────────────
  const [scrollLeft, setScrollLeft] = useState(0);

  useEffect(() => {
    const el = editorScrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollLeft(el.scrollLeft);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll to follow playhead during playback when zoomed in
  const userScrollingRef = useRef(false);
  useEffect(() => {
    const el = editorScrollRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      userScrollingRef.current = true;
      clearTimeout(timer);
      timer = setTimeout(() => { userScrollingRef.current = false; }, 600);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (editorZoomPercent <= 100 || userScrollingRef.current) return;
    const el = editorScrollRef.current;
    if (!el) return;
    const playheadPx = (scenePositionSec / sceneDuration) * totalWidthPx;
    const target = Math.max(0, playheadPx - el.clientWidth / 2);
    el.scrollLeft = target;
  }, [scenePositionSec, sceneDuration, totalWidthPx, editorZoomPercent]);

  // Peaks for scene clips on selected track
  const { status, peaks, error } = useWaveformPeaks(sceneClips, trackId, sceneDuration, editorContainerWidth || 1600);

  // Available LOD levels from computed peaks
  const lodLevels = useMemo(() => {
    if (!peaks) return [400, 1600, 6400];
    return Array.from(peaks.lods.keys()).sort((a, b) => a - b);
  }, [peaks]);

  // Choose LOD based on visible area
  const visibleWidth = editorContainerWidth;
  const visibleDurationSec = visibleWidth > 0 && totalWidthPx > 0 ? (visibleWidth / totalWidthPx) * sceneDuration : sceneDuration;
  const lodLevel = useMemo(
    () => chooseLod(visibleWidth, sceneDuration, visibleDurationSec, lodLevels),
    [visibleWidth, sceneDuration, visibleDurationSec, lodLevels],
  );

  const currentPeaks = peaks?.lods.get(lodLevel) ?? (peaks ? peaks.lods.values().next().value : null);

  const signalWindow = useMemo(() => {
    if (!peaks || sceneDuration <= 0) {
      return { startFrac: 0, endFrac: 1, startSec: 0, durationSec: Math.max(0.05, sceneDuration) };
    }

    const allLods = Array.from(peaks.lods.values());
    if (allLods.length === 0) {
      return { startFrac: 0, endFrac: 1, startSec: 0, durationSec: Math.max(0.05, sceneDuration) };
    }

    const detailLod = allLods.reduce((best, lod) =>
      lod.left.length > best.left.length ? lod : best,
    );

    const threshold = 0.002;
    let first = -1;
    let last = -1;

    for (let i = 0; i < detailLod.left.length; i++) {
      if ((detailLod.left[i] ?? 0) > threshold || (detailLod.right[i] ?? 0) > threshold) {
        first = i;
        break;
      }
    }

    for (let i = detailLod.left.length - 1; i >= 0; i--) {
      if ((detailLod.left[i] ?? 0) > threshold || (detailLod.right[i] ?? 0) > threshold) {
        last = i;
        break;
      }
    }

    if (first < 0 || last <= first) {
      return { startFrac: 0, endFrac: 1, startSec: 0, durationSec: Math.max(0.05, sceneDuration) };
    }

    const startFrac = first / detailLod.left.length;
    const endFrac = Math.min(1, (last + 1) / detailLod.left.length);
    const startSec = startFrac * sceneDuration;
    const durationSec = Math.max(0.05, (endFrac - startFrac) * sceneDuration);

    return { startFrac, endFrac, startSec, durationSec };
  }, [peaks, sceneDuration]);

  const displayDurationSec = signalWindow.durationSec;
  const displayPositionSec = Math.max(0, Math.min(scenePositionSec - signalWindow.startSec, displayDurationSec));

  // ── dB scale helpers ────────────────────────────────────────
  const DB_MARKS = [0, -6, -12, -18, -30, -60];

  function dbToLinear(db: number): number {
    if (db <= -60) return 0;
    if (db >= 0) return 1;
    return Math.pow(10, db / 20);
  }

  // ── Canvas rendering ──────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentPeaks) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (h < 4) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const chH = (h - CHANNEL_GAP) / 2;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Background
    ctx.fillStyle = resolveHsl("--background");
    ctx.fillRect(0, 0, w * dpr, h * dpr);

    const borderColor = resolveHsl("--border");
    const mutedColor = resolveHsl("--muted-foreground");
    const waveColor = resolveHsl("--cyan-glow");
    const waveW = w - mixerWidth;

    // ── dB scale in mixer sidebar area ──────────────────────
    const drawDbScale = (chY: number, chHeight: number) => {
      const mid = chY + chHeight / 2;
      const amp = chHeight / 2 * 0.9;

      ctx.font = `${8 * dpr}px monospace`;
      ctx.textAlign = "right";

      for (const db of DB_MARKS) {
        const lin = dbToLinear(db);
        const yUp = mid - lin * amp;
        const yDown = mid + lin * amp;

        ctx.strokeStyle = borderColor.replace(")", " / 0.2)").replace("hsl(", "hsl(");
        ctx.lineWidth = db === 0 ? 0.8 : 0.4;
        ctx.setLineDash(db === 0 ? [] : [2, 3]);

        ctx.beginPath();
        ctx.moveTo(mixerWidth * dpr, yUp * dpr);
        ctx.lineTo(w * dpr, yUp * dpr);
        ctx.stroke();

        if (db !== 0) {
          ctx.beginPath();
          ctx.moveTo(mixerWidth * dpr, yDown * dpr);
          ctx.lineTo(w * dpr, yDown * dpr);
          ctx.stroke();
        }

        ctx.setLineDash([]);

        ctx.fillStyle = mutedColor.replace(")", " / 0.5)").replace("hsl(", "hsl(");
        const label = db === 0 ? " 0" : `${db}`;
        ctx.fillText(label, (mixerWidth - 4) * dpr, (yUp + 3) * dpr);
        if (db !== 0 && db !== -60) {
          ctx.fillText(label, (mixerWidth - 4) * dpr, (yDown + 3) * dpr);
        }
      }
      ctx.textAlign = "left";
    };

    drawDbScale(0, chH);
    drawDbScale(chH + CHANNEL_GAP, chH);

    // ── Time grid (vertical lines) — scene-local ────────────
    const drawTimeGrid = () => {
      const pxPerSec = totalWidthPx / displayDurationSec;
      let interval = 1;
      if (pxPerSec < 10) interval = 30;
      else if (pxPerSec < 20) interval = 15;
      else if (pxPerSec < 40) interval = 10;
      else if (pxPerSec < 80) interval = 5;
      else if (pxPerSec < 200) interval = 2;
      else interval = 1;

      const startSec = Math.floor((scrollLeft / totalWidthPx) * displayDurationSec / interval) * interval;
      const endSec = Math.ceil(((scrollLeft + waveW) / totalWidthPx) * displayDurationSec / interval) * interval;

      ctx.font = `${8 * dpr}px monospace`;
      ctx.textAlign = "center";

      for (let t = startSec; t <= endSec; t += interval) {
        if (t < 0) continue;
        const px = (t / displayDurationSec) * totalWidthPx - scrollLeft + mixerWidth;
        if (px < mixerWidth || px > w) continue;

        const isMajor = t % (interval * 5) === 0 || interval >= 10;
        ctx.strokeStyle = borderColor.replace(")", ` / ${isMajor ? 0.2 : 0.1})`).replace("hsl(", "hsl(");
        ctx.lineWidth = isMajor ? 0.8 : 0.4;
        ctx.setLineDash(isMajor ? [] : [1, 3]);

        ctx.beginPath();
        ctx.moveTo(px * dpr, 0);
        ctx.lineTo(px * dpr, h * dpr);
        ctx.stroke();

        ctx.setLineDash([]);
      }
      ctx.textAlign = "left";
    };

    drawTimeGrid();

    // Mixer sidebar separator
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mixerWidth * dpr, 0);
    ctx.lineTo(mixerWidth * dpr, h * dpr);
    ctx.stroke();

    // Clip to waveform area
    ctx.save();
    ctx.beginPath();
    ctx.rect(mixerWidth * dpr, 0, (w - mixerWidth) * dpr, h * dpr);
    ctx.clip();

    // Draw L channel
    drawChannel(
      ctx,
      currentPeaks,
      mixerWidth,
      0,
      waveW,
      chH,
      waveColor,
      scrollLeft,
      totalWidthPx,
      selection,
      displayDurationSec,
      "L",
      signalWindow.startFrac,
      signalWindow.endFrac,
    );

    // Gap line
    ctx.fillStyle = borderColor.replace(")", " / 0.5)").replace("hsl(", "hsl(");
    ctx.fillRect(mixerWidth * dpr, chH * dpr, waveW * dpr, CHANNEL_GAP * dpr);

    // Draw R channel
    drawChannel(
      ctx,
      currentPeaks,
      mixerWidth,
      chH + CHANNEL_GAP,
      waveW,
      chH,
      waveColor,
      scrollLeft,
      totalWidthPx,
      selection,
      displayDurationSec,
      "R",
      signalWindow.startFrac,
      signalWindow.endFrac,
    );

    // ── Draw fade envelopes for each clip ───────────────────
    const fadeColor = resolveHsl("--primary");
    for (const clip of sceneClips) {
      const fadeIn = clip.fadeInSec ?? 0;
      const fadeOut = clip.fadeOutSec ?? 0;
      if (fadeIn <= 0 && fadeOut <= 0) continue;

      const clipStartSec = clip.startSec - signalWindow.startSec;
      const clipEndSec = clip.startSec + clip.durationSec - signalWindow.startSec;
      if (clipEndSec <= 0 || clipStartSec >= displayDurationSec) continue;

      const clipStartPx = (Math.max(0, clipStartSec) / displayDurationSec) * totalWidthPx - scrollLeft + mixerWidth;
      const clipEndPx = (Math.min(displayDurationSec, clipEndSec) / displayDurationSec) * totalWidthPx - scrollLeft + mixerWidth;

      if (fadeIn > 0) {
        const fadeEndSec = Math.min(displayDurationSec, clip.startSec + fadeIn - signalWindow.startSec);
        const fadeEndPx = (Math.max(0, fadeEndSec) / displayDurationSec) * totalWidthPx - scrollLeft + mixerWidth;
        const x0 = Math.max(mixerWidth, clipStartPx);
        const x1 = Math.min(w, fadeEndPx);
        if (x1 > x0) {
          ctx.fillStyle = fadeColor.replace(")", " / 0.12)").replace("hsl(", "hsl(");
          ctx.beginPath();
          ctx.moveTo(x0 * dpr, 0);
          ctx.lineTo(x0 * dpr, h * dpr);
          ctx.lineTo(x1 * dpr, 0);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = fadeColor.replace(")", " / 0.7)").replace("hsl(", "hsl(");
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 2]);
          ctx.beginPath();
          ctx.moveTo(x0 * dpr, h * dpr);
          ctx.lineTo(x1 * dpr, 0);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = fadeColor.replace(")", " / 0.6)").replace("hsl(", "hsl(");
          ctx.font = `${9 * dpr}px monospace`;
          ctx.fillText("FI", ((x0 + x1) / 2 - 4) * dpr, (h - 4) * dpr);
        }
      }

      if (fadeOut > 0) {
        const fadeStartSec = Math.max(0, clip.startSec + clip.durationSec - fadeOut - signalWindow.startSec);
        const fadeStartPx = (Math.min(displayDurationSec, fadeStartSec) / displayDurationSec) * totalWidthPx - scrollLeft + mixerWidth;
        const x0 = Math.max(mixerWidth, fadeStartPx);
        const x1 = Math.min(w, clipEndPx);
        if (x1 > x0) {
          ctx.fillStyle = fadeColor.replace(")", " / 0.12)").replace("hsl(", "hsl(");
          ctx.beginPath();
          ctx.moveTo(x0 * dpr, 0);
          ctx.lineTo(x1 * dpr, 0);
          ctx.lineTo(x1 * dpr, h * dpr);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = fadeColor.replace(")", " / 0.7)").replace("hsl(", "hsl(");
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 2]);
          ctx.beginPath();
          ctx.moveTo(x0 * dpr, 0);
          ctx.lineTo(x1 * dpr, h * dpr);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = fadeColor.replace(")", " / 0.6)").replace("hsl(", "hsl(");
          ctx.font = `${9 * dpr}px monospace`;
          ctx.fillText("FO", ((x0 + x1) / 2 - 4) * dpr, 12 * dpr);
        }
      }
    }

    // Playhead — scene-relative
    const playheadPx = (displayPositionSec / displayDurationSec) * totalWidthPx - scrollLeft + mixerWidth;
    if (playheadPx >= mixerWidth && playheadPx <= w) {
      ctx.strokeStyle = resolveHsl("--primary");
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadPx * dpr, 0);
      ctx.lineTo(playheadPx * dpr, h * dpr);
      ctx.stroke();
    }
    ctx.restore();
  }, [currentPeaks, trackColor, scrollLeft, totalWidthPx, selection, displayDurationSec, displayPositionSec, mixerWidth, sceneClips, signalWindow.startSec, signalWindow.startFrac, signalWindow.endFrac]);

  // ── Keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z) ─────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      if (e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          onRedo?.();
        } else {
          onUndo?.();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onUndo, onRedo]);

  // Redraw on RAF for smooth playhead
  const rafRef = useRef<number>(0);
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

  // ── Mouse handlers for selection + seek (scene-local) ─────
  const pxToSec = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left - mixerWidth + scrollLeft;
      return Math.max(0, Math.min(displayDurationSec, (px / totalWidthPx) * displayDurationSec));
    },
    [scrollLeft, totalWidthPx, displayDurationSec, mixerWidth],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const sec = pxToSec(e.clientX);
      if (e.shiftKey) {
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
        // Click — seek (scene-relative)
        setSelection(null);
        onSeek(signalWindow.startSec + sec);
      }
    },
    [isDragging, pxToSec, onSeek, signalWindow.startSec],
  );

  // ── Zoom controls ─────────────────────────────────────────
  const applyEditorZoom = useCallback((percent: number) => {
    setEditorZoomPercent(percent);
    if (percent > 100) {
      requestAnimationFrame(() => {
        const el = editorScrollRef.current;
        if (!el) return;
        const newTotalW = editorContainerWidth * percent / 100;
        const px = (displayPositionSec / displayDurationSec) * newTotalW;
        el.scrollTo({ left: Math.max(0, px - el.clientWidth / 2), behavior: "smooth" });
      });
    }
  }, [editorContainerWidth, displayPositionSec, displayDurationSec]);

  const adjustEditorZoom = useCallback((dir: "in" | "out") => {
    const presets = EDITOR_ZOOM_PRESETS;
    const cur = editorZoomPercent;
    let next: number;
    if (dir === "in") {
      next = presets.find(p => p > cur) ?? presets[presets.length - 1];
    } else {
      const lower = [...presets].reverse().find(p => p < cur);
      next = lower ?? presets[0];
    }
    applyEditorZoom(next);
  }, [editorZoomPercent, applyEditorZoom]);

  // ── Selection info ─────────────────────────────────────────
  const selectionInfo = selection
    ? `${formatTimePrecise(selection.startSec)} → ${formatTimePrecise(selection.endSec)} (${(selection.endSec - selection.startSec).toFixed(2)}s)`
    : null;

  if (!trackId) {
    return (
      <div className="flex-1 flex items-center justify-center border-t border-border bg-card/30 min-h-[120px]">
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
            {trackLabel}
          </span>
          {sceneLabel && (
            <span className="text-[10px] text-primary/70 font-mono">
              {sceneLabel}
            </span>
          )}
          {status === "loading" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
          {error && <span className="text-[10px] text-destructive">{error}</span>}
          {/* Debug: LOD info */}
          {currentPeaks && (
            <span className="text-[10px] text-muted-foreground/60 font-mono ml-1">
              LOD:{lodLevel.toLocaleString()}|{currentPeaks.left.length.toLocaleString()}pk
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Scene-local time */}
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums mr-1">
            {formatTimePrecise(scenePositionSec)} / {formatTimePrecise(sceneDuration)}
          </span>

          {selectionInfo && (
            <span className="text-[10px] text-muted-foreground font-mono mr-2">{selectionInfo}</span>
          )}

          {/* Editor zoom controls */}
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => adjustEditorZoom("out")} disabled={editorZoomPercent <= 100}>
            <ZoomOut className="h-3 w-3" />
          </Button>
          <Select value={String(editorZoomPercent)} onValueChange={(v) => applyEditorZoom(Number(v))}>
            <SelectTrigger className="h-5 w-[52px] text-[10px] font-body border-none bg-transparent px-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDITOR_ZOOM_PRESETS.map((p) => (
                <SelectItem key={p} value={String(p)} className="text-xs">{p}%</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => adjustEditorZoom("in")} disabled={editorZoomPercent >= 500}>
            <ZoomIn className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => applyEditorZoom(100)}>
            <Maximize2 className="h-3 w-3" />
          </Button>

          <div className="w-px h-3 bg-border/50 mx-0.5" />

          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] gap-0.5"
            disabled={!selection}
            title={isRu ? "Обрезка" : "Trim"}
            onClick={() => {
              if (selection && trackId && onTrim) {
                onTrim(trackId, selection.startSec, selection.endSec);
                setSelection(null);
              }
            }}
          >
            <Scissors className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] gap-0.5"
            disabled={!selection}
            title={isRu ? "Fade In" : "Fade In"}
            onClick={() => {
              if (selection && trackId && onFadeIn) {
                onFadeIn(trackId, selection.endSec - selection.startSec);
                setSelection(null);
              }
            }}
          >
            <ArrowUpRight className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] gap-0.5"
            disabled={!selection}
            title={isRu ? "Fade Out" : "Fade Out"}
            onClick={() => {
              if (selection && trackId && onFadeOut) {
                onFadeOut(trackId, selection.endSec - selection.startSec);
                setSelection(null);
              }
            }}
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
          <div className="w-px h-3 bg-border/50 mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] gap-0.5"
            disabled={!canUndo}
            title={isRu ? "Отменить (Ctrl+Z)" : "Undo (Ctrl+Z)"}
            onClick={onUndo}
          >
            <Undo2 className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] gap-0.5"
            disabled={!canRedo}
            title={isRu ? "Повторить (Ctrl+Shift+Z)" : "Redo (Ctrl+Shift+Z)"}
            onClick={onRedo}
          >
            <Redo2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Canvas with virtual-scroll rendering */}
      <div ref={containerRef} className="flex-1 min-h-0 relative flex">
        <div ref={editorScrollRef} className="flex-1 overflow-x-auto overflow-y-hidden cursor-crosshair relative">
          {/* Invisible spacer — gives the scrollbar the correct total width */}
          <div style={{ width: `${totalWidthPx + mixerWidth}px`, height: "1px", pointerEvents: "none" }} />
          {/* Canvas is viewport-sized, pinned via sticky; drawing uses scrollLeft for virtual offset */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0"
            style={{ width: "100%", height: "100%", position: "sticky", left: 0 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              if (isDragging) setIsDragging(false);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function formatTimePrecise(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toFixed(2).padStart(5, "0")}`;
}
