import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { getAudioEngine } from "@/lib/audioEngine";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { renderScene, type RenderProgress } from "@/lib/sceneRenderer";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { useStorageAudioList, type StorageAudioFile } from "@/hooks/useStorageAudioList";
import { useTimelineClips, type TimelineClip, type TypeMappingsByScene } from "@/hooks/useTimelineClips";
import { useTimelinePlayer } from "@/hooks/useTimelinePlayer";
import { TrackMixerStrip } from "./TrackMixerStrip";
import { useMixerPersistence } from "@/hooks/useMixerPersistence";
import { usePluginsPersistence } from "@/hooks/usePluginsPersistence";
import { useClipPluginConfigs } from "@/hooks/useClipPluginConfigs";
import { TimelineRuler } from "./TimelineRuler";
import { TimelineTrack } from "./TimelineTrack";
import { Playhead } from "./TimelinePlayhead";
import { ChannelPluginsPanel, type ClipInfo } from "./ChannelPluginsPanel";
import { useAtmoClipManipulation } from "@/hooks/useAtmoClipManipulation";
import { useClipFades } from "@/hooks/useClipFades";
import { useCharacterTracks } from "@/hooks/useCharacterTracks";
import { TimelineTransport } from "./TimelineTransport";

// ─── Types ──────────────────────────────────────────────────

export interface TimelineTrackData {
  id: string;
  label: string;
  color: string;
  type: "narrator" | "atmosphere" | "sfx";
}

const getFixedTracks = (isRu: boolean): TimelineTrackData[] => [
  { id: "atmosphere-bg", label: isRu ? "Атмосфера" : "Ambience", color: "hsl(175 50% 55%)", type: "atmosphere" },
  { id: "atmosphere-sfx", label: "SFX", color: "hsl(220 55% 60%)", type: "sfx" },
];

const TRACK_LABELS_WIDTH_COLLAPSED = 112;
const TRACK_LABELS_WIDTH_EXPANDED = 360;

// ─── Constants ──────────────────────────────────────────────
export const TIMELINE_HEADER_HEIGHT = 41;

// ─── Main component ─────────────────────────────────────────

interface StudioTimelineProps {
  isRu: boolean;
  sceneDurationSec?: number;
  sceneId?: string | null;
  bookId?: string | null;
  selectedCharacterId?: string | null;
  onSelectCharacter?: (characterId: string | null) => void;
  selectedSegmentId?: string | null;
  onSelectSegment?: (segmentId: string | null) => void;
  checkedSegmentIds?: Set<string>;
  onCheckedSegmentIdsChange?: (ids: Set<string>) => void;
  synthesizingSegmentIds?: Set<string>;
  errorSegmentIds?: Set<string>;
  clipsRefreshToken?: number;
  onSceneRendered?: (sceneId: string) => void;
}

