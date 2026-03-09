import { SCENE_SILENCE_SEC } from "@/hooks/useTimelineClips";

interface TimelineRulerProps {
  zoom: number;
  duration: number;
  /** Scene boundary offsets in seconds where a 2s silence gap starts */
  sceneBoundaries?: number[];
}

export function TimelineRuler({ zoom, duration, sceneBoundaries }: TimelineRulerProps) {
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
      {/* Scene silence gap markers */}
      {sceneBoundaries?.map((startSec) => {
        const silenceWidthPx = SCENE_SILENCE_SEC * zoom * 4;
        return (
          <div
            key={`silence-${startSec}`}
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `${startSec * zoom * 4}px`,
              width: `${silenceWidthPx}px`,
              background: "repeating-linear-gradient(90deg, hsl(var(--muted-foreground)/0.10) 0px, hsl(var(--muted-foreground)/0.10) 2px, transparent 2px, transparent 6px)",
              borderLeft: "1px solid hsl(var(--muted-foreground)/0.35)",
            }}
            title={`Тишина ${SCENE_SILENCE_SEC}s`}
          />
        );
      })}
      {/* Time marks */}
      {marks.map((t) => (
        <div key={t} className="absolute bottom-0 flex flex-col items-center" style={{ left: `${t * zoom * 4}px` }}>
          <span className="text-[10px] text-muted-foreground font-body mb-0.5">{formatTime(t)}</span>
          <div className="w-px h-2 bg-border" />
        </div>
      ))}
    </div>
  );
}
