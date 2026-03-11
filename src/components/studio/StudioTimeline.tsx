import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { getAudioEngine } from "@/lib/audioEngine";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import { ChevronUp, ChevronDown, Plus, ZoomIn, ZoomOut, Maximize2, Layers, Film, Play, Pause, Square, Volume2, VolumeX, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { supabase } from "@/integrations/supabase/client";
import { useTimelineClips, type TimelineClip, type TypeMappingsByScene } from "@/hooks/useTimelineClips";
import { useTimelinePlayer } from "@/hooks/useTimelinePlayer";
import { TrackMixerStrip } from "./TrackMixerStrip";
import { useMixerPersistence } from "@/hooks/useMixerPersistence";
import { MasterMeterPanel } from "./MasterMeterPanel";
import { MasterEffectsTabs } from "./MasterEffectsTabs";
import { TimelineMasterMeter } from "./TimelineMasterMeter";
import { TimelineRuler } from "./TimelineRuler";
import { TimelineTrack } from "./TimelineTrack";
import { Playhead } from "./TimelinePlayhead";

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

interface ChapterSceneClip {
  sceneId: string;
  sceneIdx: number;
  label: string;
  startSec: number;
  durationSec: number;
  hasAudio: boolean;
}

interface StudioTimelineProps {
  isRu: boolean;
  sceneDurationSec?: number;
  chapterDurationSec?: number;
  sceneId?: string | null;
  bookId?: string | null;
  chapterSceneIds?: string[];
  chapterScenes?: { id?: string; scene_number: number; title: string }[];
  selectedCharacterId?: string | null;
  onSelectCharacter?: (characterId: string | null) => void;
  onSelectSceneIdx?: (idx: number) => void;
  selectedSegmentId?: string | null;
  onSelectSegment?: (segmentId: string | null) => void;
  synthesizingSegmentIds?: Set<string>;
  errorSegmentIds?: Set<string>;
  clipsRefreshToken?: number;
}

export function StudioTimeline({
  isRu,
  sceneDurationSec,
  chapterDurationSec,
  sceneId,
  bookId,
  chapterSceneIds,
  chapterScenes,
  selectedCharacterId,
  onSelectCharacter,
  onSelectSceneIdx,
  selectedSegmentId,
  onSelectSegment,
  synthesizingSegmentIds,
  errorSegmentIds,
  clipsRefreshToken = 0,
}: StudioTimelineProps) {
  const [mode, setMode] = useState<"scene" | "chapter">("scene");
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
    // Apply to engine immediately
    const engine = getAudioEngine();
    engine.setTrackFadeIn(clipId, fadeInSec);
    engine.setTrackFadeOut(clipId, fadeOutSec);
    // Persist
    saveFades((prev) => ({ ...prev, [clipId]: { fadeInSec, fadeOutSec } }));
  }, [saveFades]);

  // ── Character tracks ──────────────────────────────────────
  const [charTracks, setCharTracks] = useState<TimelineTrackData[]>([]);
  const [speakerToCharId, setSpeakerToCharId] = useState<Map<string, string>>(new Map());
  const [typeMappings, setTypeMappings] = useState<TypeMappingsByScene>(new Map());

  const contextSceneIds = useMemo(() =>
    mode === "scene"
      ? (sceneId ? [sceneId] : [])
      : (chapterSceneIds ?? []),
    [mode, sceneId, chapterSceneIds?.join(",")]
  );

  useEffect(() => {
    if (!bookId) { setCharTracks([]); setSpeakerToCharId(new Map()); setTypeMappings(new Map()); return; }
    if (contextSceneIds.length === 0) { setCharTracks([]); setSpeakerToCharId(new Map()); setTypeMappings(new Map()); return; }

    (async () => {
      const [{ data: appearances }, { data: rawMappings }] = await Promise.all([
        supabase
          .from("character_appearances")
          .select("character_id")
          .in("scene_id", contextSceneIds),
        supabase
          .from("scene_type_mappings")
          .select("scene_id, segment_type, character_id")
          .in("scene_id", contextSceneIds),
      ]);

      // Build type mappings: scene_id → Map<segment_type, character_id>
      const tm: TypeMappingsByScene = new Map();
      if (rawMappings) {
        for (const m of rawMappings) {
          let sceneMap = tm.get(m.scene_id);
          if (!sceneMap) { sceneMap = new Map(); tm.set(m.scene_id, sceneMap); }
          sceneMap.set(m.segment_type, m.character_id);
        }
      }
      setTypeMappings(tm);

      // Collect all character IDs from both appearances AND type mappings
      const charIdSet = new Set<string>();
      if (appearances) for (const a of appearances) charIdSet.add(a.character_id);
      if (rawMappings) for (const m of rawMappings) charIdSet.add(m.character_id);

      if (charIdSet.size === 0) { setCharTracks([]); setSpeakerToCharId(new Map()); return; }

      const charIds = [...charIdSet];

      const { data: chars } = await supabase
        .from("book_characters")
        .select("id, name, color, sort_order, aliases")
        .in("id", charIds)
        .order("sort_order");

      if (!chars?.length) { setCharTracks([]); setSpeakerToCharId(new Map()); return; }

      // Build speaker name → character ID map
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
  }, [bookId, sceneId, chapterSceneIds?.join(","), mode, clipsRefreshToken]);

  // ── Real clips from segments (moved above duration calc) ──
  const { clips: timelineClips, sceneBoundaries } = useTimelineClips(contextSceneIds, speakerToCharId, clipsRefreshToken, typeMappings);

  // ── Audio player ──────────────────────────────────────────
  const player = useTimelinePlayer(timelineClips);

  // ── Spacebar play/pause ──────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      // Don't hijack typing in inputs/textareas
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      if (player.state === "playing") {
        player.pause();
      } else {
        player.play();
      }
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


  // Group clips by track ID (scene mode)
  const clipsByTrack = useMemo(() => {
    const map = new Map<string, TimelineClip[]>();
    for (const clip of timelineClips) {
      const list = map.get(clip.trackId) ?? [];
      list.push(clip);
      map.set(clip.trackId, list);
    }
    return map;
  }, [timelineClips]);

  // ── Chapter mode: build scene-level clips ─────────────────
  const chapterSceneClips = useMemo<ChapterSceneClip[]>(() => {
    if (mode !== "chapter" || !chapterSceneIds?.length) return [];

    const clipsByScene = new Map<string, TimelineClip[]>();
    for (const c of timelineClips) {
      const list = clipsByScene.get(c.sceneId) ?? [];
      list.push(c);
      clipsByScene.set(c.sceneId, list);
    }

    const DEFAULT_SCENE_SEC = 30;
    const result: ChapterSceneClip[] = [];
    let offset = 0;

    for (let i = 0; i < chapterSceneIds.length; i++) {
      const sid = chapterSceneIds[i];
      const sceneInfo = chapterScenes?.[i];
      const sceneClips = clipsByScene.get(sid);

      let sceneDuration: number;
      let hasAudio = false;

      if (sceneClips?.length) {
        sceneDuration = sceneClips.reduce((sum, c) => sum + c.durationSec, 0);
        hasAudio = sceneClips.some(c => c.hasAudio);
      } else {
        sceneDuration = DEFAULT_SCENE_SEC;
      }

      result.push({
        sceneId: sid,
        sceneIdx: i,
        label: sceneInfo?.title || `${isRu ? "Сцена" : "Scene"} ${sceneInfo?.scene_number ?? i + 1}`,
        startSec: offset,
        durationSec: sceneDuration,
        hasAudio,
      });

      offset += sceneDuration;
    }

    return result;
  }, [mode, chapterSceneIds, chapterScenes, timelineClips, isRu]);

  // ── Duration: prefer actual clip data, fallback to estimate ──
  const clipsDuration = mode === "chapter"
    ? (chapterSceneClips.length > 0
        ? chapterSceneClips[chapterSceneClips.length - 1].startSec + chapterSceneClips[chapterSceneClips.length - 1].durationSec
        : 0)
    : player.totalDuration;
  const estimateDuration = mode === "scene"
    ? (sceneDurationSec && sceneDurationSec > 0 ? sceneDurationSec : 60)
    : (chapterDurationSec && chapterDurationSec > 0 ? chapterDurationSec : 180);
  const duration = clipsDuration > 0 ? clipsDuration : estimateDuration;

  // Auto-add narrator-fallback + atmosphere tracks if clips reference them (scene mode only)
  const allTracks = useMemo(() => {
    if (mode === "chapter") return FIXED_TRACKS;
    const hasNarratorFallback = timelineClips.some(c => c.trackId === "narrator-fallback");
    const narratorTrack: TimelineTrackData[] = hasNarratorFallback
      ? [{ id: "narrator-fallback", label: isRu ? "Рассказчик" : "Narrator", color: "hsl(var(--primary))", type: "narrator" }]
      : [];

    // Auto-add atmosphere tracks when scene_atmospheres clips exist
    const hasAtmoBg = timelineClips.some(c => c.trackId === "atmosphere-bg");
    const hasAtmoSfx = timelineClips.some(c => c.trackId === "atmosphere-sfx");
    const atmoTracks: TimelineTrackData[] = [];
    if (hasAtmoBg) atmoTracks.push({ id: "atmosphere-bg", label: isRu ? "Атмосфера" : "Ambience", color: "hsl(175 45% 45%)", type: "atmosphere" });
    if (hasAtmoSfx) atmoTracks.push({ id: "atmosphere-sfx", label: "SFX", color: "hsl(220 50% 55%)", type: "sfx" });

    return [...narratorTrack, ...charTracks, ...(atmoTracks.length ? atmoTracks : FIXED_TRACKS)];
  }, [charTracks, timelineClips, isRu, mode]);

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
  const engineTrackIds = useMemo(() =>
    allTracks.map(t => {
      const clip = timelineClips.find(c => c.trackId === t.id);
      return clip?.id ?? t.id;
    }),
    [allTracks, timelineClips]
  );
  const { scheduleSave: onMixChange } = useMixerPersistence(sceneId ?? null, engineTrackIds);

  // ── Layout / zoom ─────────────────────────────────────────
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (tracksContainerRef.current) {
        setContainerWidth(tracksContainerRef.current.clientWidth - sidebarWidth);
      }
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

  // Scene zoom presets (percentage of fitZoom)
  const SCENE_ZOOM_PRESETS = [90, 100, 125, 150, 200, 300] as const;
  const [sceneZoomPercent, setSceneZoomPercent] = useState<number>(100);
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const zoom = zoomOverride ?? fitZoom;

  useEffect(() => { setZoomOverride(null); setSceneZoomPercent(100); }, [fitZoom]);

  // Keep seekCenterRef in sync for the segment selection effect above
  useEffect(() => { seekCenterRef.current = { zoom, percent: sceneZoomPercent }; }, [zoom, sceneZoomPercent]);

  // Apply scene zoom preset
  const applySceneZoom = useCallback((percent: number) => {
    setSceneZoomPercent(percent);
    if (percent === 100) {
      setZoomOverride(null);
    } else {
      setZoomOverride((fitZoom * percent) / 100);
    }
  }, [fitZoom]);

  // ── Horizontal scroll sync with playback (scene mode) ─────
  const userScrollingRef = useRef(false);
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Track user scrolling to avoid fighting with auto-scroll
  useEffect(() => {
    const el = sceneScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (player.state !== "playing") return;
      userScrollingRef.current = true;
      clearTimeout(userScrollTimerRef.current);
      userScrollTimerRef.current = setTimeout(() => {
        userScrollingRef.current = false;
      }, 2000);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [player.state]);

  // Auto-scroll during playback when zoom > 100%
  useEffect(() => {
    if (mode !== "scene" || player.state !== "playing") return;
    if (sceneZoomPercent <= 100) return;
    if (userScrollingRef.current) return;
    const el = sceneScrollRef.current;
    if (!el) return;

    const playheadPx = player.positionSec * zoom * 4;
    const viewW = el.clientWidth;
    const targetScroll = playheadPx - viewW / 2;
    el.scrollLeft = Math.max(0, targetScroll);
  }, [player.positionSec, player.state, zoom, sceneZoomPercent, mode]);

  // Center playhead when seeking / selecting segment at zoom > 100%
  const centerPlayhead = useCallback((sec: number) => {
    if (sceneZoomPercent <= 100) return;
    const el = sceneScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const px = sec * zoom * 4;
      const viewW = el.clientWidth;
      el.scrollTo({ left: Math.max(0, px - viewW / 2), behavior: "smooth" });
    });
  }, [zoom, sceneZoomPercent]);

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

  const UNDER_100_ZOOM_STEPS = [5, 10, 15, 25, 50, 75, 100] as const;

  const toPercent = useCallback((zoomValue: number) => {
    if (fitZoom <= 0) return 100;
    return (zoomValue / fitZoom) * 100;
  }, [fitZoom]);

  const stepZoomPercent = useCallback((currentPercent: number, direction: "in" | "out") => {
    if (direction === "in") {
      if (currentPercent < 100) {
        const nextUnder100 = UNDER_100_ZOOM_STEPS.find((step) => step > currentPercent + 0.001);
        return nextUnder100 ?? 100;
      }
      const currentStep = Math.floor(currentPercent / 100);
      return Math.min(1000, (currentStep + 1) * 100);
    }

    if (currentPercent <= 100) {
      const lowerSteps = UNDER_100_ZOOM_STEPS.filter((step) => step < currentPercent - 0.001);
      return lowerSteps.length > 0 ? lowerSteps[lowerSteps.length - 1] : 5;
    }

    const currentStep = Math.ceil(currentPercent / 100);
    return Math.max(100, (currentStep - 1) * 100);
  }, []);

  const adjustZoom = useCallback((direction: "in" | "out") => {
    setZoomOverride((prev) => {
      const currentZoom = prev ?? fitZoom;
      const currentPercent = toPercent(currentZoom);
      const nextPercent = stepZoomPercent(currentPercent, direction);
      setSceneZoomPercent(nextPercent);
      return (fitZoom * nextPercent) / 100;
    });
  }, [fitZoom, stepZoomPercent, toPercent]);

  const resetZoom = useCallback(() => { setZoomOverride(null); setSceneZoomPercent(100); }, []);
  const displayZoomPercent = fitZoom > 0 ? Math.round(toPercent(zoom)) : 100;

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
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={player.pause}
                title={isRu ? "Пауза" : "Pause"}
              >
                <Pause className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={player.play}
                disabled={!player.hasAudio}
                title={isRu ? "Воспроизвести" : "Play"}
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={player.stop}
              disabled={player.state === "stopped"}
              title={isRu ? "Стоп" : "Stop"}
            >
              <Square className="h-3 w-3" />
            </Button>
            <span className="text-[11px] text-muted-foreground font-mono min-w-[70px] text-center tabular-nums">
              {formatTime(player.positionSec)} / {formatTime(player.totalDuration)}
            </span>
            {/* Master output level meter */}
            <TimelineMasterMeter />
            {/* Volume */}
            <div className="flex items-center gap-1 ml-1">
              <button
                onClick={() => player.changeVolume(player.volume > 0 ? 0 : 80)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title={isRu ? "Громкость" : "Volume"}
              >
                {player.volume === 0
                  ? <VolumeX className="h-3.5 w-3.5" />
                  : <Volume2 className="h-3.5 w-3.5" />
                }
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={player.volume}
                onChange={e => player.changeVolume(Number(e.target.value))}
                className="w-[72px] h-0.5 accent-primary cursor-pointer volume-slider-sm"
                title={`${player.volume}%`}
              />
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex items-center bg-muted/50 rounded-md p-0.5">
            <button
              onClick={() => { setMode("scene"); setZoomOverride(null); }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                mode === "scene"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Film className="h-3 w-3" />
              {isRu ? "Сцена" : "Scene"}
            </button>
            <button
              onClick={() => { setMode("chapter"); setZoomOverride(null); }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                mode === "chapter"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Layers className="h-3 w-3" />
              {isRu ? "Глава" : "Chapter"}
            </button>
          </div>

          {/* Track count */}
          {charTracks.length > 0 && (
            <span className="text-[10px] text-muted-foreground/60 font-body">
              {charTracks.length} {isRu ? "дикт." : "narr."}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {mode === "scene" ? (
            <Select
              value={String(sceneZoomPercent)}
              onValueChange={(v) => applySceneZoom(Number(v))}
            >
              <SelectTrigger className="h-7 w-[80px] text-xs font-body border-none bg-transparent px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCENE_ZOOM_PRESETS.map((p) => (
                  <SelectItem key={p} value={String(p)} className="text-xs">
                    {p}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjustZoom("out")} title={isRu ? "Уменьшить" : "Zoom out"}>
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground font-body w-10 text-center">{displayZoomPercent}%</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjustZoom("in")} title={isRu ? "Увеличить" : "Zoom in"}>
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetZoom} title={isRu ? "По ширине" : "Fit to width"}>
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <div className="w-px h-4 bg-border mx-1" />
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Tracks — Scene mode */}
      {!collapsed && mode === "scene" && (
        <div ref={tracksContainerRef} className="flex-1 flex min-h-0 overflow-hidden">
          <div className="shrink-0 border-r border-border flex flex-col" style={{ width: `${sidebarWidth}px` }}>
            {/* Sidebar header with mixer toggle + column labels */}
            <div className="h-6 border-b border-border flex items-center px-2">
              {mixerExpanded ? (
                <>
                  {/* Match TrackMixerStrip column layout: [100px name] | [FX] [Vol] [Pan] [RV] [collapse] */}
                  <div className="w-[100px] shrink-0" />
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <div className="w-[24px] shrink-0" /> {/* FX button space */}
                    <span className="flex-1 min-w-[60px] text-[9px] text-muted-foreground/70 font-body uppercase tracking-wider text-center">
                      {isRu ? "Уровень" : "Volume"}
                    </span>
                    <span className="w-[70px] shrink-0 text-[9px] text-muted-foreground/70 font-body uppercase tracking-wider text-center">
                      {isRu ? "Панорама" : "Pan"}
                    </span>
                    <div className="w-[24px] shrink-0" /> {/* RV button space */}
                  </div>
                  <button
                    onClick={toggleMixerExpanded}
                    className="text-muted-foreground hover:text-foreground transition-colors ml-1"
                    title={isRu ? "Свернуть микшер" : "Collapse mixer"}
                  >
                    <PanelLeftClose className="h-3 w-3" />
                  </button>
                </>
              ) : (
                <div className="flex-1 flex justify-end">
                  <button
                    onClick={toggleMixerExpanded}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title={isRu ? "Развернуть микшер" : "Expand mixer"}
                  >
                    <PanelLeftOpen className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
            {allTracks.map((track) => {
              const charId = track.id.startsWith("char-") ? track.id.slice(5) : null;
              const isSelected = charId != null && charId === selectedCharacterId;
              // Find engine track IDs that map to this timeline track
              const engineTrackId = timelineClips.find(c => c.trackId === track.id)?.id;
              return (
                <TrackMixerStrip
                  key={track.id}
                  trackId={engineTrackId ?? track.id}
                  label={track.label}
                  color={track.color}
                  expanded={mixerExpanded}
                  isSelected={isSelected}
                  onMixChange={onMixChange}
                  onClick={() => {
                    if (charId && onSelectCharacter) {
                      onSelectCharacter(isSelected ? null : charId);
                    }
                  }}
                />
              );
            })}
          </div>
          <div className="flex-1 overflow-x-auto overflow-y-hidden">
            <div
              className="relative cursor-crosshair"
              style={{ width: `${duration * zoom * 4}px`, minWidth: "100%" }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const sec = x / (zoom * 4);
                player.seek(Math.max(0, Math.min(sec, duration)));
              }}
            >
              {/* Keep ruler horizontally synced with tracks by rendering it inside the same scroll viewport */}
              <div className="sticky top-0 z-20 bg-background">
                <TimelineRuler zoom={zoom} duration={duration} sceneBoundaries={sceneBoundaries} />
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

      {/* Tracks — Chapter mode: single scenes track */}
      {!collapsed && mode === "chapter" && (
        <div ref={tracksContainerRef} className="flex-1 flex min-h-0 overflow-hidden">
          <div className="shrink-0 border-r border-border flex flex-col" style={{ width: `${sidebarWidth}px` }}>
            <MasterMeterPanel isRu={isRu} width={sidebarWidth} />
          </div>
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="overflow-x-auto overflow-y-hidden shrink-0">
              <div
                className="relative cursor-crosshair"
                style={{ width: `${duration * zoom * 4}px`, minWidth: "100%" }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const sec = x / (zoom * 4);
                  player.seek(Math.max(0, Math.min(sec, duration)));
                }}
              >
                {/* Keep ruler horizontally synced with tracks by rendering it inside the same scroll viewport */}
                <div className="sticky top-0 z-20 bg-background">
                  <TimelineRuler zoom={zoom} duration={duration} sceneBoundaries={sceneBoundaries} />
                </div>

                <div className="flex h-10 border-b border-border/50 relative" style={{ width: `${duration * zoom * 4}px` }}>
                  {chapterSceneClips.map((sc, i) => {
                    const widthPx = sc.durationSec * zoom * 4;
                    const colorIdx = i % NARRATOR_COLORS.length;
                    return (
                      <div
                        key={sc.sceneId}
                        className={`absolute top-1 bottom-1 rounded-sm cursor-pointer transition-all ${
                          sc.hasAudio ? "opacity-90 hover:opacity-100" : "opacity-50 hover:opacity-70"
                        } ${sc.sceneId === sceneId ? "ring-2 ring-primary ring-offset-1 ring-offset-background opacity-100 z-10" : ""}`}
                        style={{
                          left: `${sc.startSec * zoom * 4}px`,
                          width: `${widthPx}px`,
                          backgroundColor: NARRATOR_COLORS[colorIdx],
                          backgroundImage: sc.hasAudio
                            ? undefined
                            : "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.08) 3px, rgba(255,255,255,0.08) 6px)",
                        }}
                        title={`${sc.label} (${sc.durationSec.toFixed(1)}s)${sc.hasAudio ? " 🔊" : ""} — ${isRu ? "двойной клик → сцена" : "double-click to open"}`}
                        onDoubleClick={() => {
                          if (onSelectSceneIdx) {
                            onSelectSceneIdx(sc.sceneIdx);
                            setMode("scene");
                            setZoomOverride(null);
                          }
                        }}
                      >
                        {widthPx > 50 && (
                          <span className="text-[9px] text-primary-foreground px-1.5 truncate block mt-0.5 font-body">
                            {sc.hasAudio ? "🔊 " : ""}{sc.label}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Playhead positionSec={player.positionSec} zoom={zoom} />
              </div>
            </div>
            {/* Master Effects Tabs — FFT + EQ/CMP/LIM/REV */}
            <div className="flex-1 min-h-0 p-2">
              <MasterEffectsTabs isRu={isRu} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
