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

export function TimelineTrack({
  track,
  zoom,
  duration,
  clips: realClips,
  selectedSegmentId,
  onSelectSegment,
  synthesizingSegmentIds,
}: TimelineTrackProps) {
  const clips = realClips && realClips.length > 0
    ? realClips.map(c => ({
        id: c.id,
        start: c.startSec,
        end: c.startSec + c.durationSec,
        label: c.label,
        type: c.segmentType,
        hasAudio: c.hasAudio,
      }))
    : track.type === "atmosphere"
      ? [{ id: "atm", start: 0, end: duration, label: track.label, type: "atmosphere", hasAudio: false }]
      : track.type === "sfx"
        ? []
        : [];

  return (
    <div className="flex h-10 border-b border-border/50 relative" style={{ width: `${duration * zoom * 4}px` }}>
      {clips.filter(c => c.start < c.end).map((clip, i) => {
        const widthPx = (clip.end - clip.start) * zoom * 4;
        const isSelected = selectedSegmentId && clip.id === selectedSegmentId;
        const isSynthesizing = synthesizingSegmentIds?.has(clip.id);
        return (
          <div
            key={i}
            className={`absolute top-1 bottom-1 rounded-sm transition-all cursor-pointer ${
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
            title={`${clip.label} (${(clip.end - clip.start).toFixed(1)}s)${clip.hasAudio ? " 🔊" : ""}${isSynthesizing ? " ⏳" : ""}`}
            onDoubleClick={() => onSelectSegment?.(clip.id)}
          >
            {widthPx > 40 && (
              <span className="text-[9px] text-primary-foreground px-1.5 truncate block mt-0.5 font-body">
                {isSynthesizing ? "⏳ " : clip.hasAudio ? "🔊 " : ""}{clip.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
