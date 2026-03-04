import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ChevronUp, ChevronDown, Plus, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

// ─── Track data ─────────────────────────────────────────────
const MOCK_TRACKS = [
  { id: "narrator-1", label: "Диктор 1", color: "hsl(var(--primary))", type: "narrator" },
  { id: "narrator-2", label: "Диктор 2", color: "hsl(var(--accent))", type: "narrator" },
  { id: "ambience", label: "Атмосфера", color: "hsl(175 45% 45%)", type: "atmosphere" },
  { id: "sfx", label: "SFX", color: "hsl(220 50% 55%)", type: "sfx" },
];

const TRACK_LABELS_WIDTH = 112; // w-28 = 7rem = 112px

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

function TimelineTrack({ track, zoom, duration }: { track: typeof MOCK_TRACKS[0]; zoom: number; duration: number }) {
  const clips = track.id === "narrator-1"
    ? [{ start: 0, end: Math.min(45, duration) }, { start: Math.min(50, duration), end: Math.min(120, duration) }]
    : track.id === "narrator-2"
    ? [{ start: Math.min(48, duration), end: Math.min(80, duration) }]
    : track.id === "ambience"
    ? [{ start: 0, end: duration }]
    : [{ start: Math.min(20, duration), end: Math.min(25, duration) }, { start: Math.min(60, duration), end: Math.min(63, duration) }, { start: Math.min(100, duration), end: Math.min(104, duration) }];

  return (
    <div className="flex h-10 border-b border-border/50 relative" style={{ width: `${duration * zoom * 4}px` }}>
      {clips.filter(c => c.start < c.end).map((clip, i) => (
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

// ─── Constants ──────────────────────────────────────────────
export const TIMELINE_HEADER_HEIGHT = 41;

// ─── Main component ─────────────────────────────────────────

interface StudioTimelineProps {
  isRu: boolean;
  /** Estimated chapter duration in seconds; falls back to 180 */
  durationSec?: number;
}

export function StudioTimeline({ isRu, durationSec }: StudioTimelineProps) {
  const duration = durationSec && durationSec > 0 ? durationSec : 180;
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Measure available width for tracks area
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

  // Fit-to-width zoom: availableWidth = duration * fitZoom * 4
  const fitZoom = useMemo(() => {
    if (containerWidth <= 0 || duration <= 0) return 1;
    return containerWidth / (duration * 4);
  }, [containerWidth, duration]);

  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const zoom = zoomOverride ?? fitZoom;

  // Reset to fit when duration or container changes
  useEffect(() => {
    setZoomOverride(null);
  }, [fitZoom]);

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
    } catch {
      return 250;
    }
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
  );
}
