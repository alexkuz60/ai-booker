import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { getAudioEngine } from "@/lib/audioEngine";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import { ChevronUp, ChevronDown, Plus, Film, Play, Pause, Square, Volume2, VolumeX, PanelLeftClose, PanelLeftOpen, Download, Loader2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { renderScene, type RenderProgress } from "@/lib/sceneRenderer";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useTimelineClips, type TimelineClip, type TypeMappingsByScene } from "@/hooks/useTimelineClips";
import { useTimelinePlayer } from "@/hooks/useTimelinePlayer";
import { TrackMixerStrip } from "./TrackMixerStrip";
import { useMixerPersistence } from "@/hooks/useMixerPersistence";
import { usePluginsPersistence } from "@/hooks/usePluginsPersistence";
import { TimelineMasterMeter } from "./TimelineMasterMeter";
import { TimelineRuler } from "./TimelineRuler";
import { TimelineTrack } from "./TimelineTrack";
import { Playhead } from "./TimelinePlayhead";
import { ChannelPluginsPanel } from "./ChannelPluginsPanel";

// ─── Types ──────────────────────────────────────────────────

export interface TimelineTrackData {
  id: string;
  label: string;
  color: string;
  type: "narrator" | "atmosphere" | "sfx";
}

const FIXED_TRACKS: TimelineTrackData[] = [
  { id: "ambience", label: "Атмосфера", color: "hsl(175 45% 45%)", type: "atmosphere" },
  { id: "sfx", label: "SFX", color: "hsl(220 50% 55%)", type: "sfx" },
];

const TRACK_LABELS_WIDTH_COLLAPSED = 112;
const TRACK_LABELS_WIDTH_EXPANDED = 360;

