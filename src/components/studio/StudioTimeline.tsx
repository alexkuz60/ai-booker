import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ChevronUp, ChevronDown, Plus, ZoomIn, ZoomOut, Maximize2, Layers, Film, Play, Pause, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useTimelineClips, type TimelineClip } from "@/hooks/useTimelineClips";
import { useTimelinePlayer } from "@/hooks/useTimelinePlayer";

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

const TRACK_LABELS_WIDTH = 112;

// ─── Palette for character colors ───────────────────────────

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

// ─── Sub-components ─────────────────────────────────────────

function TimelineRuler({ zoom, duration }: { zoom: number; duration: number }) {
  const marks: number[] = [];
  const step = Math.max(1, Math.round(10 / zoom));
  for (let t = 0; t <= duration; t += step) marks.push(t);
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };
  return (
    <div className="flex items-end h-6 border-b border-border relative" style={{ width: `${duration * zoom * 4}px` }}>
      {marks.map((t) => (
        <div key={t} className="absolute bottom-0 flex flex-col items-center" style={{ left: `${t * zoom * 4}px` }}>
          <span className="text-[10px] text-muted-foreground font-body mb-0.5">{formatTime(t)}</span>
          <div className="w-px h-2 bg-border" />
        </div>
      ))}
    </div>
  );
}

