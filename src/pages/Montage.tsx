import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Loader2, ZoomIn, ZoomOut, Maximize2, Play, Pause, Square, Volume2, VolumeX, ChevronUp, ChevronDown, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { usePageHeader } from "@/hooks/usePageHeader";
import { useTimelinePlayer } from "@/hooks/useTimelinePlayer";
import { useMixerPersistence } from "@/hooks/useMixerPersistence";
import { MasterMeterPanel } from "@/components/studio/MasterMeterPanel";
import { MasterEffectsTabs } from "@/components/studio/MasterEffectsTabs";
import { TimelineMasterMeter } from "@/components/studio/TimelineMasterMeter";
import { TimelineRuler } from "@/components/studio/TimelineRuler";
import { Playhead } from "@/components/studio/TimelinePlayhead";
import { TrackMixerStrip } from "@/components/studio/TrackMixerStrip";
import type { TimelineClip, SceneBoundary } from "@/hooks/useTimelineClips";

// ─── Types ──────────────────────────────────────────────────
interface SceneRender {
  id: string;
  scene_id: string;
  voice_path: string | null;
  atmo_path: string | null;
  sfx_path: string | null;
  voice_duration_ms: number;
  atmo_duration_ms: number;
  sfx_duration_ms: number;
  status: string;
}

interface StemTrack {
  id: string;
  label: string;
  color: string;
}

const STEM_TRACKS: StemTrack[] = [
  { id: "voice", label: "Voice", color: "hsl(var(--primary))" },
  { id: "atmosphere", label: "Atmosphere", color: "hsl(175 45% 45%)" },
  { id: "sfx", label: "SFX", color: "hsl(220 50% 55%)" },
];

const SIDEBAR_WIDTH = 280;
const MIXER_SIDEBAR = 160;

