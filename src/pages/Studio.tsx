import { motion } from "framer-motion";
import { ChevronRight, ChevronDown, Mic2, Wind, Volume2, Plus, ZoomIn, ZoomOut } from "lucide-react";
import { useState, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

// Mock book structure
const bookStructure = [
  {
    id: "ch1",
    title: "Глава 1. Начало",
    children: [
      { id: "ch1-1", title: "Эпизод 1.1", children: [] },
      { id: "ch1-2", title: "Эпизод 1.2", children: [
        { id: "ch1-2-1", title: "Сцена A", children: [] },
        { id: "ch1-2-2", title: "Сцена B", children: [] },
      ]},
    ],
  },
  {
    id: "ch2",
    title: "Глава 2. Развитие",
    children: [
      { id: "ch2-1", title: "Эпизод 2.1", children: [] },
    ],
  },
  {
    id: "ch3",
    title: "Глава 3. Кульминация",
    children: [],
  },
];

interface TreeNode {
  id: string;
  title: string;
  children: TreeNode[];
}

function TreeItem({ node, depth = 0, selected, onSelect }: {
  node: TreeNode;
  depth?: number;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = node.children.length > 0;

  if (!hasChildren) {
    return (
      <button
        onClick={() => onSelect(node.id)}
        className={cn(
          "w-full text-left px-3 py-1.5 text-sm font-body rounded-md transition-colors",
          "hover:bg-accent/50",
          selected === node.id && "bg-accent text-accent-foreground"
        )}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        {node.title}
      </button>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            "w-full flex items-center gap-1 px-3 py-1.5 text-sm font-body rounded-md transition-colors",
            "hover:bg-accent/50",
            selected === node.id && "bg-accent text-accent-foreground"
          )}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => onSelect(node.id)}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{node.title}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {node.children.map((child) => (
          <TreeItem
            key={child.id}
            node={child}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

// Mock tracks for the timeline
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
        <div
          key={t}
          className="absolute bottom-0 flex flex-col items-center"
          style={{ left: `${t * zoom * 4}px` }}
        >
          <span className="text-[10px] text-muted-foreground font-body mb-0.5">{formatTime(t)}</span>
          <div className="w-px h-2 bg-border" />
        </div>
      ))}
    </div>
  );
}

function TimelineTrack({ track, zoom, duration }: {
  track: typeof MOCK_TRACKS[0];
  zoom: number;
  duration: number;
}) {
  // Mock clips
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

const Studio = () => {
  const [selectedNode, setSelectedNode] = useState("ch1");
  const [zoom, setZoom] = useState(1);
  const duration = 180; // 3 min mock

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 flex flex-col h-full"
    >
      {/* Header */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <h1 className="font-display text-2xl font-bold text-foreground">Студия</h1>
        <p className="text-sm text-muted-foreground font-body">Рабочая панель</p>
      </div>

      {/* Vertical split: top workspace + bottom timeline */}
      <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0">
        {/* TOP: Two-column workspace */}
        <ResizablePanel defaultSize={55} minSize={30}>
          <ResizablePanelGroup direction="horizontal" className="h-full">
            {/* Left: Book navigation */}
            <ResizablePanel defaultSize={30} minSize={15} maxSize={50}>
              <div className="h-full flex flex-col border-r border-border">
                <div className="px-4 py-3 border-b border-border shrink-0">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-body">
                    Структура книги
                  </span>
                </div>
                <ScrollArea className="flex-1">
                  <div className="py-2 px-1 space-y-0.5">
                    {bookStructure.map((node) => (
                      <TreeItem
                        key={node.id}
                        node={node}
                        selected={selectedNode}
                        onSelect={setSelectedNode}
                      />
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right: Tabs workspace */}
            <ResizablePanel defaultSize={70}>
              <div className="h-full flex flex-col p-4">
                <Tabs defaultValue="narrators" className="flex-1 flex flex-col min-h-0">
                  <TabsList className="w-fit shrink-0">
                    <TabsTrigger value="narrators" className="gap-1.5">
                      <Mic2 className="h-3.5 w-3.5" />
                      <span className="font-body text-sm">Дикторы</span>
                    </TabsTrigger>
                    <TabsTrigger value="atmosphere" className="gap-1.5">
                      <Wind className="h-3.5 w-3.5" />
                      <span className="font-body text-sm">Атмосфера</span>
                    </TabsTrigger>
                    <TabsTrigger value="sounds" className="gap-1.5">
                      <Volume2 className="h-3.5 w-3.5" />
                      <span className="font-body text-sm">Звуки</span>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="narrators" className="flex-1 mt-4">
                    <div className="rounded-lg border border-border bg-card/50 h-full flex items-center justify-center">
                      <p className="text-sm text-muted-foreground font-body">
                        Управление дикторами для выбранного раздела
                      </p>
                    </div>
                  </TabsContent>

                  <TabsContent value="atmosphere" className="flex-1 mt-4">
                    <div className="rounded-lg border border-border bg-card/50 h-full flex items-center justify-center">
                      <p className="text-sm text-muted-foreground font-body">
                        Фоновая атмосфера и эмбиент
                      </p>
                    </div>
                  </TabsContent>

                  <TabsContent value="sounds" className="flex-1 mt-4">
                    <div className="rounded-lg border border-border bg-card/50 h-full flex items-center justify-center">
                      <p className="text-sm text-muted-foreground font-body">
                        Конкретные звуковые эффекты
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* BOTTOM: Multitrack Timeline */}
        <ResizablePanel defaultSize={45} minSize={20}>
          <div className="h-full flex flex-col bg-background">
            {/* Timeline toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-body">
                Таймлайн
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground font-body w-10 text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <div className="w-px h-4 bg-border mx-1" />
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Timeline body */}
            <div className="flex-1 flex min-h-0">
              {/* Track labels */}
              <div className="w-28 shrink-0 border-r border-border flex flex-col">
                <div className="h-6 border-b border-border" />
                {MOCK_TRACKS.map((track) => (
                  <div
                    key={track.id}
                    className="h-10 flex items-center px-3 border-b border-border/50"
                  >
                    <div
                      className="w-2 h-2 rounded-full shrink-0 mr-2"
                      style={{ backgroundColor: track.color }}
                    />
                    <span className="text-xs text-muted-foreground font-body truncate">
                      {track.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Scrollable timeline area */}
              <ScrollArea className="flex-1">
                <div className="min-w-full">
                  <TimelineRuler zoom={zoom} duration={duration} />
                  {MOCK_TRACKS.map((track) => (
                    <TimelineTrack
                      key={track.id}
                      track={track}
                      zoom={zoom}
                      duration={duration}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </motion.div>
  );
};

export default Studio;
