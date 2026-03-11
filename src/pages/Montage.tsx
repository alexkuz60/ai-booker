import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Loader2, ZoomIn, ZoomOut, Maximize2, Play, Pause, Square, Volume2, VolumeX, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { usePageHeader } from "@/hooks/usePageHeader";
import { useTimelineClips, type TimelineClip, type TypeMappingsByScene } from "@/hooks/useTimelineClips";
import { useTimelinePlayer } from "@/hooks/useTimelinePlayer";
import { useMixerPersistence } from "@/hooks/useMixerPersistence";
import { MasterMeterPanel } from "@/components/studio/MasterMeterPanel";
import { MasterEffectsTabs } from "@/components/studio/MasterEffectsTabs";
import { TimelineMasterMeter } from "@/components/studio/TimelineMasterMeter";
import { TimelineRuler } from "@/components/studio/TimelineRuler";
import { Playhead } from "@/components/studio/TimelinePlayhead";

// ─── Types ──────────────────────────────────────────────────
interface ChapterSceneClip {
  sceneId: string;
  sceneIdx: number;
  label: string;
  startSec: number;
  durationSec: number;
  hasAudio: boolean;
}

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

const SIDEBAR_WIDTH = 280;

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

  // Restore from sessionStorage (when coming from Studio)
  useEffect(() => {
    const studioBookId = sessionStorage.getItem("montage_book_id");
    const studioChapterId = sessionStorage.getItem("montage_chapter_id");
    if (studioBookId) {
      setSelectedBookId(studioBookId);
      sessionStorage.removeItem("montage_book_id");
    }
    if (studioChapterId) {
      setSelectedChapterId(studioChapterId);
      sessionStorage.removeItem("montage_chapter_id");
    }
  }, []);

  // Load books
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("books")
        .select("id, title")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      setBooks(data ?? []);
      setLoading(false);
    })();
  }, [user?.id]);

  // Load chapters when book selected
  useEffect(() => {
    if (!selectedBookId) { setChapters([]); setSelectedChapterId(null); return; }
    (async () => {
      const { data } = await supabase
        .from("book_chapters")
        .select("id, title, chapter_number")
        .eq("book_id", selectedBookId)
        .order("chapter_number");
      setChapters(data ?? []);
    })();
  }, [selectedBookId]);

  // Load scenes when chapter selected
  useEffect(() => {
    if (!selectedChapterId) { setScenes([]); return; }
    (async () => {
      const { data } = await supabase
        .from("book_scenes")
        .select("id, title, scene_number")
        .eq("chapter_id", selectedChapterId)
        .order("scene_number");
      setScenes(data ?? []);
    })();
  }, [selectedChapterId]);

  const sceneIds = useMemo(() => scenes.map(s => s.id), [scenes]);

  // ── Character tracks + type mappings ───────────────────────
  const [speakerToCharId, setSpeakerToCharId] = useState<Map<string, string>>(new Map());
  const [typeMappings, setTypeMappings] = useState<TypeMappingsByScene>(new Map());

  useEffect(() => {
    if (!selectedBookId || sceneIds.length === 0) {
      setSpeakerToCharId(new Map());
      setTypeMappings(new Map());
      return;
    }
    (async () => {
      const [{ data: rawMappings }, { data: chars }] = await Promise.all([
        supabase.from("scene_type_mappings").select("scene_id, segment_type, character_id").in("scene_id", sceneIds),
        supabase.from("book_characters").select("id, name, aliases").eq("book_id", selectedBookId),
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

      const nameMap = new Map<string, string>();
      if (chars) {
        for (const c of chars) {
          nameMap.set(c.name.toLowerCase(), c.id);
          for (const alias of (c.aliases ?? [])) {
            if (alias) nameMap.set((alias as string).toLowerCase(), c.id);
          }
        }
      }
      setSpeakerToCharId(nameMap);
    })();
  }, [selectedBookId, sceneIds.join(",")]);

  // ── Timeline clips ─────────────────────────────────────────
  const { clips: timelineClips, sceneBoundaries } = useTimelineClips(sceneIds, speakerToCharId, 0, typeMappings);
  const player = useTimelinePlayer(timelineClips);

  // ── Build chapter scene clips ──────────────────────────────
  const chapterSceneClips = useMemo<ChapterSceneClip[]>(() => {
    if (sceneIds.length === 0) return [];

    const clipsByScene = new Map<string, TimelineClip[]>();
    for (const c of timelineClips) {
      const list = clipsByScene.get(c.sceneId) ?? [];
      list.push(c);
      clipsByScene.set(c.sceneId, list);
    }

    const DEFAULT_SCENE_SEC = 30;
    const result: ChapterSceneClip[] = [];
    let offset = 0;

    for (let i = 0; i < sceneIds.length; i++) {
      const sid = sceneIds[i];
      const sceneInfo = scenes[i];
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
        sceneId: sid, sceneIdx: i,
        label: sceneInfo?.title || `${isRu ? "Сцена" : "Scene"} ${sceneInfo?.scene_number ?? i + 1}`,
        startSec: offset, durationSec: sceneDuration, hasAudio,
      });
      offset += sceneDuration;
    }
    return result;
  }, [sceneIds, scenes, timelineClips, isRu]);

  const duration = chapterSceneClips.length > 0
    ? chapterSceneClips[chapterSceneClips.length - 1].startSec + chapterSceneClips[chapterSceneClips.length - 1].durationSec
    : 0;

  // ── Mixer persistence ──────────────────────────────────────
  const { scheduleSave: onMixChange } = useMixerPersistence(selectedChapterId, []);

  // ── Zoom ───────────────────────────────────────────────────
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (tracksContainerRef.current) setContainerWidth(tracksContainerRef.current.clientWidth - SIDEBAR_WIDTH);
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

        {duration > 0 && (
          <span className="text-xs text-muted-foreground font-body ml-auto">
            {scenes.length} {isRu ? "сцен" : "scenes"} · {formatTime(duration)}
          </span>
        )}
      </div>

      {/* Main content — mastering + effects fill the space above the timeline */}
      {selectedChapterId && sceneIds.length > 0 ? (
        <>
          {/* Effects workspace */}
          <div className="flex-1 min-h-0 overflow-hidden p-4">
            <div className="h-full rounded-lg border border-border bg-card/50 overflow-hidden flex">
              {/* Left: Master Meter */}
              <div className="shrink-0 border-r border-border" style={{ width: `${SIDEBAR_WIDTH}px` }}>
                <MasterMeterPanel isRu={isRu} width={SIDEBAR_WIDTH} />
              </div>
              {/* Right: Effects tabs */}
              <div className="flex-1 min-h-0 p-2">
                <MasterEffectsTabs isRu={isRu} />
              </div>
            </div>
          </div>

          {/* Timeline (collapsible bottom panel) */}
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
                    {isRu ? "Монтаж" : "Montage"}
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

            {/* Scene blocks */}
            {!timelineCollapsed && (
              <div ref={tracksContainerRef} className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
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
                  <div className="flex h-10 border-b border-border/50 relative" style={{ width: `${duration * zoom * 4}px` }}>
                    {chapterSceneClips.map((sc, i) => {
                      const widthPx = sc.durationSec * zoom * 4;
                      return (
                        <div
                          key={sc.sceneId}
                          className={`absolute top-1 bottom-1 rounded-sm cursor-pointer transition-all ${sc.hasAudio ? "opacity-90 hover:opacity-100" : "opacity-50 hover:opacity-70"}`}
                          style={{
                            left: `${sc.startSec * zoom * 4}px`,
                            width: `${widthPx}px`,
                            backgroundColor: NARRATOR_COLORS[i % NARRATOR_COLORS.length],
                            backgroundImage: sc.hasAudio ? undefined : "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.08) 3px, rgba(255,255,255,0.08) 6px)",
                          }}
                          title={`${sc.label} (${sc.durationSec.toFixed(1)}s)${sc.hasAudio ? " 🔊" : ""}`}
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
              {isRu ? "Все клипы сцен считаются готовыми" : "All scene clips are treated as ready"}
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default Montage;
