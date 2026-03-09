import type { TimelineClip } from "@/hooks/useTimelineClips";
import type { TimelineTrackData } from "./StudioTimeline";

interface TimelineTrackProps {
  track: TimelineTrackData;
  zoom: number;
  duration: number;
  clips?: TimelineClip[];
  selectedSegmentId?: string | null;
  onSelectSegment?: (segmentId: string | null) => void;
  synthesizingSegmentIds?: Set<string>;
}

const DEFAULT_FADE_IN = 0.15;
const DEFAULT_FADE_OUT = 0.25;

/** SVG triangle overlay for fade-in (left) or fade-out (right) */
function FadeOverlay({
  side,
  fadeSec,
  clipWidthPx,
  trackColor,
}: {
  side: "in" | "out";
  fadeSec: number;
  clipWidthPx: number;
  trackColor: string;
}) {
  if (fadeSec <= 0) return null;
  // Cap the visual width to half the clip
  const maxPx = clipWidthPx / 2;
  // We need zoom*4 factor but we receive clipWidthPx already scaled
  // fadeSec is already in real seconds, clipWidthPx = durationSec * zoom * 4
  // So fadePx = (fadeSec / durationSec) * clipWidthPx — but we don't have durationSec here
  // We'll compute from the ratio: caller passes fadeSec and we estimate px
  // Actually easier: the parent knows zoom, so let's just receive fadePx
  // Redesign: receive fadePx directly from parent
  const fadePx = Math.min(fadeSec, maxPx);
  if (fadePx < 2) return null;

  return (
    <svg
      className="absolute top-0 bottom-0 pointer-events-none"
      style={{
        [side === "in" ? "left" : "right"]: 0,
        width: `${fadePx}px`,
        height: "100%",
      }}
      preserveAspectRatio="none"
      viewBox={`0 0 ${fadePx} 100`}
    >
      <polygon
        points={
          side === "in"
            ? `0,0 ${fadePx},0 0,100`
            : `${fadePx},0 0,0 ${fadePx},100`
        }
        fill="rgba(0,0,0,0.35)"
      />
      <line
        x1={side === "in" ? 0 : fadePx}
        y1={0}
        x2={side === "in" ? fadePx : 0}
        y2={100}
        stroke={trackColor}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        opacity={0.7}
      />
    </svg>
  );
}

export function TimelineTrack({
  track,
  zoom,
  duration,
  clips: realClips,
  selectedSegmentId,
  onSelectSegment,
  synthesizingSegmentIds,
}: TimelineTrackProps) {
  const showFades = zoom >= 2; // 200%+

  const clips = realClips && realClips.length > 0
    ? realClips.map(c => ({
        id: c.id,
        start: c.startSec,
        end: c.startSec + c.durationSec,
        durationSec: c.durationSec,
        label: c.label,
        type: c.segmentType,
        hasAudio: c.hasAudio,
        fadeInSec: c.fadeInSec ?? DEFAULT_FADE_IN,
        fadeOutSec: c.fadeOutSec ?? DEFAULT_FADE_OUT,
      }))
    : track.type === "atmosphere"
      ? [{ id: "atm", start: 0, end: duration, durationSec: duration, label: track.label, type: "atmosphere", hasAudio: false, fadeInSec: 0, fadeOutSec: 0 }]
      : track.type === "sfx"
        ? []
        : [];

  return (
    <div className="flex h-10 border-b border-border/50 relative" style={{ width: `${duration * zoom * 4}px` }}>
      {clips.filter(c => c.start < c.end).map((clip, i) => {
        const widthPx = (clip.end - clip.start) * zoom * 4;
        const isSelected = selectedSegmentId && clip.id === selectedSegmentId;
        const isSynthesizing = synthesizingSegmentIds?.has(clip.id);

        // Fade visual widths in pixels
        const fadeInPx = showFades && clip.hasAudio ? Math.min(clip.fadeInSec * zoom * 4, widthPx / 2) : 0;
        const fadeOutPx = showFades && clip.hasAudio ? Math.min(clip.fadeOutSec * zoom * 4, widthPx / 2) : 0;

        return (
          <div
            key={i}
            className={`absolute top-1 bottom-1 rounded-sm transition-all cursor-pointer overflow-hidden ${
              clip.hasAudio ? "opacity-90 hover:opacity-100" : "opacity-50 hover:opacity-70"
            } ${isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-background opacity-100 z-10" : ""} ${isSynthesizing ? "synth-oscilloscope" : ""}`}
            style={{
              left: `${clip.start * zoom * 4}px`,
              width: `${widthPx}px`,
              backgroundColor: track.color,
              backgroundImage: isSynthesizing
                ? undefined
                : clip.hasAudio
                  ? undefined
                  : "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.08) 3px, rgba(255,255,255,0.08) 6px)",
            }}
            title={`${clip.label} (${(clip.end - clip.start).toFixed(1)}s)${clip.hasAudio ? " 🔊" : ""}${isSynthesizing ? " ⏳" : ""}${showFades && clip.hasAudio ? ` | fade ${clip.fadeInSec.toFixed(2)}s / ${clip.fadeOutSec.toFixed(2)}s` : ""}`}
            onDoubleClick={() => onSelectSegment?.(clip.id)}
          >
            {/* Fade overlays (only at high zoom and only for clips with audio) */}
            {fadeInPx >= 2 && (
              <FadeOverlay side="in" fadeSec={fadeInPx} clipWidthPx={widthPx} trackColor={track.color} />
            )}
            {fadeOutPx >= 2 && (
              <FadeOverlay side="out" fadeSec={fadeOutPx} clipWidthPx={widthPx} trackColor={track.color} />
            )}

            {widthPx > 40 && (
              <span className="text-[9px] text-primary-foreground px-1.5 truncate block mt-0.5 font-body relative z-[1]">
                {isSynthesizing ? "⏳ " : clip.hasAudio ? "🔊 " : ""}{clip.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