function TimelineTrack({
  track,
  zoom,
  duration,
  clips: realClips,
}: {
  track: TimelineTrackData;
  zoom: number;
  duration: number;
  clips?: TimelineClip[];
}) {
  const clips = realClips && realClips.length > 0
    ? realClips.map(c => ({
        start: c.startSec,
        end: c.startSec + c.durationSec,
        label: c.label,
        type: c.segmentType,
        hasAudio: c.hasAudio,
      }))
    : track.type === "atmosphere"
      ? [{ start: 0, end: duration, label: track.label, type: "atmosphere", hasAudio: false }]
      : track.type === "sfx"
        ? []
        : [];

  return (
    <div className="flex h-10 border-b border-border/50 relative" style={{ width: `${duration * zoom * 4}px` }}>
      {clips.filter(c => c.start < c.end).map((clip, i) => {
        const widthPx = (clip.end - clip.start) * zoom * 4;
        return (
          <div
            key={i}
            className={`absolute top-1 bottom-1 rounded-sm transition-opacity cursor-pointer ${
              clip.hasAudio ? "opacity-90 hover:opacity-100" : "opacity-50 hover:opacity-70"
            }`}
            style={{
              left: `${clip.start * zoom * 4}px`,
              width: `${widthPx}px`,
              backgroundColor: track.color,
              backgroundImage: clip.hasAudio
                ? undefined
                : "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.08) 3px, rgba(255,255,255,0.08) 6px)",
            }}
            title={`${clip.label} (${(clip.end - clip.start).toFixed(1)}s)${clip.hasAudio ? " 🔊" : ""}`}
          >
            {widthPx > 40 && (
              <span className="text-[9px] text-primary-foreground px-1.5 truncate block mt-0.5 font-body">
                {clip.hasAudio ? "🔊 " : ""}{clip.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Playhead ───────────────────────────────────────────────

function Playhead({ positionSec, zoom }: { positionSec: number; zoom: number }) {
  const leftPx = positionSec * zoom * 4;
  return (
    <div
      className="absolute top-0 bottom-0 pointer-events-none z-20"
      style={{ left: `${leftPx}px` }}
    >
      {/* Triangle head */}
      <div
        className="absolute -top-0.5 -translate-x-1/2 w-0 h-0"
        style={{
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: "6px solid hsl(var(--primary))",
        }}
      />
      {/* Vertical line */}
      <div className="absolute top-1 bottom-0 w-px bg-primary -translate-x-1/2" />
    </div>
  );
}

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
  /** Currently selected character ID (synced with CharactersPanel) */
  selectedCharacterId?: string | null;
  /** Callback when a track is clicked */
  onSelectCharacter?: (characterId: string | null) => void;
  /** Callback when a scene is selected (double-click in chapter mode) */
  onSelectSceneIdx?: (idx: number) => void;
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
}: StudioTimelineProps) {
  const [mode, setMode] = useState<"scene" | "chapter">("scene");

  

  // ── Character tracks ──────────────────────────────────────
  const [charTracks, setCharTracks] = useState<TimelineTrackData[]>([]);
  const [speakerToCharId, setSpeakerToCharId] = useState<Map<string, string>>(new Map());

  const contextSceneIds = useMemo(() =>
    mode === "scene"
      ? (sceneId ? [sceneId] : [])
      : (chapterSceneIds ?? []),
    [mode, sceneId, chapterSceneIds?.join(",")]
  );

  useEffect(() => {
    if (!bookId) { setCharTracks([]); setSpeakerToCharId(new Map()); return; }
    if (contextSceneIds.length === 0) { setCharTracks([]); setSpeakerToCharId(new Map()); return; }

    (async () => {
      const { data: appearances } = await supabase
        .from("character_appearances")
        .select("character_id")
        .in("scene_id", contextSceneIds);

      if (!appearances?.length) { setCharTracks([]); setSpeakerToCharId(new Map()); return; }

      const charIds = [...new Set(appearances.map(a => a.character_id))];

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
  }, [bookId, sceneId, chapterSceneIds?.join(","), mode]);

  // ── Real clips from segments (moved above duration calc) ──
  const { clips: timelineClips } = useTimelineClips(contextSceneIds, speakerToCharId);

  // ── Audio player ──────────────────────────────────────────
  const player = useTimelinePlayer(timelineClips);

  // ── Duration: prefer actual clip data, fallback to estimate ──
  const clipsDuration = player.totalDuration;
  const estimateDuration = mode === "scene"
    ? (sceneDurationSec && sceneDurationSec > 0 ? sceneDurationSec : 60)
    : (chapterDurationSec && chapterDurationSec > 0 ? chapterDurationSec : 180);
  const duration = clipsDuration > 0 ? clipsDuration : estimateDuration;

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
    // Group timeline clips by scene_id to get per-scene duration
    const durationByScene = new Map<string, { total: number; hasAudio: boolean }>();
    // scene_id is encoded in the original clips via the sceneIds ordering
    // We need to re-derive from the raw clips. Each clip has an `id` which is a segment id.
    // Instead, use the clips' startSec/durationSec grouped by scene offset.
    // Simpler: use the timelineClips which are ordered by scene, and group by sceneId.
    // But TimelineClip doesn't have sceneId. Let's compute from contextSceneIds ordering.

    // Build scene clips from estimates or segment data
    const CHARS_PER_SEC = 14;
    const result: ChapterSceneClip[] = [];
    let offset = 0;

    for (let i = 0; i < chapterSceneIds.length; i++) {
      const sid = chapterSceneIds[i];
      const sceneInfo = chapterScenes?.find(s => s.id === sid);
      
      // Find clips belonging to this scene by checking if they fall within the scene's time range
      // Since clips are sequential per scene, we can sum durations of segments for this scene
      const sceneSegmentClips = timelineClips.filter(c => {
        // We need to match clips to scenes. Clips don't have sceneId.
        // Use the segment query approach - check if clip start falls in expected range
        return false; // placeholder
      });

      // Better approach: compute from the offset structure in useTimelineClips
      // The clips are laid out sequentially scene by scene matching chapterSceneIds order
      // So we can partition by looking at the gap pattern
      let sceneDuration = 0;
      let sceneHasAudio = false;

      // Collect all clips that belong to scene at index i
      // Since useTimelineClips processes scenes in order, we can track cumulative offsets
      // For now, estimate from scene content or use a fixed estimate
      // We'll enhance useTimelineClips to include sceneId on clips

      result.push({
        sceneId: sid,
        sceneIdx: i,
        label: sceneInfo?.title || `${isRu ? "Сцена" : "Scene"} ${sceneInfo?.scene_number ?? i + 1}`,
        startSec: offset,
        durationSec: 0, // placeholder, filled below
        hasAudio: false,
      });
    }

    return result;
  }, [mode, chapterSceneIds, chapterScenes, timelineClips, isRu]);

  // Auto-add narrator-fallback track if clips reference it (scene mode only)
  const allTracks = useMemo(() => {
    if (mode === "chapter") return FIXED_TRACKS; // chapter mode uses scene track, not character tracks
    const hasNarratorFallback = timelineClips.some(c => c.trackId === "narrator-fallback");
    const narratorTrack: TimelineTrackData[] = hasNarratorFallback
      ? [{ id: "narrator-fallback", label: isRu ? "Рассказчик" : "Narrator", color: "hsl(var(--primary))", type: "narrator" }]
      : [];
    return [...narratorTrack, ...charTracks, ...FIXED_TRACKS];
  }, [charTracks, timelineClips, isRu, mode]);

  // ── Layout / zoom ─────────────────────────────────────────
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (tracksContainerRef.current) {
        setContainerWidth(tracksContainerRef.current.clientWidth - TRACK_LABELS_WIDTH);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (tracksContainerRef.current) ro.observe(tracksContainerRef.current);
    return () => ro.disconnect();
  }, []);

  const fitZoom = useMemo(() => {
    if (containerWidth <= 0 || duration <= 0) return 1;
    return containerWidth / (duration * 4);
  }, [containerWidth, duration]);

  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const zoom = zoomOverride ?? fitZoom;

  useEffect(() => { setZoomOverride(null); }, [fitZoom]);

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

  const adjustZoom = useCallback((delta: number) => {
    setZoomOverride((prev) => {
      const current = prev ?? fitZoom;
      return Math.max(0.1, Math.min(10, current + delta));
    });
  }, [fitZoom]);

  const resetZoom = useCallback(() => setZoomOverride(null), []);
  const displayZoomPercent = Math.round(zoom * 100);

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
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjustZoom(-0.25)} title={isRu ? "Уменьшить" : "Zoom out"}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground font-body w-10 text-center">{displayZoomPercent}%</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjustZoom(0.25)} title={isRu ? "Увеличить" : "Zoom in"}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetZoom} title={isRu ? "По ширине" : "Fit to width"}>
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Tracks */}
      {!collapsed && (
        <div ref={tracksContainerRef} className="flex-1 flex min-h-0 overflow-hidden">
          <div className="w-28 shrink-0 border-r border-border flex flex-col">
            <div className="h-6 border-b border-border" />
            {allTracks.map((track) => {
              const charId = track.id.startsWith("char-") ? track.id.slice(5) : null;
              const isSelected = charId != null && charId === selectedCharacterId;
              return (
                <div
                  key={track.id}
                  className={`h-10 flex items-center px-3 border-b border-border/50 cursor-pointer transition-colors ${
                    isSelected ? "bg-accent/20" : "hover:bg-muted/30"
                  }`}
                  onClick={() => {
                    if (charId && onSelectCharacter) {
                      onSelectCharacter(isSelected ? null : charId);
                    }
                  }}
                >
                  <div className="w-2 h-2 rounded-full shrink-0 mr-2" style={{ backgroundColor: track.color }} />
                  <span className={`text-xs font-body truncate ${isSelected ? "text-foreground font-medium" : "text-muted-foreground"}`}>{track.label}</span>
                </div>
              );
            })}
          </div>
          <ScrollArea className="flex-1">
            <div
              className="min-w-full relative cursor-crosshair"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const sec = x / (zoom * 4);
                player.seek(Math.max(0, Math.min(sec, duration)));
              }}
            >
              <TimelineRuler zoom={zoom} duration={duration} />
              {allTracks.map((track) => (
                <TimelineTrack key={track.id} track={track} zoom={zoom} duration={duration} clips={clipsByTrack.get(track.id)} />
              ))}
              {/* Playhead */}
              <Playhead positionSec={player.positionSec} zoom={zoom} />
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
