/**
 * WaveformEditor — professional stereo L/R waveform display with selection,
 * trim, fade in/out, normalize. Canvas-based with virtual rendering.
 * Operates in SCENE-LOCAL coordinates: 100% zoom = ВСЯ длительность сцены на всю ширину вьюпорта редактора.
 * Transport position is relative to scene start.
 */

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Loader2, Scissors, ArrowUpRight, ArrowDownRight, AudioWaveform, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chooseLod, type MultiLodPeaks, type StereoPeaks } from "@/lib/waveformPeaks";
import { useWaveformPeaks, type WaveformStatus } from "@/hooks/useWaveformPeaks";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { getAudioBuffer } from "@/lib/localAudioProvider";
import { computeFFTAtPosition, computeAveragedFFT, setStaticSpectrum } from "@/lib/staticSpectrum";
import type { TimelineClip } from "@/hooks/useTimelineClips";

/** Scene-local segment boundary (from scene_playlists) */
export interface SegmentBoundary {
  startSec: number;
  durationSec: number;
  label?: string;
}

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
  /** Whether transport is currently playing — disables edit controls */
  isPlaying?: boolean;
  /** Segment boundaries from scene_playlists (scene-local coords, relative to scene silence start) */
  segmentBoundaries?: SegmentBoundary[];
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


/** Narrow dB-label zone inside the editor (independent of the timeline mixer sidebar) */
const DB_ZONE_WIDTH = 36;
const SCENE_VIEWPORT_START_SEC = 0;

const EDITOR_ZOOM_PRESETS = [100, 200, 300, 400, 500] as const;

/** Resolve a CSS custom property to a usable hsl() string for Canvas */
function resolveHsl(varName: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return raw ? `hsl(${raw})` : "hsl(190 80% 60%)";
}

// ── Butterfly waveform renderer (L up, R down) ──────────────
const COLOR_L = "hsl(190 80% 55%)";  // cyan
const COLOR_R = "hsl(280 60% 60%)";  // purple

