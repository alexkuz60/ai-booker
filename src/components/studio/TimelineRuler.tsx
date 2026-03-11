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
}

export function TimelineRuler({ zoom, duration, sceneBoundaries, renderPercent, isRendering }: TimelineRulerProps) {
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
        />
      )}
    </div>
  );
}