export function StudioTimeline({
  isRu,
  sceneDurationSec,
  sceneId,
  bookId,
  selectedCharacterId,
  onSelectCharacter,
  selectedSegmentId,
  onSelectSegment,
  checkedSegmentIds,
  onCheckedSegmentIdsChange,
  synthesizingSegmentIds,
  errorSegmentIds,
  clipsRefreshToken = 0,
  onSceneRendered,
}: StudioTimelineProps) {
  const { user } = useAuth();
  const { storage } = useProjectStorageContext();
  const storageAudio = useStorageAudioList(user?.id);

  // Local refresh counter to re-fetch clips after insert
  const [localRefresh, setLocalRefresh] = useState(0);
  const combinedRefreshToken = clipsRefreshToken + localRefresh;

  // Handler for inserting audio from storage into atmosphere/sfx track
  const handleInsertAudio = useCallback(async (file: StorageAudioFile, atSec: number, layerType: "ambience" | "sfx" = "ambience") => {
    if (!sceneId || !user || !storage) {
      toast.error(isRu ? "Нет активной сцены" : "No active scene");
      return;
    }

    let durationMs = 10_000;
    // Fetch audio from Supabase Storage, save to project OPFS, decode duration
    let savedOpfsPath = "";
    try {
      const { writeAtmosphereAudio } = await import("@/lib/audioAssetCache");
      const { supabase: sb } = await import("@/integrations/supabase/client");
      const { data: urlData } = await sb.storage.from("user-media").createSignedUrl(file.path, 600);
      if (urlData?.signedUrl) {
        const resp = await fetch(urlData.signedUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          const fileName = file.path.split("/").pop() || `${file.category}-${Date.now()}.mp3`;
          savedOpfsPath = await writeAtmosphereAudio(storage!, sceneId, fileName, blob);
          const ctx = new AudioContext();
          const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
          durationMs = Math.round(decoded.duration * 1000);
          ctx.close();
        }
      }
    } catch {
      // use fallback duration
    }

    const boundary = sceneBoundariesRef.current?.find(b => b.sceneId === sceneId);
    const sceneStartSec = boundary ? boundary.startSec + boundary.silenceSec : 0;
    const offsetMs = Math.max(0, Math.round((atSec - sceneStartSec) * 1000));

    const { addAtmosphereClip } = await import("@/lib/localAtmospheres");
    await addAtmosphereClip(storage, sceneId, {
      id: crypto.randomUUID(),
      layer_type: layerType,
      audio_path: file.path,
      duration_ms: durationMs,
      volume: 0.5,
      fade_in_ms: layerType === "sfx" ? 0 : 500,
      fade_out_ms: layerType === "sfx" ? 0 : 1000,
      prompt_used: file.name,
      offset_ms: offsetMs,
      speed: 1,
      created_at: new Date().toISOString(),
    });

    toast.success(
      isRu ? `Добавлено: ${file.name}` : `Added: ${file.name}`,
      { description: `${layerType} · ${(durationMs / 1000).toFixed(1)}s` },
    );

    setLocalRefresh(prev => prev + 1);
  }, [sceneId, user, isRu, storage]);

  // Handler for deleting atmosphere/sfx clips
  const handleDeleteAtmoClip = useCallback(async (clipId: string) => {
    if (!storage || !sceneId) return;
    const atmoId = clipId.replace(/^atmo-/, "");
    if (!atmoId) return;

    const { deleteAtmosphereClip } = await import("@/lib/localAtmospheres");
    await deleteAtmosphereClip(storage, sceneId, atmoId);

    toast.success(isRu ? "Клип удалён" : "Clip deleted");
    setLocalRefresh(prev => prev + 1);
  }, [isRu, storage, sceneId]);

  // ── Scene render state ────────────────────────────────────
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const isRendering = renderProgress !== null && renderProgress.phase !== "done" && renderProgress.phase !== "error";

  const [hasExistingRender, setHasExistingRender] = useState(false);
  useEffect(() => {
    setHasExistingRender(false);
    setRenderProgress(null);
    if (!sceneId) return;
    (async () => {
      const { data } = await supabase
        .from("scene_renders")
        .select("voice_path, atmo_path, sfx_path")
        .eq("scene_id", sceneId)
        .maybeSingle();
      if (data) {
        const paths = [data.voice_path, data.atmo_path, data.sfx_path].filter(Boolean);
        setHasExistingRender(paths.length > 0);
      }
    })();
  }, [sceneId]);

  const rulerRenderPercent = isRendering
    ? (renderProgress?.percent ?? 0)
    : renderProgress?.phase === "done" || hasExistingRender
      ? 100
      : null;

  const clipPluginsRef = useRef<Record<string, import("@/hooks/useClipPluginConfigs").ClipPluginConfig>>({});

  const handleRenderScene = useCallback(async () => {
    if (!sceneId || !user || isRendering || !storage) return;
    try {
      await renderScene(
        storage,
        sceneId,
        timelineClipsRef.current,
        durationRef.current,
        user.id,
        setRenderProgress,
        clipPluginsRef.current,
      );
      toast.success(isRu ? "Сцена отрендерена" : "Scene rendered");
      onSceneRendered?.(sceneId);
      if (storage) {
        import("@/hooks/usePipelineProgress").then(({ writePipelineStep }) =>
          writePipelineStep(storage, "scene_render", true).catch(() => {}),
        );
      }
    } catch (err: any) {
      toast.error(isRu ? "Ошибка рендера" : "Render error", { description: err.message });
    }
  }, [sceneId, user, isRendering, isRu, onSceneRendered]);

  const timelineClipsRef = useRef<typeof timelineClips>([]);
  const durationRef = useRef(0);

  // ── Clip fades (extracted hook) ──────────────────────────
  const { clipFades, handleSetFade } = useClipFades(sceneId, storage);

  // ── Character tracks (extracted hook) ─────────────────────
  const { charTracks, speakerToCharId, typeMappings, charDataReady, contextSceneIds } = useCharacterTracks(
    bookId, sceneId, storage, clipsRefreshToken,
  );

  // ── Real clips from segments (wait for char data to be ready) ──
  const effectiveCharMap = charDataReady ? speakerToCharId : new Map<string, string>();
  const effectiveTypeMappings = charDataReady ? typeMappings : new Map() as TypeMappingsByScene;
  const { clips: timelineClips, sceneBoundaries } = useTimelineClips(contextSceneIds, effectiveCharMap, combinedRefreshToken, effectiveTypeMappings);
  const sceneBoundariesRef = useRef(sceneBoundaries);
  sceneBoundariesRef.current = sceneBoundaries;

  // ── Audio player ──────────────────────────────────────────
  const player = useTimelinePlayer(timelineClips);

  // ── Spacebar play/pause ──────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      if (player.state === "playing") player.pause();
      else player.play();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [player]);

  // ── Seek to selected segment's clip start ─────────────────
  const prevSelectedRef = useRef<string | null>(null);
  const sceneScrollRef = useRef<HTMLDivElement>(null);
  const seekCenterRef = useRef<{ zoom: number; percent: number }>({ zoom: 1, percent: 100 });

  useEffect(() => {
    if (!selectedSegmentId || selectedSegmentId === prevSelectedRef.current) return;
    prevSelectedRef.current = selectedSegmentId;
    const clip = timelineClips.find(c => c.id === selectedSegmentId);
    if (clip != null) {
      player.seek(clip.startSec);
      const { zoom: z, percent } = seekCenterRef.current;
      if (sceneScrollRef.current && percent > 100) {
        requestAnimationFrame(() => {
          const el = sceneScrollRef.current;
          if (!el) return;
          const px = clip.startSec * z * 4;
          el.scrollTo({ left: Math.max(0, px - el.clientWidth / 2), behavior: "smooth" });
        });
      }
    }
  }, [selectedSegmentId, timelineClips, player]);

  // Group clips by track ID
  const clipsByTrack = useMemo(() => {
    const map = new Map<string, TimelineClip[]>();
    for (const clip of timelineClips) {
      const list = map.get(clip.trackId) ?? [];
      list.push(clip);
      map.set(clip.trackId, list);
    }
    return map;
  }, [timelineClips]);

  // ── Loop region from checked clips ──
  useEffect(() => {
    if (!checkedSegmentIds || checkedSegmentIds.size === 0) {
      player.clearLoopRegion();
      return;
    }
    const allIds = new Set(checkedSegmentIds);
    if (selectedSegmentId) allIds.add(selectedSegmentId);

    let minStart = Infinity;
    let maxEnd = -Infinity;
    for (const id of allIds) {
      const clip = timelineClips.find(c => c.id === id);
      if (clip) {
        minStart = Math.min(minStart, clip.startSec);
        maxEnd = Math.max(maxEnd, clip.startSec + clip.durationSec);
      }
    }

    if (minStart < Infinity && maxEnd > minStart) {
      player.setLoopRegion(minStart, maxEnd);
    } else {
      player.clearLoopRegion();
    }
  }, [selectedSegmentId, checkedSegmentIds, timelineClips, player.setLoopRegion, player.clearLoopRegion]);

  // ── Duration ──────────────────────────────────────────────
  const estimateDuration = sceneDurationSec && sceneDurationSec > 0 ? sceneDurationSec : 60;
  const duration = player.totalDuration > 0 ? player.totalDuration : estimateDuration;

  timelineClipsRef.current = timelineClips;
  durationRef.current = duration;

  // Auto-add narrator-fallback + atmosphere tracks
  const allTracks = useMemo(() => {
    const hasNarratorFallback = timelineClips.some(c => c.trackId === "narrator-fallback");
    const narratorTrack: TimelineTrackData[] = hasNarratorFallback
      ? [{ id: "narrator-fallback", label: isRu ? "Рассказчик" : "Narrator", color: "hsl(var(--primary))", type: "narrator" }]
      : [];
    return [...narratorTrack, ...charTracks, ...getFixedTracks(isRu)];
  }, [charTracks, timelineClips, isRu]);

  // ── Mixer sidebar expanded state ───────────────────────────
  const [mixerExpanded, setMixerExpanded] = useState(() => {
    try { return localStorage.getItem("studio-mixer-expanded") === "true"; } catch { return false; }
  });

  const toggleMixerExpanded = useCallback(() => {
    setMixerExpanded((prev) => {
      const next = !prev;
      localStorage.setItem("studio-mixer-expanded", String(next));
      return next;
    });
  }, []);

  const sidebarWidth = mixerExpanded ? TRACK_LABELS_WIDTH_EXPANDED : TRACK_LABELS_WIDTH_COLLAPSED;

  // ── Mixer persistence per scene ────────────────────────────
  const engineTrackIds = useMemo(() => {
    const ids = new Set<string>();
    for (const track of allTracks) {
      const trackClipIds = timelineClips
        .filter((c) => c.trackId === track.id && c.hasAudio && !!c.audioPath)
        .map((c) => c.id);
      if (trackClipIds.length > 0) {
        for (const id of trackClipIds) ids.add(id);
      } else {
        ids.add(track.id);
      }
    }
    return [...ids];
  }, [allTracks, timelineClips]);
  const onMixChangeRef = useRef<(() => void) | null>(null);
  const { scheduleSave: onMixChange } = useMixerPersistence(sceneId ?? null, engineTrackIds, storage);
  onMixChangeRef.current = onMixChange;
  const { scheduleSave: onPluginsChange } = usePluginsPersistence(sceneId ?? null, engineTrackIds, storage);
  const clipPlugins = useClipPluginConfigs(sceneId ?? null);
  clipPluginsRef.current = clipPlugins.configs;

  // ── Layout / zoom ─────────────────────────────────────────
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (tracksContainerRef.current) setContainerWidth(tracksContainerRef.current.clientWidth - sidebarWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (tracksContainerRef.current) ro.observe(tracksContainerRef.current);
    return () => ro.disconnect();
  }, [sidebarWidth]);

  const fitZoom = useMemo(() => {
    if (containerWidth <= 0 || duration <= 0) return 1;
    return containerWidth / (duration * 4);
  }, [containerWidth, duration]);

  const SCENE_ZOOM_PRESETS = [90, 100, 200, 300, 400, 500] as const;
  const [sceneZoomPercent, setSceneZoomPercent] = useState<number>(100);
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const zoom = zoomOverride ?? fitZoom;

  useEffect(() => { setZoomOverride(null); setSceneZoomPercent(100); }, [fitZoom]);
  useEffect(() => { seekCenterRef.current = { zoom, percent: sceneZoomPercent }; }, [zoom, sceneZoomPercent]);

  const applySceneZoom = useCallback((percent: number) => {
    setSceneZoomPercent(percent);
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

  // ── Atmo clip manipulation ───────────────────────────────
  const atmoManip = useAtmoClipManipulation({
    sceneId,
    isRu,
    zoom,
    positionSec: player.positionSec,
    onRefresh: () => {
      onMixChangeRef.current?.();
      setLocalRefresh(prev => prev + 1);
    },
    getSceneStartSec: () => {
      const boundary = sceneBoundariesRef.current?.find(b => b.sceneId === sceneId);
      return boundary ? boundary.startSec + boundary.silenceSec : 0;
    },
    storage,
  });

  // ── Ctrl+C/V for atmo clips ───────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if ((e.ctrlKey || e.metaKey) && e.code === "KeyC") {
        const selectedAtmo = checkedSegmentIds ? [...checkedSegmentIds].find(id => id.startsWith("atmo-")) : null;
        if (selectedAtmo) {
          e.preventDefault();
          atmoManip.copyClip(selectedAtmo);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.code === "KeyV") {
        if (atmoManip.clipboard) {
          e.preventDefault();
          atmoManip.pasteClip();
        }
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [checkedSegmentIds, atmoManip]);

  // ── Horizontal scroll sync with playback ──────────────────
  const userScrollingRef = useRef(false);
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const el = sceneScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (player.state !== "playing") return;
      userScrollingRef.current = true;
      clearTimeout(userScrollTimerRef.current);
      userScrollTimerRef.current = setTimeout(() => { userScrollingRef.current = false; }, 2000);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [player.state]);

  useEffect(() => {
    if (player.state !== "playing" || sceneZoomPercent <= 100 || userScrollingRef.current) return;
    const el = sceneScrollRef.current;
    if (!el) return;
    const playheadPx = player.positionSec * zoom * 4;
    el.scrollLeft = Math.max(0, playheadPx - el.clientWidth / 2);
  }, [player.positionSec, player.state, zoom, sceneZoomPercent]);

  const centerPlayhead = useCallback((sec: number) => {
    if (sceneZoomPercent <= 100) return;
    const el = sceneScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const px = sec * zoom * 4;
      el.scrollTo({ left: Math.max(0, px - el.clientWidth / 2), behavior: "smooth" });
    });
  }, [zoom, sceneZoomPercent]);

  // ── Timeline view mode ─────────────────────────────────────
  type TimelineView = "tracks" | "plugins";
  const [timelineView, setTimelineView] = useState<TimelineView>("tracks");
  const [selectedPluginTrackId, setSelectedPluginTrackId] = useState<string | null>(null);

  // ── Drag guide line ────────────────────────────────────────
  const [dragGuideX, setDragGuideX] = useState<number | null>(null);
  const [dragStartLineX, setDragStartLineX] = useState<number | null>(null);
  const [resizeSpeedHint, setResizeSpeedHint] = useState<string | null>(null);
  useEffect(() => {
    const onMouseUp = () => {
      setTimeout(() => setDragGuideX(prev => prev !== null ? null : prev), 50);
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  useEffect(() => {
    if (selectedCharacterId) setSelectedPluginTrackId(`char-${selectedCharacterId}`);
  }, [selectedCharacterId]);

  // Selected track clips for channel plugins
  const pluginsClips = useMemo((): ClipInfo[] => {
    if (!selectedPluginTrackId) return [];
    const trackInfo = allTracks.find(t => t.id === selectedPluginTrackId);
    return timelineClips
      .filter(c => c.trackId === selectedPluginTrackId)
      .map(c => ({
        id: c.id,
        label: c.label || c.segmentType || c.id,
        segmentType: c.segmentType,
        startSec: c.startSec,
        durationSec: c.durationSec,
        charColor: trackInfo?.color,
        hasAudio: c.hasAudio && !!c.audioPath,
      }));
  }, [selectedPluginTrackId, timelineClips, allTracks]);

  const allSceneClips = useMemo((): ClipInfo[] => {
    return timelineClips
      .filter(c => c.trackId.startsWith("char-"))
      .map(c => {
        const trackInfo = charTracks.find(t => t.id === c.trackId);
        return {
          id: c.id,
          label: c.label || c.segmentType || c.id,
          segmentType: c.segmentType,
          startSec: c.startSec,
          durationSec: c.durationSec,
          charColor: trackInfo?.color,
        };
      });
  }, [timelineClips, charTracks]);

  const pluginsTrackLabel = useMemo(() => {
    if (!selectedPluginTrackId) return undefined;
    return allTracks.find(t => t.id === selectedPluginTrackId)?.label;
  }, [selectedPluginTrackId, allTracks]);

  const pluginsTrackColor = useMemo(() => {
    if (!selectedPluginTrackId) return undefined;
    return allTracks.find(t => t.id === selectedPluginTrackId)?.color;
  }, [selectedPluginTrackId, allTracks]);

  const handleTogglePlugin = useCallback((clipId: string, plugin: "eq" | "comp" | "limiter" | "panner3d" | "convolver") => {
    const trackId = selectedPluginTrackId ?? "";
    clipPlugins.togglePlugin(clipId, trackId, plugin);
    onPluginsChange();
    onMixChange();
  }, [clipPlugins, selectedPluginTrackId, onPluginsChange, onMixChange]);

  const handleUpdateParams = useCallback((clipId: string, plugin: "eq" | "comp" | "limiter" | "panner3d" | "convolver", params: any) => {
    const trackId = selectedPluginTrackId ?? "";
    clipPlugins.updatePluginParams(clipId, trackId, plugin, params);
    onPluginsChange();
    onMixChange();
  }, [clipPlugins, selectedPluginTrackId, onPluginsChange, onMixChange]);

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("studio-timeline-collapsed") === "true"; } catch { return false; }
  });

  const clampSize = useCallback((size: number) => {
    const max = Math.max(160, Math.floor(window.innerHeight * 0.55));
    return Math.min(max, Math.max(120, size));
  }, []);

  const [size, setSize] = useState(() => {
    try {
      const persisted = Number(localStorage.getItem("studio-timeline-size"));
      if (!Number.isFinite(persisted) || persisted <= 0) return 250;
      return clampSize(persisted);
    } catch { return 250; }
  });

  useEffect(() => {
    const onResize = () => setSize((prev) => clampSize(prev));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampSize]);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("studio-timeline-collapsed", String(next));
      return next;
    });
  }, []);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startSize = size;
    const onMouseMove = (ev: MouseEvent) => {
      const newSize = clampSize(startSize + (startY - ev.clientY));
      setSize(newSize);
      localStorage.setItem("studio-timeline-size", String(newSize));
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [size, clampSize]);

  const height = collapsed ? TIMELINE_HEADER_HEIGHT : size;

  const RESIZE_HANDLE_H = 8;
  const MIXER_COL_HEADER_H = 24;
  const trackCount = allTracks.length || 1;
  const availableForTracks = size - RESIZE_HANDLE_H - TIMELINE_HEADER_HEIGHT - MIXER_COL_HEADER_H;
  const dynamicTrackHeight = Math.max(28, Math.min(56, Math.floor(availableForTracks / trackCount)));

  return (
    <div
      className="flex flex-col bg-background border-t border-border shrink-0"
      style={{ height: `${height}px` }}
    >
      {/* Resize handle */}
      {!collapsed && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="h-2 cursor-row-resize hover:bg-primary/30 bg-border/50 transition-colors shrink-0 flex items-center justify-center"
        >
          <div className="w-8 h-0.5 rounded-full bg-muted-foreground/30" />
        </div>
      )}

      {/* Header (extracted component) */}
      <TimelineTransport
        isRu={isRu}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        playerState={player.state}
        hasAudio={player.hasAudio}
        positionSec={player.positionSec}
        totalDuration={player.totalDuration}
        volume={player.volume}
        loopEnabled={player.loopEnabled}
        loopRegion={player.loopRegion}
        onPlay={player.play}
        onPause={player.pause}
        onStop={player.stop}
        onChangeVolume={player.changeVolume}
        onToggleLoop={player.toggleLoop}
        sceneZoomPercent={sceneZoomPercent}
        onApplySceneZoom={applySceneZoom}
        isRendering={isRendering}
        renderPercent={renderProgress?.percent ?? 0}
        sceneId={sceneId}
        onRenderScene={handleRenderScene}
        charTrackCount={charTracks.length}
        timelineView={timelineView}
        onToggleView={() => setTimelineView(v => v === "plugins" ? "tracks" : "plugins")}
      />

      {/* Content: Mixer sidebar + Tracks + optional Plugins right sidebar */}
      {!collapsed && (
        <div ref={tracksContainerRef} className="flex-1 flex min-h-0 overflow-hidden">
          <div className="shrink-0 border-r border-border flex flex-col" style={{ width: `${sidebarWidth}px` }}>
            <div className="h-6 border-b border-border flex items-center px-2">
              {mixerExpanded ? (
                <>
                  <div className="w-[100px] shrink-0" />
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <div className="w-[24px] shrink-0" />
                    <span className="flex-1 min-w-[60px] text-[9px] text-muted-foreground/70 font-body uppercase tracking-wider text-center">
                      {isRu ? "Уровень" : "Volume"}
                    </span>
                    <span className="w-[70px] shrink-0 text-[9px] text-muted-foreground/70 font-body uppercase tracking-wider text-center">
                      {isRu ? "Панорама" : "Pan"}
                    </span>
                    <div className="w-[24px] shrink-0" />
                  </div>
                  <button onClick={toggleMixerExpanded} className="text-muted-foreground hover:text-foreground transition-colors ml-1" title={isRu ? "Свернуть микшер" : "Collapse mixer"}>
                    <PanelLeftClose className="h-3 w-3" />
                  </button>
                </>
              ) : (
                <div className="flex-1 flex justify-end">
                  <button onClick={toggleMixerExpanded} className="text-muted-foreground hover:text-foreground transition-colors" title={isRu ? "Развернуть микшер" : "Expand mixer"}>
                    <PanelLeftOpen className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
            {allTracks.map((track) => {
              const charId = track.id.startsWith("char-") ? track.id.slice(5) : null;
              const isSelected = charId != null
                ? charId === selectedCharacterId
                : selectedPluginTrackId === track.id;
              const engineClipIds = timelineClips
                .filter(c => c.trackId === track.id && c.hasAudio && !!c.audioPath)
                .map(c => c.id);
              const trackClipIds = timelineClips
                .filter(c => c.trackId === track.id)
                .map(c => c.id);
              return (
                 <TrackMixerStrip
                  key={track.id}
                  trackId={track.id}
                  allClipIds={engineClipIds}
                  fallbackEngineId={engineClipIds[0] ?? track.id}
                  label={track.label}
                  color={track.color}
                  expanded={mixerExpanded}
                  isSelected={isSelected}
                  onMixChange={onMixChange}
                  trackHeight={dynamicTrackHeight}
                  fxState={clipPlugins.getTrackFxState(trackClipIds)}
                  rvState={clipPlugins.getTrackRvState(trackClipIds)}
                  onToggleFx={() => { clipPlugins.toggleTrackFx(trackClipIds, track.id); onPluginsChange(); onMixChange(); }}
                  onToggleRv={() => { clipPlugins.toggleTrackRv(trackClipIds, track.id); onPluginsChange(); onMixChange(); }}
                  onClick={() => {
                    if (charId && onSelectCharacter) {
                      const deselect = isSelected;
                      onSelectCharacter(deselect ? null : charId);
                      setSelectedPluginTrackId(deselect ? null : track.id);
                    } else {
                      const deselect = selectedPluginTrackId === track.id;
                      setSelectedPluginTrackId(deselect ? null : track.id);
                      if (onSelectCharacter) onSelectCharacter(null);
                    }
                  }}
                />
              );
            })}
          </div>
          {timelineView === "plugins" ? (
            <div className="flex-1 overflow-auto border-l border-border">
              <ChannelPluginsPanel
                isRu={isRu}
                clips={pluginsClips}
                allSceneClips={allSceneClips}
                trackLabel={pluginsTrackLabel}
                trackColor={pluginsTrackColor}
                trackId={selectedPluginTrackId ?? undefined}
                clipConfigs={clipPlugins.configs}
                onTogglePlugin={handleTogglePlugin}
                onUpdateParams={handleUpdateParams}
              />
            </div>
          ) : (
            <div ref={sceneScrollRef} className="flex-1 overflow-x-auto overflow-y-hidden">
              <div
                className="relative cursor-crosshair"
                style={{ width: `${duration * zoom * 4}px`, minWidth: "100%" }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const sec = x / (zoom * 4);
                  const clampedSec = Math.max(0, Math.min(sec, duration));
                  player.seek(clampedSec);
                  centerPlayhead(clampedSec);
                }}
              >
                <div className="sticky top-0 z-20 bg-background">
                  <TimelineRuler zoom={zoom} duration={duration} sceneBoundaries={sceneBoundaries} renderPercent={rulerRenderPercent} isRendering={isRendering} loopRegion={player.loopRegion} loopEnabled={player.loopEnabled} />
                </div>
                {allTracks.map((track) => {
                  const charId = track.id.startsWith("char-") ? track.id.slice(5) : null;
                  const isTrackSelected = charId != null
                    ? charId === selectedCharacterId
                    : selectedPluginTrackId === track.id;
                  return (
                  <TimelineTrack
                    key={track.id}
                    track={track}
                    zoom={zoom}
                    duration={duration}
                    clips={clipsByTrack.get(track.id)}
                    selectedSegmentId={selectedSegmentId}
                    onSelectSegment={onSelectSegment}
                    checkedSegmentIds={checkedSegmentIds}
                    onToggleCheck={(segId) => {
                      if (!onCheckedSegmentIdsChange) return;
                      const next = new Set(checkedSegmentIds);
                      if (next.has(segId)) next.delete(segId); else next.add(segId);
                      onCheckedSegmentIdsChange(next);
                    }}
                    synthesizingSegmentIds={synthesizingSegmentIds}
                    errorSegmentIds={errorSegmentIds}
                    onSetFade={handleSetFade}
                    clipFades={clipFades}
                    storageAtmosphere={storageAudio.atmosphere}
                    storageSfx={storageAudio.sfx}
                    onInsertAudio={handleInsertAudio}
                    onDeleteAtmoClip={handleDeleteAtmoClip}
                    onCopyAtmoClip={atmoManip.copyClip}
                    onPasteAtmoClip={atmoManip.pasteClip}
                    onMoveAtmoClip={atmoManip.moveClip}
                    onResizeAtmoClip={atmoManip.resizeClip}
                    onResetAtmoClipSpeed={atmoManip.resetClipSpeed}
                    hasClipboard={!!atmoManip.clipboard}
                    isRu={isRu}
                    trackHeight={dynamicTrackHeight}
                    isSelected={isTrackSelected}
                    onDragGuideX={setDragGuideX}
                    onDragStartLineX={setDragStartLineX}
                    onResizeSpeedHint={setResizeSpeedHint}
                    onDragEndSeek={(sec) => { setDragGuideX(null); setDragStartLineX(null); setResizeSpeedHint(null); player.seek(sec); centerPlayhead(sec); }}
                    onClipSeek={(sec) => { player.seek(sec); centerPlayhead(sec); }}
                  />
                  );
                })}
                {dragStartLineX !== null && (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none z-[45]"
                    style={{ left: `${dragStartLineX}px`, width: '0px', borderLeft: '1px dashed #eab308' }}
                  />
                )}
                {dragGuideX !== null && (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none z-[45]"
                    style={{ left: `${dragGuideX}px`, width: '0px', borderLeft: '1px dashed #facc15' }}
                  >
                    {resizeSpeedHint && (
                      <div
                        className="absolute top-1 left-2 text-[10px] font-mono font-bold whitespace-nowrap px-1 py-0.5 rounded"
                        style={{ backgroundColor: 'rgba(250, 204, 21, 0.9)', color: '#000' }}
                      >
                        {resizeSpeedHint}
                      </div>
                    )}
                  </div>
                )}
                <Playhead positionSec={player.positionSec} zoom={zoom} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