const NARRATOR_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(30 70% 55%)",
  "hsl(280 55% 55%)",
  "hsl(350 65% 55%)",
  "hsl(160 50% 45%)",
  "hsl(200 60% 50%)",
  "hsl(45 75% 50%)",
  "hsl(320 55% 50%)",
  "hsl(100 45% 45%)",
];

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
  synthesizingSegmentIds,
  errorSegmentIds,
  clipsRefreshToken = 0,
  onSceneRendered,
}: StudioTimelineProps) {
  const { user } = useAuth();

  // ── Scene render state ────────────────────────────────────
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const isRendering = renderProgress !== null && renderProgress.phase !== "done" && renderProgress.phase !== "error";

  // Check if current scene already has a completed render
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

  // Compute render percent for ruler
  const rulerRenderPercent = isRendering
    ? (renderProgress?.percent ?? 0)
    : renderProgress?.phase === "done" || hasExistingRender
      ? 100
      : null;

  const handleRenderScene = useCallback(async () => {
    if (!sceneId || !user || isRendering) return;
    try {
      await renderScene(
        sceneId,
        timelineClipsRef.current,
        durationRef.current,
        user.id,
        setRenderProgress,
      );
      toast.success(isRu ? "Сцена отрендерена" : "Scene rendered");
      onSceneRendered?.(sceneId);
    } catch (err: any) {
      toast.error(isRu ? "Ошибка рендера" : "Render error", { description: err.message });
    }
  }, [sceneId, user, isRendering, isRu, onSceneRendered]);

  // Refs for render callback (avoid stale closures)
  const timelineClipsRef = useRef<typeof timelineClips>([]);
  const durationRef = useRef(0);
  // ── Clip fades persistence (localStorage + cloud) ──────────
  type FadeMap = Record<string, { fadeInSec: number; fadeOutSec: number }>;
  const fadeCloudKey = sceneId ? `clip_fades_${sceneId}` : "clip_fades_none";
  const { value: savedFades, update: saveFades, loaded: fadesLoaded } =
    useCloudSettings<FadeMap>(fadeCloudKey, {});

  const savedFadesRef = useRef(savedFades);
  savedFadesRef.current = savedFades;

  // Convert to Map for components
  const clipFades = useMemo(() => {
    const m = new Map<string, { fadeInSec: number; fadeOutSec: number }>();
    for (const [k, v] of Object.entries(savedFades)) {
      m.set(k, v);
    }
    return m;
  }, [savedFades]);

  // Restore fades to engine when loaded
  const fadesRestoredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!fadesLoaded || !sceneId) return;
    if (fadesRestoredRef.current === fadeCloudKey) return;
    fadesRestoredRef.current = fadeCloudKey;
    const engine = getAudioEngine();
    for (const [clipId, f] of Object.entries(savedFadesRef.current)) {
      engine.setTrackFadeIn(clipId, f.fadeInSec);
      engine.setTrackFadeOut(clipId, f.fadeOutSec);
    }
  }, [fadesLoaded, fadeCloudKey, sceneId]);

  const handleSetFade = useCallback((clipId: string, fadeInSec: number, fadeOutSec: number) => {
    const engine = getAudioEngine();
    engine.setTrackFadeIn(clipId, fadeInSec);
    engine.setTrackFadeOut(clipId, fadeOutSec);
    saveFades((prev) => ({ ...prev, [clipId]: { fadeInSec, fadeOutSec } }));
  }, [saveFades]);

  // ── Character tracks ──────────────────────────────────────
  const [charTracks, setCharTracks] = useState<TimelineTrackData[]>([]);
  const [speakerToCharId, setSpeakerToCharId] = useState<Map<string, string>>(new Map());
  const [typeMappings, setTypeMappings] = useState<TypeMappingsByScene>(new Map());

  const contextSceneIds = useMemo(() => sceneId ? [sceneId] : [], [sceneId]);

  useEffect(() => {
    if (!bookId || contextSceneIds.length === 0) {
      setCharTracks([]); setSpeakerToCharId(new Map()); setTypeMappings(new Map()); return;
    }

    (async () => {
      const [{ data: appearances }, { data: rawMappings }] = await Promise.all([
        supabase.from("character_appearances").select("character_id").in("scene_id", contextSceneIds),
        supabase.from("scene_type_mappings").select("scene_id, segment_type, character_id").in("scene_id", contextSceneIds),
      ]);

      const tm: TypeMappingsByScene = new Map();
      if (rawMappings) {
        for (const m of rawMappings) {
          let sceneMap = tm.get(m.scene_id);
          if (!sceneMap) { sceneMap = new Map(); tm.set(m.scene_id, sceneMap); }
          sceneMap.set(m.segment_type, m.character_id);
        }
      }
      setTypeMappings(tm);

      const charIdSet = new Set<string>();
      if (appearances) for (const a of appearances) charIdSet.add(a.character_id);
      if (rawMappings) for (const m of rawMappings) charIdSet.add(m.character_id);

      if (charIdSet.size === 0) { setCharTracks([]); setSpeakerToCharId(new Map()); return; }

      const { data: chars } = await supabase
        .from("book_characters")
        .select("id, name, color, sort_order, aliases")
        .in("id", [...charIdSet])
        .order("sort_order");

      if (!chars?.length) { setCharTracks([]); setSpeakerToCharId(new Map()); return; }

      const nameMap = new Map<string, string>();
      for (const c of chars) {
        nameMap.set(c.name.toLowerCase(), c.id);
        for (const alias of (c.aliases ?? [])) {
          if (alias) nameMap.set(alias.toLowerCase(), c.id);
        }
      }
      setSpeakerToCharId(nameMap);

      setCharTracks(
        chars.map((c, i) => ({
          id: `char-${c.id}`,
          label: c.name,
          color: c.color || NARRATOR_COLORS[i % NARRATOR_COLORS.length],
          type: "narrator" as const,
        }))
      );
    })();
  }, [bookId, sceneId, clipsRefreshToken]);

  // ── Real clips from segments ──────────────────────────────
  const { clips: timelineClips, sceneBoundaries } = useTimelineClips(contextSceneIds, speakerToCharId, clipsRefreshToken, typeMappings);

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

  // ── Duration ──────────────────────────────────────────────
  const estimateDuration = sceneDurationSec && sceneDurationSec > 0 ? sceneDurationSec : 60;
  const duration = player.totalDuration > 0 ? player.totalDuration : estimateDuration;

  // Keep refs current for render callback
  timelineClipsRef.current = timelineClips;
  durationRef.current = duration;

  // Auto-add narrator-fallback + atmosphere tracks if clips reference them
  const allTracks = useMemo(() => {
    const hasNarratorFallback = timelineClips.some(c => c.trackId === "narrator-fallback");
    const narratorTrack: TimelineTrackData[] = hasNarratorFallback
      ? [{ id: "narrator-fallback", label: isRu ? "Рассказчик" : "Narrator", color: "hsl(var(--primary))", type: "narrator" }]
      : [];

    const hasAtmoBg = timelineClips.some(c => c.trackId === "atmosphere-bg");
    const hasAtmoSfx = timelineClips.some(c => c.trackId === "atmosphere-sfx");
    const atmoTracks: TimelineTrackData[] = [];
    if (hasAtmoBg) atmoTracks.push({ id: "atmosphere-bg", label: isRu ? "Атмосфера" : "Ambience", color: "hsl(175 45% 45%)", type: "atmosphere" });
    if (hasAtmoSfx) atmoTracks.push({ id: "atmosphere-sfx", label: "SFX", color: "hsl(220 50% 55%)", type: "sfx" });

    return [...narratorTrack, ...charTracks, ...(atmoTracks.length ? atmoTracks : FIXED_TRACKS)];
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
  const { scheduleSave: onMixChange } = useMixerPersistence(sceneId ?? null, engineTrackIds);
  const { scheduleSave: onPluginsChange } = usePluginsPersistence(sceneId ?? null, engineTrackIds);

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

  const SCENE_ZOOM_PRESETS = [90, 100, 125, 150, 200, 300] as const;
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

  // ── Timeline view mode: "tracks" or "plugins" ─────────────
  type TimelineView = "tracks" | "plugins";
  const [timelineView, setTimelineView] = useState<TimelineView>("tracks");

  // Selected track for channel plugins (use first clip of selected character track, or first available)
  const pluginsTrackId = useMemo(() => {
    if (!selectedCharacterId) return null;
    const charTrackId = `char-${selectedCharacterId}`;
    const clipIds = timelineClips
      .filter(c => c.trackId === charTrackId && c.hasAudio && !!c.audioPath)
      .map(c => c.id);
    return clipIds[0] ?? null;
  }, [selectedCharacterId, timelineClips]);

  const pluginsTrackLabel = useMemo(() => {
    if (!selectedCharacterId) return undefined;
    return charTracks.find(t => t.id === `char-${selectedCharacterId}`)?.label;
  }, [selectedCharacterId, charTracks]);

  const pluginsTrackColor = useMemo(() => {
    if (!selectedCharacterId) return undefined;
    return charTracks.find(t => t.id === `char-${selectedCharacterId}`)?.color;
  }, [selectedCharacterId, charTracks]);

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

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

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

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleCollapse}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            {collapsed ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-body">
              {isRu ? "Таймлайн" : "Timeline"}
            </span>
          </button>

          {/* Transport controls */}
          <div className="flex items-center gap-0.5">
            {player.state === "playing" ? (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={player.pause} title={isRu ? "Пауза" : "Pause"}>
                <Pause className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={player.play} disabled={!player.hasAudio} title={isRu ? "Воспроизвести" : "Play"}>
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={player.stop} disabled={player.state === "stopped"} title={isRu ? "Стоп" : "Stop"}>
              <Square className="h-3 w-3" />
            </Button>
            <span className="text-[11px] text-muted-foreground font-mono min-w-[70px] text-center tabular-nums">
              {formatTime(player.positionSec)} / {formatTime(player.totalDuration)}
            </span>
            <TimelineMasterMeter />
            <div className="flex items-center gap-1 ml-1">
              <button
                onClick={() => player.changeVolume(player.volume > 0 ? 0 : 80)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title={isRu ? "Громкость" : "Volume"}
              >
                {player.volume === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </button>
              <input
                type="range" min={0} max={100} value={player.volume}
                onChange={e => player.changeVolume(Number(e.target.value))}
                className="w-[72px] h-0.5 accent-primary cursor-pointer volume-slider-sm"
                title={`${player.volume}%`}
              />
            </div>
          </div>

          {/* Scene label */}
          <div className="flex items-center gap-1 text-[11px]">
            <Film className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground font-body">{isRu ? "Сцена" : "Scene"}</span>
          </div>

          {charTracks.length > 0 && (
            <span className="text-[10px] text-muted-foreground/60 font-body">
              {charTracks.length} {isRu ? "дикт." : "narr."}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Select value={String(sceneZoomPercent)} onValueChange={(v) => applySceneZoom(Number(v))}>
            <SelectTrigger className="h-7 w-[80px] text-xs font-body border-none bg-transparent px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCENE_ZOOM_PRESETS.map((p) => (
                <SelectItem key={p} value={String(p)} className="text-xs">{p}%</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant={isRendering ? "secondary" : "outline"}
            size="sm"
            className="h-7 text-xs gap-1.5 font-body"
            onClick={handleRenderScene}
            disabled={isRendering || !sceneId || !player.hasAudio}
            title={isRu ? "Рендер сцены (3 стема)" : "Render scene (3 stems)"}
          >
            {isRendering ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {renderProgress?.percent ?? 0}%
              </>
            ) : (
              <>
                <Download className="h-3 w-3" />
                {isRu ? "Рендер" : "Render"}
              </>
            )}
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant={timelineView === "plugins" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setTimelineView(v => v === "plugins" ? "tracks" : "plugins")}
            title={isRu ? "Канальные плагины" : "Channel Plugins"}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7">
          </Button>
        </div>
      </div>

      {/* Content: Tracks or Plugins */}
      {!collapsed && timelineView === "plugins" && (
        <div className="flex-1 min-h-0 overflow-auto">
          <ChannelPluginsPanel
            isRu={isRu}
            trackId={pluginsTrackId}
            trackLabel={pluginsTrackLabel}
            trackColor={pluginsTrackColor}
            onMixChange={() => { onMixChange(); onPluginsChange(); }}
          />
        </div>
      )}

      {/* Tracks — Scene mode only */}
      {!collapsed && timelineView === "tracks" && (
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
              const isSelected = charId != null && charId === selectedCharacterId;
              const engineClipIds = timelineClips
                .filter(c => c.trackId === track.id && c.hasAudio && !!c.audioPath)
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
                  onClick={() => {
                    if (charId && onSelectCharacter) onSelectCharacter(isSelected ? null : charId);
                  }}
                />
              );
            })}
          </div>
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
                <TimelineRuler zoom={zoom} duration={duration} sceneBoundaries={sceneBoundaries} renderPercent={rulerRenderPercent} isRendering={isRendering} />
              </div>
              {allTracks.map((track) => (
                <TimelineTrack
                  key={track.id}
                  track={track}
                  zoom={zoom}
                  duration={duration}
                  clips={clipsByTrack.get(track.id)}
                  selectedSegmentId={selectedSegmentId}
                  onSelectSegment={onSelectSegment}
                  synthesizingSegmentIds={synthesizingSegmentIds}
                  errorSegmentIds={errorSegmentIds}
                  onSetFade={handleSetFade}
                  clipFades={clipFades}
                />
              ))}
              <Playhead positionSec={player.positionSec} zoom={zoom} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
