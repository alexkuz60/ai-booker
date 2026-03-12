import { SCENE_SILENCE_SEC, type SceneBoundary } from "@/hooks/useTimelineClips";

interface TimelineRulerProps {
  zoom: number;
  duration: number;
  /** Scene boundaries with start offset and silence duration */
  sceneBoundaries?: SceneBoundary[];
  /** Render progress 0–100, null = no render exists */
  renderPercent?: number | null;
  /** Whether rendering is actively in progress */
  isRendering?: boolean;
  /** Load progress 0–100, null = not loading */
  loadPercent?: number | null;
  /** Whether loading is actively in progress */
  isLoading?: boolean;
  /** Label of currently loading item */
  loadLabel?: string;
}

export function TimelineRuler({ zoom, duration, sceneBoundaries, renderPercent, isRendering, loadPercent, isLoading, loadLabel }: TimelineRulerProps) {
  const marks: number[] = [];
  const step = Math.max(1, Math.round(10 / zoom));
  for (let t = 0; t <= duration; t += step) marks.push(t);
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const totalWidthPx = duration * zoom * 4;
  const progressWidthPx = renderPercent != null && renderPercent > 0
    ? (renderPercent / 100) * totalWidthPx
    : 0;
  const loadWidthPx = loadPercent != null && loadPercent > 0
    ? (loadPercent / 100) * totalWidthPx
    : 0;

  return (
    <div className="flex items-end h-6 border-b border-border relative" style={{ width: `${totalWidthPx}px` }}>
      {/* Scene silence gap markers */}
      {sceneBoundaries?.map((boundary) => {
        const silenceDuration = boundary.silenceSec ?? SCENE_SILENCE_SEC;
        const silenceWidthPx = silenceDuration * zoom * 4;
        return (
          <div
            key={`silence-${boundary.startSec}`}
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `${boundary.startSec * zoom * 4}px`,
              width: `${silenceWidthPx}px`,
              background: "hsl(var(--primary) / 0.25)",
              borderLeft: "2px solid hsl(var(--primary) / 0.5)",
              borderRight: "1px dashed hsl(var(--primary) / 0.3)",
            }}
            title={`Тишина ${silenceDuration}s`}
          />
        );
      })}
      {/* Time marks */}
      {marks.map((t) => (
        <div
          key={t}
          className={`absolute bottom-0 flex flex-col ${t === 0 ? "items-start" : "items-center -translate-x-1/2"}`}
          style={{ left: `${t * zoom * 4}px` }}
        >
          <span className={`text-[10px] text-muted-foreground font-body mb-0.5 ${t === 0 ? "pl-1" : ""}`}>{formatTime(t)}</span>
          <div className={`w-px h-2 bg-border ${t === 0 ? "self-start" : ""}`} />
        </div>
      ))}
      {/* Render progress line */}
      {progressWidthPx > 0 && (
        <div
          className="absolute bottom-0 left-0 h-[2px] pointer-events-none z-10 transition-[width] duration-300"
          style={{
            width: `${progressWidthPx}px`,
            background: renderPercent === 100
              ? "hsl(var(--primary))"
              : "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))",
          }}
        >
          {/* Pulse dot at the leading edge during active rendering */}
          {isRendering && renderPercent !== null && renderPercent < 100 && (
            <div
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2"
            >
              <div
                className="w-2 h-2 rounded-full bg-accent"
                style={{ boxShadow: "0 0 6px 2px hsl(var(--accent) / 0.6)" }}
              />
              <div
                className="absolute inset-0 w-2 h-2 rounded-full bg-accent/50 animate-ping"
              />
            </div>
          )}
        </div>
      )}
      {/* Load progress line (montage stem loading) */}
      {loadWidthPx > 0 && (
        <div
          className="absolute bottom-0 left-0 h-[2px] pointer-events-none z-10 transition-[width] duration-300"
          style={{
            width: `${loadWidthPx}px`,
            background: loadPercent === 100
              ? "hsl(var(--primary))"
              : "linear-gradient(90deg, hsl(50 80% 50%), hsl(140 70% 50%))",
          }}
        >
          {isLoading && loadPercent !== null && loadPercent < 100 && (
            <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: "hsl(50 80% 50%)", boxShadow: "0 0 6px 2px hsl(50 80% 50% / 0.6)" }}
              />
              <div
                className="absolute inset-0 w-2 h-2 rounded-full animate-ping"
                style={{ backgroundColor: "hsl(50 80% 50% / 0.5)" }}
              />
              {/* Current label tooltip */}
              {loadLabel && (
                <div className="absolute bottom-3 right-0 translate-x-1/2 whitespace-nowrap bg-background/90 border border-border rounded px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground shadow-sm">
                  {loadLabel}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
