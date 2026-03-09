import type { TimelineClip } from "@/hooks/useTimelineClips";
import type { TimelineTrackData } from "./StudioTimeline";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  ContextMenuSeparator,
  ContextMenuLabel,
} from "@/components/ui/context-menu";

interface TimelineTrackProps {
  track: TimelineTrackData;
  zoom: number;
  duration: number;
  clips?: TimelineClip[];
  selectedSegmentId?: string | null;
  onSelectSegment?: (segmentId: string | null) => void;
  synthesizingSegmentIds?: Set<string>;
  onSetFade?: (clipId: string, fadeInSec: number, fadeOutSec: number) => void;
  clipFades?: Map<string, { fadeInSec: number; fadeOutSec: number }>;
}

const FADE_OPTIONS = [
  { label: "Нет", value: 0 },
  { label: "0.1 сек", value: 0.1 },
  { label: "0.25 сек", value: 0.25 },
  { label: "0.5 сек", value: 0.5 },
  { label: "1 сек", value: 1 },
  { label: "2 сек", value: 2 },
];

/** SVG triangle overlay for fade-in (left) or fade-out (right) */
function FadeOverlay({
  side,
  fadePx,
  trackColor,
}: {
  side: "in" | "out";
  fadePx: number;
  trackColor: string;
}) {
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
  onSetFade,
  clipFades,
}: TimelineTrackProps) {
  const showFades = zoom >= 2; // 200%+

  const clips = realClips && realClips.length > 0
    ? realClips.map(c => {
        const fades = clipFades?.get(c.id);
        return {
          id: c.id,
          start: c.startSec,
          end: c.startSec + c.durationSec,
          durationSec: c.durationSec,
          label: c.label,
          type: c.segmentType,
          hasAudio: c.hasAudio,
          fadeInSec: fades?.fadeInSec ?? c.fadeInSec ?? 0,
          fadeOutSec: fades?.fadeOutSec ?? c.fadeOutSec ?? 0,
        };
      })
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
        const fadeInPx = showFades && clip.fadeInSec > 0 ? Math.min(clip.fadeInSec * zoom * 4, widthPx / 2) : 0;
        const fadeOutPx = showFades && clip.fadeOutSec > 0 ? Math.min(clip.fadeOutSec * zoom * 4, widthPx / 2) : 0;

        const hasFades = clip.fadeInSec > 0 || clip.fadeOutSec > 0;

        const clipElement = (
          <div
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
            title={`${clip.label} (${(clip.end - clip.start).toFixed(1)}s)${clip.hasAudio ? " 🔊" : ""}${isSynthesizing ? " ⏳" : ""}${hasFades ? ` | fade ${clip.fadeInSec.toFixed(2)}s / ${clip.fadeOutSec.toFixed(2)}s` : ""}`}
            onDoubleClick={() => onSelectSegment?.(clip.id)}
          >
            {/* Fade overlays (only at high zoom and only for clips with fades) */}
            {fadeInPx >= 2 && (
              <FadeOverlay side="in" fadePx={fadeInPx} trackColor={track.color} />
            )}
            {fadeOutPx >= 2 && (
              <FadeOverlay side="out" fadePx={fadeOutPx} trackColor={track.color} />
            )}

            {widthPx > 40 && (
              <span className="text-[9px] text-primary-foreground px-1.5 truncate block mt-0.5 font-body relative z-[1]">
                {isSynthesizing ? "⏳ " : clip.hasAudio ? "🔊 " : ""}{clip.label}
              </span>
            )}
          </div>
        );

        // Only wrap audio clips with context menu
        if (clip.hasAudio && onSetFade) {
          return (
            <ContextMenu key={i}>
              <ContextMenuTrigger asChild>
                {clipElement}
              </ContextMenuTrigger>
              <ContextMenuContent className="w-52">
                <ContextMenuLabel className="text-xs truncate">{clip.label}</ContextMenuLabel>
                <ContextMenuSeparator />
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    🔺 Fade In {clip.fadeInSec > 0 ? `(${clip.fadeInSec}s)` : ""}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {FADE_OPTIONS.map(opt => (
                      <ContextMenuItem
                        key={opt.value}
                        onClick={() => onSetFade(clip.id, opt.value, clip.fadeOutSec)}
                        className={clip.fadeInSec === opt.value ? "bg-accent" : ""}
                      >
                        {opt.label}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    🔻 Fade Out {clip.fadeOutSec > 0 ? `(${clip.fadeOutSec}s)` : ""}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {FADE_OPTIONS.map(opt => (
                      <ContextMenuItem
                        key={opt.value}
                        onClick={() => onSetFade(clip.id, clip.fadeInSec, opt.value)}
                        className={clip.fadeOutSec === opt.value ? "bg-accent" : ""}
                      >
                        {opt.label}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </ContextMenuContent>
            </ContextMenu>
          );
        }

        return <div key={i}>{clipElement}</div>;
      })}
    </div>
  );
}