function drawButterfly(
  ctx: CanvasRenderingContext2D,
  peaks: StereoPeaks,
  x: number,
  y: number,
  w: number,
  h: number,
  scrollLeftPx: number,
  totalWidthPx: number,
  selection: Selection | null,
  totalDuration: number,
) {
  const dpr = window.devicePixelRatio || 1;
  const peakCount = peaks.left.length;

  const viewStartFrac = Math.max(0, scrollLeftPx / totalWidthPx);
  const viewEndFrac = Math.min(1, (scrollLeftPx + w) / totalWidthPx);
  const startIdx = Math.max(0, Math.floor(viewStartFrac * peakCount));
  const endIdx = Math.min(peakCount, Math.ceil(viewEndFrac * peakCount));
  const visiblePeaks = endIdx - startIdx;
  if (visiblePeaks <= 0) return;

  const mid = y + h / 2;
  const amp = h / 2 * 0.9;

  // Helper to draw one half-wave
  const drawHalf = (data: Float32Array, color: string, direction: 1 | -1) => {
    ctx.beginPath();
    // Start at center
    const firstIdx = startIdx;
    const firstFrac = firstIdx / peakCount;
    const firstPx = (x + firstFrac * totalWidthPx - scrollLeftPx) * dpr;
    ctx.moveTo(firstPx, mid * dpr);

    // Draw wave edge
    for (let i = 0; i <= visiblePeaks; i++) {
      const idx = startIdx + i;
      if (idx >= peakCount) break;
      const idxFrac = idx / peakCount;
      const px = (x + idxFrac * totalWidthPx - scrollLeftPx) * dpr;
      const val = Math.abs(data[idx] || 0);
      const yPos = mid + direction * val * amp;
      ctx.lineTo(px, yPos * dpr);
    }

    // Close back to center
    const lastIdx = Math.min(startIdx + visiblePeaks, peakCount - 1);
    const lastFrac = lastIdx / peakCount;
    const lastPx = (x + lastFrac * totalWidthPx - scrollLeftPx) * dpr;
    ctx.lineTo(lastPx, mid * dpr);
    ctx.closePath();

    ctx.fillStyle = color.replace(")", " / 0.18)").replace("hsl(", "hsl(");
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  // L channel: positive (up)
  drawHalf(peaks.left, COLOR_L, -1);
  // R channel: negative (down)
  drawHalf(peaks.right, COLOR_R, 1);

  // Center line
  ctx.strokeStyle = resolveHsl("--muted-foreground").replace(")", " / 0.3)").replace("hsl(", "hsl(");
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(x * dpr, mid * dpr);
  ctx.lineTo((x + w) * dpr, mid * dpr);
  ctx.stroke();

  // Channel labels
  ctx.font = `bold ${10 * dpr}px monospace`;
  ctx.fillStyle = COLOR_L.replace(")", " / 0.6)").replace("hsl(", "hsl(");
  ctx.fillText("L", (x + 4) * dpr, (y + 12) * dpr);
  ctx.fillStyle = COLOR_R.replace(")", " / 0.6)").replace("hsl(", "hsl(");
  ctx.fillText("R", (x + 4) * dpr, (y + h - 4) * dpr);

  // Selection highlight
  if (selection) {
    const selStartPx = x + (selection.startSec / totalDuration) * totalWidthPx - scrollLeftPx;
    const selEndPx = x + (selection.endSec / totalDuration) * totalWidthPx - scrollLeftPx;
    const sx = Math.max(0, selStartPx) * dpr;
    const sw = (Math.min(w, selEndPx) - Math.max(0, selStartPx)) * dpr;
    if (sw > 0) {
      ctx.fillStyle = resolveHsl("--primary").replace(")", " / 0.15)").replace("hsl(", "hsl(");
      ctx.fillRect(sx, y * dpr, sw, h * dpr);
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
  isPlaying = false,
  segmentBoundaries,
  onSeek,
  onTrim,
  onFadeIn,
  onFadeOut,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: WaveformEditorProps) {
  const { storage } = useProjectStorageContext();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<number>(0);
  const [staticSpectrumActive, setStaticSpectrumActive] = useState(false);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const loadingBufferRef = useRef(false);

  // ── Editor-local zoom (100% = scene fits entire width) ─────
  const [editorZoomPercent, setEditorZoomPercent] = useState(100);
  const [editorContainerWidth, setEditorContainerWidth] = useState(0);

  // Measure available waveform width (excluding dB label zone).
  // IMPORTANT: depends on trackId because component can render "empty" state first (no container mounted).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      setEditorContainerWidth(0);
      return;
    }

    const measure = () => {
      const w = el.clientWidth - DB_ZONE_WIDTH;
      setEditorContainerWidth(w > 0 ? w : 0);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [trackId]);

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

  // Scene viewport contract: 100% zoom ALWAYS means full scene width (including silence).
  const displayDurationSec = useMemo(() => {
    const fallbackDuration = sceneClips.reduce((maxEnd, clip) => Math.max(maxEnd, clip.startSec + clip.durationSec), 0.05);
    return Math.max(0.05, sceneDuration > 0 ? sceneDuration : fallbackDuration);
  }, [sceneDuration, sceneClips]);

  // Choose LOD based on visible area of the full scene window
  const visibleWidth = editorContainerWidth;
  const visibleDurationSec = visibleWidth > 0 && totalWidthPx > 0
    ? (visibleWidth / totalWidthPx) * displayDurationSec
    : displayDurationSec;
  const lodLevel = useMemo(
    () => chooseLod(visibleWidth, displayDurationSec, visibleDurationSec, lodLevels),
    [visibleWidth, displayDurationSec, visibleDurationSec, lodLevels],
  );

  const currentPeaks = peaks?.lods.get(lodLevel) ?? (peaks ? peaks.lods.values().next().value : null);

  const displayPositionSec = Math.max(0, Math.min(scenePositionSec - SCENE_VIEWPORT_START_SEC, displayDurationSec));

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

    

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Background
    ctx.fillStyle = resolveHsl("--background");
    ctx.fillRect(0, 0, w * dpr, h * dpr);

    const borderColor = resolveHsl("--border");
    const mutedColor = resolveHsl("--muted-foreground");
    
    const waveW = w - DB_ZONE_WIDTH;

    // ── dB scale in mixer sidebar area ──────────────────────
    const drawDbScale = () => {
      const mid = h / 2;
      const amp = h / 2 * 0.9;

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
        ctx.moveTo(DB_ZONE_WIDTH * dpr, yUp * dpr);
        ctx.lineTo(w * dpr, yUp * dpr);
        ctx.stroke();

        if (db !== 0) {
          ctx.beginPath();
          ctx.moveTo(DB_ZONE_WIDTH * dpr, yDown * dpr);
          ctx.lineTo(w * dpr, yDown * dpr);
          ctx.stroke();
        }

        ctx.setLineDash([]);

        ctx.fillStyle = mutedColor.replace(")", " / 0.5)").replace("hsl(", "hsl(");
        const label = db === 0 ? " 0" : `${db}`;
        ctx.fillText(label, (DB_ZONE_WIDTH - 4) * dpr, (yUp + 3) * dpr);
        if (db !== 0 && db !== -60) {
          ctx.fillText(label, (DB_ZONE_WIDTH - 4) * dpr, (yDown + 3) * dpr);
        }
      }
      ctx.textAlign = "left";
    };

    drawDbScale();

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
        const px = (t / displayDurationSec) * totalWidthPx - scrollLeft + DB_ZONE_WIDTH;
        if (px < DB_ZONE_WIDTH || px > w) continue;

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
    ctx.moveTo(DB_ZONE_WIDTH * dpr, 0);
    ctx.lineTo(DB_ZONE_WIDTH * dpr, h * dpr);
    ctx.stroke();

    // Clip to waveform area
    ctx.save();
    ctx.beginPath();
    ctx.rect(DB_ZONE_WIDTH * dpr, 0, (w - DB_ZONE_WIDTH) * dpr, h * dpr);
    ctx.clip();

    // Draw butterfly waveform (L up, R down)
    drawButterfly(
      ctx,
      currentPeaks,
      DB_ZONE_WIDTH,
      0,
      waveW,
      h,
      scrollLeft,
      totalWidthPx,
      selection,
      displayDurationSec,
    );

    // ── Draw segment boundaries from scene_playlists ────────────
    const boundaries = segmentBoundaries ?? [];
    if (boundaries.length > 0) {
      const segColor = "hsl(50 100% 55%)"; // bright yellow
      ctx.save();
      for (let si = 0; si < boundaries.length; si++) {
        const seg = boundaries[si];
        const localSec = seg.startSec;
        // Skip boundaries at the very start/end of scene
        if (si > 0 && (localSec <= 0.01 || localSec >= displayDurationSec - 0.01)) continue;
        const px = (localSec / displayDurationSec) * totalWidthPx - scrollLeft + DB_ZONE_WIDTH;
        if (px < DB_ZONE_WIDTH || px > w) continue;

        // Dashed yellow line
        ctx.strokeStyle = segColor.replace(")", " / 0.6)").replace("hsl(", "hsl(");
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(px * dpr, 0);
        ctx.lineTo(px * dpr, h * dpr);
        ctx.stroke();

        // Number label on every boundary (1-based segment number)
        const segNum = si + 1;
        ctx.setLineDash([]);
        ctx.fillStyle = segColor;
        ctx.font = `bold ${9 * dpr}px monospace`;
        ctx.fillText(`${segNum}`, (px + 2) * dpr, 10 * dpr);
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── Draw fade envelopes for each clip ───────────────────
    const fadeColor = resolveHsl("--primary");
    for (const clip of sceneClips) {
      const fadeIn = clip.fadeInSec ?? 0;
      const fadeOut = clip.fadeOutSec ?? 0;
      if (fadeIn <= 0 && fadeOut <= 0) continue;

      const clipStartSec = clip.startSec;
      const clipEndSec = clip.startSec + clip.durationSec;
      if (clipEndSec <= 0 || clipStartSec >= displayDurationSec) continue;

      const clipStartPx = (Math.max(0, clipStartSec) / displayDurationSec) * totalWidthPx - scrollLeft + DB_ZONE_WIDTH;
      const clipEndPx = (Math.min(displayDurationSec, clipEndSec) / displayDurationSec) * totalWidthPx - scrollLeft + DB_ZONE_WIDTH;

      if (fadeIn > 0) {
        const fadeEndSec = Math.min(displayDurationSec, clip.startSec + fadeIn);
        const fadeEndPx = (Math.max(0, fadeEndSec) / displayDurationSec) * totalWidthPx - scrollLeft + DB_ZONE_WIDTH;
        const x0 = Math.max(DB_ZONE_WIDTH, clipStartPx);
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
        const fadeStartSec = Math.max(0, clip.startSec + clip.durationSec - fadeOut);
        const fadeStartPx = (Math.min(displayDurationSec, fadeStartSec) / displayDurationSec) * totalWidthPx - scrollLeft + DB_ZONE_WIDTH;
        const x0 = Math.max(DB_ZONE_WIDTH, fadeStartPx);
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
    const playheadPx = (displayPositionSec / displayDurationSec) * totalWidthPx - scrollLeft + DB_ZONE_WIDTH;
    if (playheadPx >= DB_ZONE_WIDTH && playheadPx <= w) {
      ctx.strokeStyle = resolveHsl("--primary");
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadPx * dpr, 0);
      ctx.lineTo(playheadPx * dpr, h * dpr);
      ctx.stroke();
    }
    ctx.restore();
  }, [currentPeaks, trackColor, scrollLeft, totalWidthPx, selection, displayDurationSec, displayPositionSec, sceneClips, segmentBoundaries]);

  // ── Keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z) ─────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || isPlaying) return;
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

  // ── Static spectrum computation ──────────────────────────────
  const loadAudioBuffer = useCallback(async () => {
    if (loadingBufferRef.current || audioBufferRef.current || !storage) return audioBufferRef.current;
    const clip = sceneClips.find(c => c.hasAudio && c.audioPath);
    if (!clip?.audioPath) return null;
    loadingBufferRef.current = true;
    try {
      const arrayBuf = await getAudioBuffer(storage, clip.audioPath);
      if (!arrayBuf) return null;
      const decodeCtx = new OfflineAudioContext(2, 44100 * 60, 44100);
      const decoded = await decodeCtx.decodeAudioData(arrayBuf.slice(0));
      audioBufferRef.current = decoded;
      return decoded;
    } catch (e) {
      console.warn("[WaveformEditor] Failed to load buffer for static FFT:", e);
      return null;
    } finally {
      loadingBufferRef.current = false;
    }
  }, [sceneClips, storage]);

  // Clear buffer when scene changes
  useEffect(() => {
    audioBufferRef.current = null;
  }, [sceneLabel]);

  // Cleanup static spectrum on unmount or deactivation
  useEffect(() => {
    if (!staticSpectrumActive) {
      setStaticSpectrum(null);
    }
    return () => setStaticSpectrum(null);
  }, [staticSpectrumActive]);

  const handleStaticSpectrum = useCallback(async () => {
    if (staticSpectrumActive) {
      setStaticSpectrumActive(false);
      setStaticSpectrum(null);
      return;
    }
    const buf = await loadAudioBuffer();
    if (!buf) return;

    const FFT_SIZE = 256; // 128 bins output
    let bins: Float32Array;
    let label: string;

    if (selection && selection.endSec - selection.startSec > 0.05) {
      bins = computeAveragedFFT(buf, selection.startSec, selection.endSec, FFT_SIZE, 24);
      label = `AVG ${formatTimePrecise(selection.startSec)}–${formatTimePrecise(selection.endSec)}`;
    } else {
      bins = computeFFTAtPosition(buf, displayPositionSec, FFT_SIZE);
      label = `@ ${formatTimePrecise(displayPositionSec)}`;
    }

    setStaticSpectrum({ bins, label });
    setStaticSpectrumActive(true);
  }, [staticSpectrumActive, selection, displayPositionSec, loadAudioBuffer]);

  // Update static spectrum when playhead moves (if active & no selection & stopped)
  useEffect(() => {
    if (!staticSpectrumActive || isPlaying || !audioBufferRef.current) return;
    if (selection && selection.endSec - selection.startSec > 0.05) return; // selection mode — don't update on playhead
    const buf = audioBufferRef.current;
    const bins = computeFFTAtPosition(buf, displayPositionSec, 256);
    setStaticSpectrum({ bins, label: `@ ${formatTimePrecise(displayPositionSec)}` });
  }, [staticSpectrumActive, displayPositionSec, isPlaying, selection]);

  // Update static spectrum when selection changes (if active)
  useEffect(() => {
    if (!staticSpectrumActive || !audioBufferRef.current || !selection) return;
    if (selection.endSec - selection.startSec < 0.05) return;
    const buf = audioBufferRef.current;
    const bins = computeAveragedFFT(buf, selection.startSec, selection.endSec, 256, 24);
    setStaticSpectrum({ bins, label: `AVG ${formatTimePrecise(selection.startSec)}–${formatTimePrecise(selection.endSec)}` });
  }, [staticSpectrumActive, selection]);

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
      const px = clientX - rect.left - DB_ZONE_WIDTH + scrollLeft;
      return Math.max(0, Math.min(displayDurationSec, (px / totalWidthPx) * displayDurationSec));
    },
    [scrollLeft, totalWidthPx, displayDurationSec],
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
        onSeek(SCENE_VIEWPORT_START_SEC + sec);
      }
    },
    [isDragging, pxToSec, onSeek],
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
        </div>

        <div className="flex items-center gap-1">
          {/* Scene-local time */}
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums mr-1">
            {formatTimePrecise(displayPositionSec)} / {formatTimePrecise(displayDurationSec)}
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
            disabled={!selection || isPlaying}
            title={isRu ? "Обрезка" : "Trim"}
            onClick={() => {
              if (selection && trackId && onTrim) {
                onTrim(trackId, selection.startSec + SCENE_VIEWPORT_START_SEC, selection.endSec + SCENE_VIEWPORT_START_SEC);
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
            disabled={!selection || isPlaying}
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
            disabled={!selection || isPlaying}
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
          <div className="w-px h-3 bg-border/50 mx-0.5" />
          <Button
            variant={staticSpectrumActive ? "default" : "ghost"}
            size="sm"
            className="h-5 px-1.5 text-[10px] gap-0.5"
            disabled={isPlaying}
            title={isRu
              ? (selection ? "Усреднённый спектр выделения" : "Статический спектр в позиции")
              : (selection ? "Averaged spectrum of selection" : "Static spectrum at position")}
            onClick={handleStaticSpectrum}
          >
            <BarChart3 className="h-3 w-3" />
          </Button>
          <div className="w-px h-3 bg-border/50 mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] gap-0.5"
            disabled={!canUndo || isPlaying}
            title={isRu ? "Отменить (Ctrl+Z)" : "Undo (Ctrl+Z)"}
            onClick={onUndo}
          >
            <Undo2 className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] gap-0.5"
            disabled={!canRedo || isPlaying}
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
          <div style={{ width: `${totalWidthPx + DB_ZONE_WIDTH}px`, height: "1px", pointerEvents: "none" }} />
          {/* Canvas is viewport-sized, pinned via sticky; drawing uses scrollLeft for virtual offset */}
          <canvas
            ref={canvasRef}
            className="sticky left-0 top-0 block"
            style={{ width: "100%", height: "100%" }}
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