const Montage = () => {
  const { user } = useAuth();
  const { isRu } = useLanguage();
  const { setPageHeader } = usePageHeader();

  // ── Book & Chapter selection ────────────────────────────────
  const [books, setBooks] = useState<{ id: string; title: string }[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<{ id: string; title: string; chapter_number: number }[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [scenes, setScenes] = useState<{ id: string; title: string; scene_number: number }[]>([]);
  const [loading, setLoading] = useState(true);

  // Scene renders
  const [sceneRenders, setSceneRenders] = useState<SceneRender[]>([]);
  const [rendersLoading, setRendersLoading] = useState(false);

  // Restore from sessionStorage
  useEffect(() => {
    const studioBookId = sessionStorage.getItem("montage_book_id");
    const studioChapterId = sessionStorage.getItem("montage_chapter_id");
    if (studioBookId) { setSelectedBookId(studioBookId); sessionStorage.removeItem("montage_book_id"); }
    if (studioChapterId) { setSelectedChapterId(studioChapterId); sessionStorage.removeItem("montage_chapter_id"); }
  }, []);

  // Load books
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("books").select("id, title").eq("user_id", user.id).order("updated_at", { ascending: false });
      setBooks(data ?? []);
      setLoading(false);
    })();
  }, [user?.id]);

  // Load chapters
  useEffect(() => {
    if (!selectedBookId) { setChapters([]); setSelectedChapterId(null); return; }
    (async () => {
      const { data } = await supabase.from("book_chapters").select("id, title, chapter_number").eq("book_id", selectedBookId).order("chapter_number");
      setChapters(data ?? []);
    })();
  }, [selectedBookId]);

  // Load scenes
  useEffect(() => {
    if (!selectedChapterId) { setScenes([]); return; }
    (async () => {
      const { data } = await supabase.from("book_scenes").select("id, title, scene_number, silence_sec").eq("chapter_id", selectedChapterId).order("scene_number");
      setScenes(data ?? []);
    })();
  }, [selectedChapterId]);

  const sceneIds = useMemo(() => scenes.map(s => s.id), [scenes]);

  // Load scene renders
  useEffect(() => {
    if (sceneIds.length === 0) { setSceneRenders([]); return; }
    setRendersLoading(true);
    (async () => {
      const { data } = await supabase
        .from("scene_renders" as any)
        .select("id, scene_id, voice_path, atmo_path, sfx_path, voice_duration_ms, atmo_duration_ms, sfx_duration_ms, status")
        .in("scene_id", sceneIds)
        .eq("status", "ready");
      setSceneRenders((data as any as SceneRender[]) ?? []);
      setRendersLoading(false);
    })();
  }, [sceneIds.join(",")]);

  // Build rendersMap
  const rendersMap = useMemo(() => {
    const m = new Map<string, SceneRender>();
    for (const r of sceneRenders) m.set(r.scene_id, r);
    return m;
  }, [sceneRenders]);

  const renderedSceneIds = useMemo(() => sceneIds.filter(id => rendersMap.has(id)), [sceneIds, rendersMap]);
  const unrenderedSceneIds = useMemo(() => sceneIds.filter(id => !rendersMap.has(id)), [sceneIds, rendersMap]);

  // ── Build timeline clips from rendered stems ───────────────
  const { clips: timelineClips, sceneBoundaries, totalDurationSec } = useMemo(() => {
    const clips: TimelineClip[] = [];
    const boundaries: SceneBoundary[] = [];
    let offset = 0;

    for (const sceneId of sceneIds) {
      const render = rendersMap.get(sceneId);
      if (!render) continue;

      const silenceSec = 2; // default silence between scenes
      boundaries.push({ startSec: offset, silenceSec, sceneId });
      const sceneStart = offset + silenceSec;

      // Voice stem
      if (render.voice_path && render.voice_duration_ms > 0) {
        clips.push({
          id: `voice-${sceneId}`,
          trackId: "voice",
          speaker: null,
          startSec: sceneStart,
          durationSec: render.voice_duration_ms / 1000,
          label: scenes.find(s => s.id === sceneId)?.title ?? "Voice",
          segmentType: "voice_stem",
          hasAudio: true,
          audioPath: render.voice_path,
          sceneId,
        });
      }

      // Atmosphere stem
      if (render.atmo_path && render.atmo_duration_ms > 0) {
        clips.push({
          id: `atmo-${sceneId}`,
          trackId: "atmosphere",
          speaker: null,
          startSec: sceneStart,
          durationSec: render.atmo_duration_ms / 1000,
          label: scenes.find(s => s.id === sceneId)?.title ?? "Atmo",
          segmentType: "atmo_stem",
          hasAudio: true,
          audioPath: render.atmo_path,
          sceneId,
        });
      }

      // SFX stem
      if (render.sfx_path && render.sfx_duration_ms > 0) {
        clips.push({
          id: `sfx-${sceneId}`,
          trackId: "sfx",
          speaker: null,
          startSec: sceneStart,
          durationSec: render.sfx_duration_ms / 1000,
          label: scenes.find(s => s.id === sceneId)?.title ?? "SFX",
          segmentType: "sfx_stem",
          hasAudio: true,
          audioPath: render.sfx_path,
          sceneId,
        });
      }

      // Scene duration = max of all stems
      const maxDur = Math.max(
        render.voice_duration_ms,
        render.atmo_duration_ms,
        render.sfx_duration_ms,
      ) / 1000;
      offset = sceneStart + maxDur;
    }

    return { clips, sceneBoundaries: boundaries, totalDurationSec: offset };
  }, [sceneIds, rendersMap, scenes]);

  // ── Player ─────────────────────────────────────────────────
  const player = useTimelinePlayer(timelineClips);
  const duration = player.totalDuration > 0 ? player.totalDuration : totalDurationSec;

  // ── Mixer persistence ──────────────────────────────────────
  const trackIds = useMemo(() => STEM_TRACKS.map(t => t.id), []);
  const { scheduleSave: onMixChange } = useMixerPersistence(selectedChapterId, trackIds);

  // ── Zoom ───────────────────────────────────────────────────
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (tracksContainerRef.current) setContainerWidth(tracksContainerRef.current.clientWidth - MIXER_SIDEBAR);
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

  const toPercent = useCallback((z: number) => fitZoom > 0 ? (z / fitZoom) * 100 : 100, [fitZoom]);
  const displayZoomPercent = Math.round(toPercent(zoom));

  const UNDER_100_STEPS = [5, 10, 15, 25, 50, 75, 100] as const;
  const stepZoom = useCallback((cur: number, dir: "in" | "out") => {
    if (dir === "in") {
      if (cur < 100) return UNDER_100_STEPS.find(s => s > cur + 0.001) ?? 100;
      return Math.min(1000, (Math.floor(cur / 100) + 1) * 100);
    }
    if (cur <= 100) {
      const lower = UNDER_100_STEPS.filter(s => s < cur - 0.001);
      return lower.length > 0 ? lower[lower.length - 1] : 5;
    }
    return Math.max(100, (Math.ceil(cur / 100) - 1) * 100);
  }, []);

  const adjustZoom = useCallback((dir: "in" | "out") => {
    setZoomOverride(prev => {
      const cur = toPercent(prev ?? fitZoom);
      return (fitZoom * stepZoom(cur, dir)) / 100;
    });
  }, [fitZoom, stepZoom, toPercent]);

  const resetZoom = useCallback(() => setZoomOverride(null), []);

  // ── Spacebar ───────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      player.state === "playing" ? player.pause() : player.play();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  // ── Timeline panel collapse ────────────────────────────────
  const [timelineHeight, setTimelineHeight] = useState(300);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);

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

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // ── Clips grouped by track ─────────────────────────────────
  const clipsByTrack = useMemo(() => {
    const map = new Map<string, TimelineClip[]>();
    for (const clip of timelineClips) {
      const list = map.get(clip.trackId) ?? [];
      list.push(clip);
      map.set(clip.trackId, list);
    }
    return map;
  }, [timelineClips]);

  // ── Page header ────────────────────────────────────────────
  const selectedBook = books.find(b => b.id === selectedBookId);
  const selectedChapter = chapters.find(c => c.id === selectedChapterId);
  const title = isRu ? "МОНТАЖ" : "MONTAGE";
  const subtitle = selectedBook && selectedChapter
    ? `${selectedBook.title} → ${selectedChapter.title}`
    : (isRu ? "Финальный монтаж и мастеринг глав" : "Final chapter montage & mastering");

  useEffect(() => {
    setPageHeader({ title, subtitle });
    return () => setPageHeader({});
  }, [title, subtitle]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3rem)]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-[calc(100vh-3rem)] min-h-0 overflow-hidden"
    >
      {/* Book/Chapter selectors */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0">
        <Select value={selectedBookId ?? ""} onValueChange={(v) => { setSelectedBookId(v); setSelectedChapterId(null); }}>
          <SelectTrigger className="h-8 w-[240px] text-sm font-body">
            <SelectValue placeholder={isRu ? "Выберите книгу..." : "Select book..."} />
          </SelectTrigger>
          <SelectContent>
            {books.map(b => (
              <SelectItem key={b.id} value={b.id} className="text-sm">{b.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedChapterId ?? ""} onValueChange={setSelectedChapterId} disabled={!selectedBookId}>
          <SelectTrigger className="h-8 w-[300px] text-sm font-body">
            <SelectValue placeholder={isRu ? "Выберите главу..." : "Select chapter..."} />
          </SelectTrigger>
          <SelectContent>
            {chapters.map(c => (
              <SelectItem key={c.id} value={c.id} className="text-sm">
                {c.chapter_number}. {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {sceneIds.length > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            {unrenderedSceneIds.length > 0 && (
            <span className="text-xs text-destructive flex items-center gap-1 font-body">
                <AlertCircle className="h-3 w-3" />
                {unrenderedSceneIds.length} {isRu ? "не отрендерено" : "not rendered"}
              </span>
            )}
            <span className="text-xs text-muted-foreground font-body">
              {renderedSceneIds.length}/{scenes.length} {isRu ? "сцен" : "scenes"} · {formatTime(duration)}
            </span>
          </div>
        )}
      </div>

      {/* Main content */}
      {selectedChapterId && sceneIds.length > 0 ? (
        <>
          {/* Effects workspace */}
          <div className="flex-1 min-h-0 overflow-hidden p-4">
            <div className="h-full rounded-lg border border-border bg-card/50 overflow-hidden flex">
              <div className="shrink-0 border-r border-border" style={{ width: `${SIDEBAR_WIDTH}px` }}>
                <MasterMeterPanel isRu={isRu} width={SIDEBAR_WIDTH} />
              </div>
              <div className="flex-1 min-h-0 p-2">
                <MasterEffectsTabs isRu={isRu} />
              </div>
            </div>
          </div>

          {/* Timeline (collapsible bottom panel) — 3 stem tracks */}
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

                {/* Transport */}
                <div className="flex items-center gap-0.5">
                  {player.state === "playing" ? (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={player.pause}><Pause className="h-3.5 w-3.5" /></Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={player.play} disabled={!player.hasAudio}><Play className="h-3.5 w-3.5" /></Button>
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
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjustZoom("out")}><ZoomOut className="h-3.5 w-3.5" /></Button>
                <span className="text-xs text-muted-foreground font-body w-10 text-center">{displayZoomPercent}%</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjustZoom("in")}><ZoomIn className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetZoom}><Maximize2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>

            {/* Stem tracks */}
            {!timelineCollapsed && (
              <div ref={tracksContainerRef} className="flex-1 flex min-h-0 overflow-hidden">
                {/* Mixer sidebar */}
                <div className="shrink-0 border-r border-border flex flex-col" style={{ width: `${MIXER_SIDEBAR}px` }}>
                  <div className="h-6 border-b border-border" />
                  {STEM_TRACKS.map((track) => (
                    <TrackMixerStrip
                      key={track.id}
                      trackId={track.id}
                      label={track.label}
                      color={track.color}
                      expanded={false}
                      onMixChange={onMixChange}
                    />
                  ))}
                </div>

                {/* Timeline area */}
                <div className="flex-1 overflow-x-auto overflow-y-hidden">
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
                      <TimelineRuler zoom={zoom} duration={duration} sceneBoundaries={sceneBoundaries} />
                    </div>

                    {/* Render stem clips as blocks */}
                    {STEM_TRACKS.map((track) => {
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
                                style={{
                                  left: `${left}px`,
                                  width: `${width}px`,
                                  backgroundColor: track.color,
                                }}
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
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <p className="text-lg font-display">
              {isRu ? "Выберите книгу и главу для монтажа" : "Select a book and chapter to montage"}
            </p>
            <p className="text-sm font-body">
              {isRu ? "Отрендерите сцены в Студии, затем соберите главу здесь" : "Render scenes in Studio, then assemble the chapter here"}
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default Montage;
