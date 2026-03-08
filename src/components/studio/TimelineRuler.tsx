export function TimelineRuler({ zoom, duration }: { zoom: number; duration: number }) {
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
