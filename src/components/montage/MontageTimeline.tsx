import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import { ZoomIn, ZoomOut, Maximize2, Play, Pause, Square, Volume2, VolumeX, ChevronUp, ChevronDown, Loader2, RefreshCw, AlertTriangle, Scissors, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTimelinePlayer } from "@/hooks/useTimelinePlayer";
import { supabase } from "@/integrations/supabase/client";

import { getAudioEngine } from "@/lib/audioEngine";
import { useMixerPersistence } from "@/hooks/useMixerPersistence";
import { TimelineMasterMeter } from "@/components/studio/TimelineMasterMeter";
import { TimelineRuler } from "@/components/studio/TimelineRuler";
import { Playhead } from "@/components/studio/TimelinePlayhead";
import { TrackMixerStrip } from "@/components/studio/TrackMixerStrip";
import { WaveformEditor, type SegmentBoundary } from "@/components/montage/WaveformEditor";
import { getStemTracks } from "@/hooks/useMontageData";
import type { TimelineClip, SceneBoundary } from "@/hooks/useTimelineClips";

const MIXER_SIDEBAR = 160;

const MONTAGE_ZOOM_PRESETS = [95, 100, 200, 300, 400, 500] as const;

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

interface MontageTimelineProps {
  clips: TimelineClip[];
  sceneBoundaries: SceneBoundary[];
  totalDurationSec: number;
  chapterId: string | null;
  isRu: boolean;
  onSplitAtScene?: (sceneId: string) => void;
  hasParts?: boolean;
}

