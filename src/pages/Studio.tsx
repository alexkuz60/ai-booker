import { motion } from "framer-motion";
import { ChevronRight, ChevronDown, ChevronUp, Mic2, Wind, Volume2, Plus, ZoomIn, ZoomOut, Clapperboard, Users } from "lucide-react";
import { useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { loadStudioChapter, type StudioChapter, type StudioScene } from "@/lib/studioChapter";
import { useLanguage } from "@/hooks/useLanguage";

// ─── Scene type colors (same as Parser) ─────────────────────
const SCENE_TYPE_COLORS: Record<string, string> = {
  action: "bg-red-500/20 text-red-400 border-red-500/30",
  dialogue: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  lyrical_digression: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  description: "bg-green-500/20 text-green-400 border-green-500/30",
  inner_monologue: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  mixed: "bg-muted text-muted-foreground border-border",
};

const SCENE_TYPE_RU: Record<string, string> = {
  action: "действие",
  dialogue: "диалог",
  lyrical_digression: "лир. отступление",
  description: "описание",
  inner_monologue: "внутр. монолог",
  mixed: "смешанный",
};

// ─── Timeline components ────────────────────────────────────
const MOCK_TRACKS = [
  { id: "narrator-1", label: "Диктор 1", color: "hsl(var(--primary))", type: "narrator" },
  { id: "narrator-2", label: "Диктор 2", color: "hsl(var(--accent))", type: "narrator" },
  { id: "ambience", label: "Атмосфера", color: "hsl(175 45% 45%)", type: "atmosphere" },
  { id: "sfx", label: "SFX", color: "hsl(220 50% 55%)", type: "sfx" },
];

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

function TimelineTrack({ track, zoom, duration }: { track: typeof MOCK_TRACKS[0]; zoom: number; duration: number }) {
  const clips = track.id === "narrator-1"
    ? [{ start: 0, end: 45 }, { start: 50, end: 120 }]
    : track.id === "narrator-2"
    ? [{ start: 48, end: 80 }]
    : track.id === "ambience"
    ? [{ start: 0, end: 180 }]
    : [{ start: 20, end: 25 }, { start: 60, end: 63 }, { start: 100, end: 104 }];

  return (
    <div className="flex h-10 border-b border-border/50 relative" style={{ width: `${duration * zoom * 4}px` }}>
      {clips.map((clip, i) => (
        <div
          key={i}
          className="absolute top-1 bottom-1 rounded-sm opacity-80 hover:opacity-100 transition-opacity cursor-pointer"
          style={{
            left: `${clip.start * zoom * 4}px`,
            width: `${(clip.end - clip.start) * zoom * 4}px`,
            backgroundColor: track.color,
          }}
        >
          {(clip.end - clip.start) * zoom * 4 > 40 && (
            <span className="text-[9px] text-primary-foreground px-1.5 truncate block mt-0.5 font-body">
              {track.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Chapter Navigator ──────────────────────────────────────

function ChapterNavigator({
  chapter,
  selectedSceneIdx,
  onSelectScene,
  isRu,
}: {
  chapter: StudioChapter;
  selectedSceneIdx: number | null;
  onSelectScene: (idx: number | null) => void;
  isRu: boolean;
}) {
  const [chapterOpen, setChapterOpen] = useState(true);

  return (
    <div className="h-full flex flex-col border-r border-border">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-body">
            {isRu ? "Глава" : "Chapter"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {chapter.bookTitle}
        </p>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-2 px-1">
          <Collapsible open={chapterOpen} onOpenChange={setChapterOpen}>
            <CollapsibleTrigger asChild>
              <button
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-base font-body rounded-md transition-colors",
                  "hover:bg-accent/50 font-semibold text-foreground"
                )}
                onClick={() => onSelectScene(null)}
              >
                {chapterOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{chapter.chapterTitle}</span>
                <Badge variant="outline" className="ml-auto text-[11px] shrink-0">
                  {chapter.scenes.length}
                </Badge>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-0.5">
                {chapter.scenes.map((scene, idx) => {
                  const colorClass = SCENE_TYPE_COLORS[scene.scene_type] || SCENE_TYPE_COLORS.mixed;
                  return (
                    <button
                      key={idx}
                      onClick={() => onSelectScene(idx)}
                      className={cn(
                        "w-full flex items-center gap-2 pl-9 pr-3 py-2 text-sm font-body rounded-md transition-colors text-left",
                        "hover:bg-accent/50",
                        selectedSceneIdx === idx && "bg-primary/10 text-primary border-r-2 border-primary"
                      )}
                    >
                      <span className={cn("px-1.5 py-0.5 rounded text-[10px] border shrink-0", colorClass)}>
                        {isRu ? (SCENE_TYPE_RU[scene.scene_type] || scene.scene_type) : scene.scene_type}
                      </span>
                      <span className="truncate flex-1">{scene.title}</span>
                      <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                        {scene.bpm}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────

function EmptyNavigator({ isRu }: { isRu: boolean }) {
  return (
    <div className="h-full flex flex-col border-r border-border">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-body">
          {isRu ? "Глава" : "Chapter"}
        </span>
      </div>
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <Clapperboard className="h-8 w-8 mx-auto text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            {isRu
              ? "Откройте главу из Парсера, нажав иконку 🎬 рядом с проанализированной главой"
              : "Open a chapter from Parser by clicking the 🎬 icon next to an analyzed chapter"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Studio ────────────────────────────────────────────

const Studio = () => {
  const { isRu } = useLanguage();
  const [chapter] = useState<StudioChapter | null>(() => loadStudioChapter());
  const [selectedSceneIdx, setSelectedSceneIdx] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const duration = 180;

  // Timeline collapse & height persistence
  const [timelineCollapsed, setTimelineCollapsed] = useState(() => {
    try { return localStorage.getItem("studio-timeline-collapsed") === "true"; } catch { return false; }
  });
  const [timelineSize, setTimelineSize] = useState(() => {
    try { return Number(localStorage.getItem("studio-timeline-size")) || 250; } catch { return 250; }
  });

  const toggleTimeline = useCallback(() => {
    setTimelineCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("studio-timeline-collapsed", String(next));
      return next;
    });
  }, []);

  const handleTimelineMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startSize = timelineSize;
    const onMouseMove = (ev: MouseEvent) => {
      const newSize = Math.max(100, startSize + (startY - ev.clientY));
      setTimelineSize(newSize);
      localStorage.setItem("studio-timeline-size", String(newSize));
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [timelineSize]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 flex flex-col h-full"
    >
      {/* Header */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <h1 className="font-display text-2xl font-bold text-foreground">
          {isRu ? "Студия" : "Studio"}
        </h1>
        <p className="text-sm text-muted-foreground font-body">
          {chapter
            ? `${chapter.bookTitle} → ${chapter.chapterTitle}`
            : (isRu ? "Рабочая панель" : "Workspace")}
        </p>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 min-h-0 overflow-hidden">
          <ResizablePanelGroup direction="horizontal" className="h-full">
            {/* Left: Chapter navigator */}
            <ResizablePanel defaultSize={30} minSize={15} maxSize={50}>
              {chapter ? (
                <ChapterNavigator
                  chapter={chapter}
                  selectedSceneIdx={selectedSceneIdx}
                  onSelectScene={setSelectedSceneIdx}
                  isRu={isRu}
                />
              ) : (
                <EmptyNavigator isRu={isRu} />
              )}
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right: Tabs workspace */}
            <ResizablePanel defaultSize={70}>
              <div className="h-full flex flex-col p-4">
                <Tabs defaultValue="narrators" className="flex-1 flex flex-col min-h-0">
                  <TabsList className="w-fit shrink-0">
                    <TabsTrigger value="narrators" className="gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      <span className="font-body text-sm">{isRu ? "Персонажи" : "Characters"}</span>
                    </TabsTrigger>
                    <TabsTrigger value="atmosphere" className="gap-1.5">
                      <Wind className="h-3.5 w-3.5" />
                      <span className="font-body text-sm">{isRu ? "Атмосфера" : "Atmosphere"}</span>
                    </TabsTrigger>
                    <TabsTrigger value="sounds" className="gap-1.5">
                      <Volume2 className="h-3.5 w-3.5" />
                      <span className="font-body text-sm">{isRu ? "Звуки" : "Sounds"}</span>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="narrators" className="flex-1 mt-4">
                    <div className="rounded-lg border border-border bg-card/50 h-full flex items-center justify-center">
                      <p className="text-sm text-muted-foreground font-body">
                        {isRu ? "Управление персонажами для выбранного раздела" : "Character management for selected section"}
                      </p>
                    </div>
                  </TabsContent>

                  <TabsContent value="atmosphere" className="flex-1 mt-4">
                    <div className="rounded-lg border border-border bg-card/50 h-full flex items-center justify-center">
                      <p className="text-sm text-muted-foreground font-body">
                        {isRu ? "Фоновая атмосфера и эмбиент" : "Background atmosphere and ambience"}
                      </p>
                    </div>
                  </TabsContent>

                  <TabsContent value="sounds" className="flex-1 mt-4">
                    <div className="rounded-lg border border-border bg-card/50 h-full flex items-center justify-center">
                      <p className="text-sm text-muted-foreground font-body">
                        {isRu ? "Конкретные звуковые эффекты" : "Sound effects"}
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* BOTTOM: Multitrack Timeline */}
        <div className="flex flex-col bg-background border-t border-border shrink-0" style={timelineCollapsed ? undefined : { height: `${timelineSize}px` }}>
          {/* Resize handle */}
          {!timelineCollapsed && (
            <div
              onMouseDown={handleTimelineMouseDown}
              className="h-1 cursor-row-resize hover:bg-primary/30 transition-colors shrink-0"
            />
          )}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
              <button
                onClick={toggleTimeline}
                className="flex items-center gap-1.5 hover:text-foreground transition-colors"
              >
                {timelineCollapsed ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-body">
                  {isRu ? "Таймлайн" : "Timeline"}
                </span>
              </button>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground font-body w-10 text-center">{Math.round(zoom * 100)}%</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <div className="w-px h-4 bg-border mx-1" />
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

          {!timelineCollapsed && (
            <div className="flex-1 flex min-h-0">
              <div className="w-28 shrink-0 border-r border-border flex flex-col">
                <div className="h-6 border-b border-border" />
                {MOCK_TRACKS.map((track) => (
                  <div key={track.id} className="h-10 flex items-center px-3 border-b border-border/50">
                    <div className="w-2 h-2 rounded-full shrink-0 mr-2" style={{ backgroundColor: track.color }} />
                    <span className="text-xs text-muted-foreground font-body truncate">{track.label}</span>
                  </div>
                ))}
              </div>
              <ScrollArea className="flex-1">
                <div className="min-w-full">
                  <TimelineRuler zoom={zoom} duration={duration} />
                  {MOCK_TRACKS.map((track) => (
                    <TimelineTrack key={track.id} track={track} zoom={zoom} duration={duration} />
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default Studio;
