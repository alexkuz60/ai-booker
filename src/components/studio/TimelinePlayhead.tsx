export function Playhead({ positionSec, zoom }: { positionSec: number; zoom: number }) {
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