export function MontageTimeline({ clips, sceneBoundaries, totalDurationSec, chapterId, isRu, onSplitAtScene, hasParts }: MontageTimelineProps) {
  // ── Trim & Fade overrides ──────────────────────────────────
  const [trimOverrides, setTrimOverrides] = useState<Map<string, { offsetSec: number; newDurationSec: number }>>(new Map());
  const [fadeOverrides, setFadeOverrides] = useState<Map<string, { fadeInSec: number; fadeOutSec: number }>>(new Map());

  // ── Undo/Redo stack ──────────────────────────────────────
  type UndoSnapshot = {
    trimOverrides: Map<string, { offsetSec: number; newDurationSec: number }>;
    fadeOverrides: Map<string, { fadeInSec: number; fadeOutSec: number }>;
  };
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<UndoSnapshot[]>([]);
  const trimRef = useRef(trimOverrides);
  trimRef.current = trimOverrides;
  const fadeRef = useRef(fadeOverrides);
  fadeRef.current = fadeOverrides;

  const pushUndo = useCallback(() => {
    setUndoStack(prev => [...prev.slice(-19), {
      trimOverrides: new Map(trimRef.current),
      fadeOverrides: new Map(fadeRef.current),
    }]);
    // Clear redo stack on new action
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];
      // Save current state to redo stack before undoing
      setRedoStack(r => [...r, {
        trimOverrides: new Map(trimRef.current),
        fadeOverrides: new Map(fadeRef.current),
      }]);
      setTrimOverrides(snapshot.trimOverrides);
      setFadeOverrides(snapshot.fadeOverrides);
      toast.success(isRu ? "Отменено" : "Undone");
      return prev.slice(0, -1);
    });
  }, [isRu]);

  const handleRedo = useCallback(() => {
    setRedoStack(prev => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];
      // Save current state to undo stack before redoing
      setUndoStack(u => [...u.slice(-19), {
        trimOverrides: new Map(trimRef.current),
        fadeOverrides: new Map(fadeRef.current),
      }]);
      setTrimOverrides(snapshot.trimOverrides);
      setFadeOverrides(snapshot.fadeOverrides);
      toast.success(isRu ? "Повторено" : "Redone");
      return prev.slice(0, -1);
    });
  }, [isRu]);

  const trimmedClips = useMemo(() => {
    if (trimOverrides.size === 0) return clips;
    return clips.map(clip => {
      const t = trimOverrides.get(clip.id);
      if (!t) return clip;
      return {
        ...clip,
        startSec: clip.startSec + t.offsetSec,
        durationSec: t.newDurationSec,
      };
    }).filter(c => c.durationSec > 0.01);
  }, [clips, trimOverrides]);

  const stemTracks = useMemo(() => getStemTracks(isRu), [isRu]);
  const trackIds = useMemo(() => stemTracks.map(t => t.id), [stemTracks]);
  const { scheduleSave: onMixChange } = useMixerPersistence(chapterId, trackIds);

  const [timelineHeight, setTimelineHeight] = useState(450);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);

  // ── Trim handler ────────────────────────────────────────────
  const handleTrim = useCallback((trackId: string, selStart: number, selEnd: number) => {
    pushUndo();
    const trackClips = trimmedClips.filter(c => c.trackId === trackId);
    if (trackClips.length === 0) return;

    const newOverrides = new Map(trimOverrides);
    let trimCount = 0;

    for (const clip of trackClips) {
      const clipEnd = clip.startSec + clip.durationSec;
      // Original clip values (before any trim)
      const origClip = clips.find(c => c.id === clip.id);
      if (!origClip) continue;
      const existingTrim = trimOverrides.get(clip.id);
      const prevOffset = existingTrim?.offsetSec ?? 0;

      // No overlap — remove clip entirely
      if (clip.startSec >= selEnd || clipEnd <= selStart) {
        newOverrides.set(clip.id, { offsetSec: prevOffset, newDurationSec: 0 });
        trimCount++;
        continue;
      }

      // Partial overlap — trim head and/or tail
      const trimHead = Math.max(0, selStart - clip.startSec);
      const trimTail = Math.max(0, clipEnd - selEnd);
      const newDur = clip.durationSec - trimHead - trimTail;

      if (trimHead > 0.01 || trimTail > 0.01) {
        newOverrides.set(clip.id, {
          offsetSec: prevOffset + trimHead,
          newDurationSec: Math.max(0, newDur),
        });
        trimCount++;
      }
    }

    if (trimCount > 0) {
      setTrimOverrides(newOverrides);
      toast.success(
        isRu
          ? `Обрезано ${trimCount} клип(ов) на треке`
          : `Trimmed ${trimCount} clip(s) on track`,
      );
    }
  }, [trimmedClips, clips, trimOverrides, pushUndo, isRu]);

  // Apply fade overrides to trimmedClips
  const fadedClips = useMemo(() => {
    if (fadeOverrides.size === 0) return trimmedClips;
    return trimmedClips.map(clip => {
      const f = fadeOverrides.get(clip.id);
      if (!f) return clip;
      return { ...clip, fadeInSec: f.fadeInSec, fadeOutSec: f.fadeOutSec };
    });
  }, [trimmedClips, fadeOverrides]);

  const player = useTimelinePlayer(fadedClips);
  const duration = player.totalDuration > 0 ? player.totalDuration : totalDurationSec;

  const handleFadeIn = useCallback((trackId: string, fadeDurationSec: number) => {
    pushUndo();
    const affected = fadedClips.filter(c => c.trackId === trackId);
    if (affected.length === 0) return;
    const newOverrides = new Map(fadeOverrides);
    let count = 0;
    for (const clip of affected) {
      const existing = fadeOverrides.get(clip.id);
      newOverrides.set(clip.id, {
        fadeInSec: Math.min(fadeDurationSec, clip.durationSec * 0.5),
        fadeOutSec: existing?.fadeOutSec ?? clip.fadeOutSec ?? 0,
      });
      count++;
      // Apply to audio engine
      const engine = getAudioEngine();
      engine.setTrackFadeIn?.(clip.id, Math.min(fadeDurationSec, clip.durationSec * 0.5));
    }
    setFadeOverrides(newOverrides);
    toast.success(isRu ? `Fade In: ${fadeDurationSec.toFixed(2)}s` : `Fade In: ${fadeDurationSec.toFixed(2)}s`);
  }, [fadedClips, fadeOverrides, isRu]);

  const handleFadeOut = useCallback((trackId: string, fadeDurationSec: number) => {
    pushUndo();
    const affected = fadedClips.filter(c => c.trackId === trackId);
    if (affected.length === 0) return;
    const newOverrides = new Map(fadeOverrides);
    for (const clip of affected) {
      const existing = fadeOverrides.get(clip.id);
      newOverrides.set(clip.id, {
        fadeInSec: existing?.fadeInSec ?? clip.fadeInSec ?? 0,
        fadeOutSec: Math.min(fadeDurationSec, clip.durationSec * 0.5),
      });
      const engine = getAudioEngine();
      engine.setTrackFadeOut?.(clip.id, Math.min(fadeDurationSec, clip.durationSec * 0.5));
    }
    setFadeOverrides(newOverrides);
    toast.success(isRu ? `Fade Out: ${fadeDurationSec.toFixed(2)}s` : `Fade Out: ${fadeDurationSec.toFixed(2)}s`);
  }, [fadedClips, fadeOverrides, isRu]);

  // ── Zoom ────────────────────────────────────────────────────
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = tracksContainerRef.current;
    if (!el) { setContainerWidth(0); return; }
    const measure = () => setContainerWidth(el.clientWidth - MIXER_SIDEBAR);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [timelineCollapsed]);

  const sceneScrollRef = useRef<HTMLDivElement>(null);

  const fitZoom = useMemo(() => {
    if (containerWidth <= 0 || duration <= 0) return 1;
    return containerWidth / (duration * 4);
  }, [containerWidth, duration]);

  const [montageZoomPercent, setMontageZoomPercent] = useState<number>(100);
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const zoom = zoomOverride ?? fitZoom;

  useEffect(() => { setZoomOverride(null); setMontageZoomPercent(100); }, [fitZoom]);

  const applyMontageZoom = useCallback((percent: number) => {
    setMontageZoomPercent(percent);
    const newZoom = percent === 100 ? fitZoom : (fitZoom * percent) / 100;
    if (percent === 100) {
      setZoomOverride(null);
    } else {
      setZoomOverride(newZoom);
    }
    if (percent > 100) {
      requestAnimationFrame(() => {
        const el = sceneScrollRef.current;
        if (!el) return;
        const px = player.positionSec * newZoom * 4;
        el.scrollTo({ left: Math.max(0, px - el.clientWidth / 2), behavior: "smooth" });
      });
    }
  }, [fitZoom, player.positionSec]);

  const adjustZoom = useCallback((dir: "in" | "out") => {
    const presets = MONTAGE_ZOOM_PRESETS;
    const cur = montageZoomPercent;
    let next: number;
    if (dir === "in") {
      next = presets.find(p => p > cur) ?? presets[presets.length - 1];
    } else {
      const lower = [...presets].reverse().find(p => p < cur);
      next = lower ?? presets[0];
    }
    applyMontageZoom(next);
  }, [montageZoomPercent, applyMontageZoom]);

  const resetZoom = useCallback(() => applyMontageZoom(100), [applyMontageZoom]);

  // ── Auto-scroll during playback ───────────────────────────
  const userScrollingRef = useRef(false);
  useEffect(() => {
    const el = sceneScrollRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      userScrollingRef.current = true;
      clearTimeout(timer);
      timer = setTimeout(() => { userScrollingRef.current = false; }, 600);
    };
    // Initial measure
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (player.state !== "playing" || montageZoomPercent <= 100 || userScrollingRef.current) return;
    const el = sceneScrollRef.current;
    if (!el) return;
    const playheadPx = player.positionSec * zoom * 4;
    el.scrollLeft = Math.max(0, playheadPx - el.clientWidth / 2);
  }, [player.positionSec, player.state, zoom, montageZoomPercent]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = timelineHeight;
    const onMove = (ev: MouseEvent) => {
      setTimelineHeight(Math.min(Math.max(160, startH + (startY - ev.clientY)), Math.floor(window.innerHeight * 0.6)));
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [timelineHeight]);

  // ── Clips grouped by track ──────────────────────────────────
  const clipsByTrack = useMemo(() => {
    const map = new Map<string, TimelineClip[]>();
    for (const clip of trimmedClips) {
      const list = map.get(clip.trackId) ?? [];
      list.push(clip);
      map.set(clip.trackId, list);
    }
    return map;
  }, [trimmedClips]);

  // ── Current scene context for WaveformEditor ────────────────
  const currentSceneIdx = useMemo(() => {
    if (sceneBoundaries.length === 0) return 0;
    for (let i = sceneBoundaries.length - 1; i >= 0; i--) {
      if (player.positionSec >= sceneBoundaries[i].startSec) return i;
    }
    return 0;
  }, [player.positionSec, sceneBoundaries]);

  const currentBoundary = sceneBoundaries[currentSceneIdx];
  const nextBoundary = sceneBoundaries[currentSceneIdx + 1];
  const sceneStartSec = currentBoundary?.startSec ?? 0;

  const sceneEndSec = useMemo(() => {
    if (nextBoundary) return nextBoundary.startSec;
    return fadedClips
      .filter((c) => c.sceneId === currentBoundary?.sceneId)
      .reduce((max, c) => Math.max(max, c.startSec + c.durationSec), sceneStartSec);
  }, [nextBoundary, fadedClips, currentBoundary?.sceneId, sceneStartSec]);

  /**
   * Waveform viewport contract:
   * - 100% zoom = активный stem заполняет всю ширину редактора
   * - начало viewport всегда в начале сцены (включая стартовую тишину)
   * - конец viewport привязан к окончанию активного stem (fallback: конец сцены)
   */
  const waveformViewportEndSec = useMemo(() => {
    if (!currentBoundary) return sceneEndSec;
    if (!selectedTrackId) return sceneEndSec;

    const selectedSceneClips = fadedClips.filter(
      (c) => c.sceneId === currentBoundary.sceneId && c.trackId === selectedTrackId,
    );

    if (selectedSceneClips.length === 0) return sceneEndSec;

    return selectedSceneClips.reduce(
      (maxEnd, clip) => Math.max(maxEnd, Math.min(sceneEndSec, clip.startSec + clip.durationSec)),
      sceneStartSec,
    );
  }, [currentBoundary, selectedTrackId, fadedClips, sceneEndSec, sceneStartSec]);

  const waveformSceneDuration = Math.max(0.05, waveformViewportEndSec - sceneStartSec);
  const waveformScenePositionSec = Math.max(
    0,
    Math.min(player.positionSec - sceneStartSec, waveformSceneDuration),
  );

  const waveformSceneClips = useMemo(() => {
    if (!selectedTrackId || !currentBoundary) return [];

    return fadedClips
      .filter((c) => c.trackId === selectedTrackId && c.sceneId === currentBoundary.sceneId)
      .map((c) => ({
        ...c,
        startSec: Math.max(0, c.startSec - sceneStartSec),
        durationSec:
          Math.min(c.startSec + c.durationSec, waveformViewportEndSec) -
          Math.max(c.startSec, sceneStartSec),
      }))
      .filter((c) => c.durationSec > 0.001);
  }, [fadedClips, selectedTrackId, currentBoundary, sceneStartSec, waveformViewportEndSec]);

  const waveformSceneLabel = currentBoundary
    ? `${isRu ? "Сцена" : "Scene"} ${currentSceneIdx + 1}/${sceneBoundaries.length}`
    : "";

  // ── Fetch segment boundaries from scene_playlists ───────────
  const [segmentBoundaries, setSegmentBoundaries] = useState<SegmentBoundary[]>([]);
  const currentSceneId = currentBoundary?.sceneId ?? null;
  const silenceSec = currentBoundary?.silenceSec ?? 2;

  useEffect(() => {
    if (!currentSceneId) { setSegmentBoundaries([]); return; }
    let cancelled = false;

    supabase
      .from("scene_playlists")
      .select("segments")
      .eq("scene_id", currentSceneId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data?.segments || !Array.isArray(data.segments)) {
          setSegmentBoundaries([]);
          return;
        }

        const segs = (data.segments as Array<Record<string, unknown>>)
          .filter((s) => typeof s.start_ms === "number" && typeof s.duration_ms === "number")
          .map((s) => {
            const startAbsSec = (s.start_ms as number) / 1000;
            const durationSec = (s.duration_ms as number) / 1000;
            const startSec = startAbsSec - sceneStartSec;
            return {
              startSec,
              durationSec,
              label: (s.speaker as string) ?? undefined,
            };
          })
          .filter((s) => s.durationSec > 0 && s.startSec < waveformSceneDuration && s.startSec + s.durationSec > 0)
          .sort((a, b) => a.startSec - b.startSec);

        setSegmentBoundaries(segs);
      });

    return () => { cancelled = true; };
  }, [currentSceneId, sceneStartSec, waveformSceneDuration]);

  const handleSceneSeek = useCallback(
    (sceneRelativeSec: number) => {
      player.seek(sceneStartSec + sceneRelativeSec);
    },
    [player.seek, sceneStartSec],
  );

  return (
    <div
      className="flex flex-col bg-background border-t border-border shrink-0"
      style={{ height: timelineCollapsed ? 41 : timelineHeight }}
    >
      {!timelineCollapsed && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="h-2 cursor-row-resize hover:bg-primary/30 bg-border/50 transition-colors shrink-0 flex items-center justify-center"
        >
          <div className="w-8 h-0.5 rounded-full bg-muted-foreground/30" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setTimelineCollapsed(!timelineCollapsed)} className="flex items-center gap-1.5 hover:text-foreground transition-colors">
            {timelineCollapsed ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-body">
              {isRu ? "Стемы" : "Stems"}
            </span>
          </button>

          {/* Loading progress */}
          {player.loadProgress && player.loadProgress.total > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground animate-in fade-in">
              {player.loadProgress.done < player.loadProgress.total ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  <div className="flex items-center gap-1.5">
                    <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${(player.loadProgress.done / player.loadProgress.total) * 100}%` }}
                      />
                    </div>
                    <span className="font-mono tabular-nums">{player.loadProgress.done}/{player.loadProgress.total}</span>
                    {player.loadProgress.failed > 0 && (
                      <span className="text-destructive font-mono tabular-nums flex items-center gap-0.5">
                        <AlertTriangle className="h-3 w-3" />{player.loadProgress.failed}
                      </span>
                    )}
                    <span className="max-w-[160px] truncate font-body opacity-70">{player.loadProgress.currentLabel}</span>
                  </div>
                </>
              ) : player.loadProgress.failed > 0 ? (
                <>
                  <AlertTriangle className="h-3 w-3 text-destructive" />
                  <span className="text-destructive font-body">
                    {player.loadProgress.failed} {isRu ? "не загружено" : "failed"}
                  </span>
                  <span className="font-mono tabular-nums">
                    {player.loadProgress.loaded}/{player.loadProgress.total}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-5 px-2 text-[10px] gap-1"
                    onClick={player.retryFailed}
                  >
                    <RefreshCw className="h-3 w-3" />
                    {isRu ? "Повторить" : "Retry"}
                  </Button>
                </>
              ) : null}
            </div>
          )}

          {/* Transport */}
          <div className="flex items-center gap-0.5">
            {player.state === "playing" ? (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={player.pause}><Pause className="h-3.5 w-3.5" /></Button>
            ) : (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={player.play} disabled={!player.hasAudio || (player.loadProgress != null && player.loadProgress.total > 0 && player.loadProgress.done < player.loadProgress.total)}><Play className="h-3.5 w-3.5" /></Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={player.stop} disabled={player.state === "stopped"}><Square className="h-3 w-3" /></Button>
            <span className="text-[11px] text-muted-foreground font-mono min-w-[70px] text-center tabular-nums">
              {formatTime(player.positionSec)} / {formatTime(player.totalDuration)}
            </span>
            <TimelineMasterMeter />
            <div className="flex items-center gap-1 ml-1">
              <button onClick={() => player.changeVolume(player.volume > 0 ? 0 : 80)} className="text-muted-foreground hover:text-foreground transition-colors">
                {player.volume === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </button>
              <input type="range" min={0} max={100} value={player.volume} onChange={e => player.changeVolume(Number(e.target.value))} className="w-[72px] h-0.5 accent-primary cursor-pointer volume-slider-sm" />
            </div>

            {/* Insert silence */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[10px] gap-1 text-muted-foreground hover:text-primary ml-1"
                  title={isRu ? "Вставить тишину" : "Insert silence"}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="font-body">{isRu ? "Тишина" : "Silence"}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2" align="start">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground font-body mb-1">
                    {isRu ? "Длительность тишины" : "Silence duration"}
                  </span>
                  <div className="flex gap-1">
                    {[0.25, 0.5, 1.0, 2.0].map((dur) => (
                      <Button
                        key={dur}
                        variant="outline"
                        size="sm"
                        className="h-7 px-3 text-xs font-mono"
                        onClick={() => {
                          console.log(`[MontageTimeline] Insert silence ${dur}s at position ${player.positionSec.toFixed(3)}s`);
                          toast.info(isRu ? `Тишина ${dur}с (в разработке)` : `Silence ${dur}s (coming soon)`);
                        }}
                      >
                        {dur}s
                      </Button>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Split button */}
          {onSplitAtScene && (() => {
            // Find which scene boundary the transport is within
            const pos = player.positionSec;
            let splitSceneId: string | null = null;
            for (let i = sceneBoundaries.length - 1; i >= 0; i--) {
              if (pos >= sceneBoundaries[i].startSec) {
                splitSceneId = sceneBoundaries[i].sceneId;
                break;
              }
            }
            // Can't split at last scene
            const isLast = splitSceneId === sceneBoundaries[sceneBoundaries.length - 1]?.sceneId;
            const canSplit = !!splitSceneId && !isLast && sceneBoundaries.length > 1;
            return (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] gap-1 text-muted-foreground hover:text-primary"
                disabled={!canSplit}
                title={isRu ? "Разделить главу в этой позиции" : "Split chapter at this position"}
                onClick={() => {
                  if (splitSceneId) {
                    onSplitAtScene(splitSceneId);
                    toast.success(isRu ? "Глава разделена" : "Chapter split");
                  }
                }}
              >
                <Scissors className="h-3.5 w-3.5" />
                <span className="font-body">{isRu ? "Разделить" : "Split"}</span>
              </Button>
            );
          })()}

          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjustZoom("out")}><ZoomOut className="h-3.5 w-3.5" /></Button>
          <Select value={String(montageZoomPercent)} onValueChange={(v) => applyMontageZoom(Number(v))}>
            <SelectTrigger className="h-7 w-[72px] text-xs font-body border-none bg-transparent px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTAGE_ZOOM_PRESETS.map((p) => (
                <SelectItem key={p} value={String(p)} className="text-xs">{p}%</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjustZoom("in")}><ZoomIn className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetZoom}><Maximize2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {/* Stem tracks */}
      {!timelineCollapsed && (
        <div ref={tracksContainerRef} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex min-h-0" style={{ flex: "0 0 auto" }}>
            {/* Mixer sidebar — stems only */}
            <div className="shrink-0 border-r border-border flex flex-col" style={{ width: `${MIXER_SIDEBAR}px` }}>
              <div className="h-6 border-b border-border" />
              {stemTracks.map((track) => (
                <div
                  key={track.id}
                  className={`cursor-pointer transition-colors ${selectedTrackId === track.id ? "ring-1 ring-primary/50 bg-primary/5" : ""}`}
                  onClick={() => setSelectedTrackId(selectedTrackId === track.id ? null : track.id)}
                >
                  <TrackMixerStrip
                    trackId={track.id}
                    label={track.label}
                    color={track.color}
                    expanded={false}
                    onMixChange={onMixChange}
                  />
                </div>
              ))}
            </div>

            {/* Timeline area — stems only */}
            <div ref={sceneScrollRef} className="flex-1 overflow-x-auto overflow-y-hidden">
              <div
                className="relative cursor-crosshair"
                style={{ width: `${duration * zoom * 4}px`, minWidth: "100%" }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  player.seek(Math.max(0, Math.min(x / (zoom * 4), duration)));
                }}
              >
                <div className="sticky top-0 z-20 bg-background">
                  <TimelineRuler
                    zoom={zoom}
                    duration={duration}
                    sceneBoundaries={sceneBoundaries}
                    loadPercent={
                      player.loadProgress && player.loadProgress.total > 0
                        ? Math.round((player.loadProgress.done / player.loadProgress.total) * 100)
                        : null
                    }
                    isLoading={
                      player.loadProgress != null &&
                      player.loadProgress.total > 0 &&
                      player.loadProgress.done < player.loadProgress.total
                    }
                    loadLabel={player.loadProgress?.currentLabel || undefined}
                  />
                </div>

                {stemTracks.map((track) => {
                  const trackClips = clipsByTrack.get(track.id) ?? [];
                  return (
                    <div key={track.id} className="h-10 border-b border-border/50 relative">
                      {trackClips.map((clip) => {
                        const left = clip.startSec * zoom * 4;
                        const width = clip.durationSec * zoom * 4;
                        return (
                          <div
                            key={clip.id}
                            className="absolute top-1 bottom-1 rounded-sm opacity-80 hover:opacity-100 transition-opacity"
                            style={{ left: `${left}px`, width: `${width}px`, backgroundColor: track.color }}
                            title={`${clip.label} (${clip.durationSec.toFixed(1)}s)`}
                          >
                            {width > 50 && (
                              <span className="text-[9px] text-primary-foreground px-1.5 truncate block mt-0.5 font-body">
                                {clip.label}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                <Playhead positionSec={player.positionSec} zoom={zoom} />
              </div>
            </div>
          </div>

      {/* Waveform Editor — scene-scoped */}
          <WaveformEditor
            sceneClips={waveformSceneClips}
            trackId={selectedTrackId}
            trackLabel={stemTracks.find(t => t.id === selectedTrackId)?.label ?? ""}
            trackColor={stemTracks.find(t => t.id === selectedTrackId)?.color ?? "hsl(var(--primary))"}
            sceneDuration={waveformSceneDuration}
            scenePositionSec={waveformScenePositionSec}
            sceneLabel={waveformSceneLabel}
            mixerWidth={MIXER_SIDEBAR}
            isRu={isRu}
            isPlaying={player.state === "playing"}
            segmentBoundaries={segmentBoundaries}
            onSeek={handleSceneSeek}
            onTrim={handleTrim}
            onFadeIn={handleFadeIn}
            onFadeOut={handleFadeOut}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
          />
        </div>
      )}
    </div>
  );
}
