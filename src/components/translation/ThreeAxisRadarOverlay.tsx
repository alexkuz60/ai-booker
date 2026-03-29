import type { RadarScores } from "@/lib/qualityRadar";

const THREE_R_COLORS = {
  stroke: "hsl(210, 80%, 60%)",
  fill: "hsl(210, 80%, 60%)",
};

const AXIS_INDEX: Record<"semantic" | "rhythm" | "phonetic", number> = {
  semantic: 0,
  rhythm: 2,
  phonetic: 3,
};

const TRIANGLE_AXES: Array<keyof typeof AXIS_INDEX> = ["semantic", "rhythm", "phonetic"];
const CENTER = 50;
const OUTER_RADIUS = 42.5;

function toPolarPoint(axisIndex: number, value: number) {
  const angle = ((-90 + axisIndex * 72) * Math.PI) / 180;
  const radius = OUTER_RADIUS * Math.max(0, Math.min(1, value));

  return {
    x: CENTER + Math.cos(angle) * radius,
    y: CENTER + Math.sin(angle) * radius,
  };
}

interface ThreeAxisRadarOverlayProps {
  scores: RadarScores | null | undefined;
}

export function ThreeAxisRadarOverlay({ scores }: ThreeAxisRadarOverlayProps) {
  if (!scores) return null;

  const vertices = TRIANGLE_AXES
    .map((axis) => {
      const point = toPolarPoint(AXIS_INDEX[axis], scores[axis]);
      return `${point.x},${point.y}`;
    })
    .join(" ");

  const hasVisibleShape = TRIANGLE_AXES.some((axis) => scores[axis] > 0);
  if (!hasVisibleShape) return null;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      viewBox="0 0 100 100"
    >
      <polygon
        fill={THREE_R_COLORS.fill}
        fillOpacity={0.12}
        points={vertices}
        stroke={THREE_R_COLORS.stroke}
        strokeDasharray="4 3"
        strokeWidth={0.7}
      />
      {TRIANGLE_AXES.map((axis) => {
        const point = toPolarPoint(AXIS_INDEX[axis], scores[axis]);
        return (
          <circle
            key={axis}
            cx={point.x}
            cy={point.y}
            fill={THREE_R_COLORS.stroke}
            r={1}
          />
        );
      })}
    </svg>
  );
}