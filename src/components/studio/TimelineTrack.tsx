import { useState, useRef, useCallback } from "react";
import type { TimelineClip } from "@/hooks/useTimelineClips";
import type { TimelineTrackData } from "./StudioTimeline";
import type { StorageAudioFile } from "@/hooks/useStorageAudioList";
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
import { Music, Waves, Trash2, Copy, ClipboardPaste } from "lucide-react";
import { PreviewableMenuItem, stopAudioPreview } from "./PreviewableMenuItem";

interface TimelineTrackProps {
  track: TimelineTrackData;
  zoom: number;
  duration: number;
  clips?: TimelineClip[];
  selectedSegmentId?: string | null;
  onSelectSegment?: (segmentId: string | null) => void;
  checkedSegmentIds?: Set<string>;
  onToggleCheck?: (segmentId: string) => void;
  synthesizingSegmentIds?: Set<string>;
  errorSegmentIds?: Set<string>;
  onSetFade?: (clipId: string, fadeInSec: number, fadeOutSec: number) => void;
  clipFades?: Map<string, { fadeInSec: number; fadeOutSec: number }>;
  /** Available audio files for insert (atmosphere/sfx tracks) */
  storageAtmosphere?: StorageAudioFile[];
  storageSfx?: StorageAudioFile[];
  onInsertAudio?: (file: StorageAudioFile, atSec: number, layerType: "ambience" | "sfx") => void;
  onDeleteAtmoClip?: (clipId: string) => void;
  onCopyAtmoClip?: (clipId: string) => void;
  onPasteAtmoClip?: () => void;
  onMoveAtmoClip?: (clipId: string, newStartSec: number) => void;
  onResizeAtmoClip?: (clipId: string, newDurationSec: number, originalDurationMs: number, originalSpeed: number) => void;
  hasClipboard?: boolean;
  isRu?: boolean;
  trackHeight?: number;
  isSelected?: boolean;
  /** Report drag guide X position (px from track left) or null when drag ends */
  onDragGuideX?: (x: number | null) => void;
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

/** Truncate filename for display */
function displayName(name: string, maxLen = 28): string {
  const base = name.replace(/\.[^.]+$/, "");
  return base.length > maxLen ? base.slice(0, maxLen) + "…" : base;
}

export function TimelineTrack({
  track,
  zoom,
  duration,
  clips: realClips,
  selectedSegmentId,
  onSelectSegment,
  checkedSegmentIds,
  onToggleCheck,
  synthesizingSegmentIds,
  errorSegmentIds,
  onSetFade,
  clipFades,
  storageAtmosphere,
  storageSfx,
  onInsertAudio,
  onDeleteAtmoClip,
  onCopyAtmoClip,
  onPasteAtmoClip,
  onMoveAtmoClip,
  onResizeAtmoClip,
  hasClipboard,
  isRu,
  trackHeight,
  isSelected: isTrackSelected,
  onDragGuideX,
}: TimelineTrackProps) {
  const showFades = zoom >= 2; // 200%+
  const isInsertableTrack = track.type === "atmosphere" || track.type === "sfx";
  const hasInsertMenu = isInsertableTrack && onInsertAudio && ((storageAtmosphere?.length ?? 0) > 0 || (storageSfx?.length ?? 0) > 0);

  // Track right-click position to compute insert time
  const clickXRef = { current: 0 };

  // ── Drag state for atmo clips ─────────────────────────────
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [dragDeltaPx, setDragDeltaPx] = useState(0);
  // ── Optimistic offsets (sec) applied after drag until clips refresh ──
  const [optimisticOffsets, setOptimisticOffsets] = useState<Map<string, number>>(new Map());
  const prevClipsRef = useRef(realClips);
  // Clear optimistic offsets when clips data actually refreshes
  if (realClips !== prevClipsRef.current) {
    prevClipsRef.current = realClips;
    if (optimisticOffsets.size > 0) setOptimisticOffsets(new Map());
  }
  // ── Resize state for atmo clips ───────────────────────────
  const [resizingClipId, setResizingClipId] = useState<string | null>(null);
  const [resizeDeltaPx, setResizeDeltaPx] = useState(0);
  // Optimistic resize deltas (sec)
  const [optimisticResizes, setOptimisticResizes] = useState<Map<string, number>>(new Map());
  if (realClips !== prevClipsRef.current && optimisticResizes.size > 0) {
    setOptimisticResizes(new Map());
  }

  const trackRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.MouseEvent, clipId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const rc = realClips?.find(c => c.id === clipId);
    const clipStartPx = rc ? (rc.startSec + (optimisticOffsets.get(clipId) ?? 0)) * zoom * 4 : 0;
    setDraggingClipId(clipId);
    setDragDeltaPx(0);
    onDragGuideX?.(clipStartPx);

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      setDragDeltaPx(delta);
      onDragGuideX?.(clipStartPx + delta);
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const deltaSec = (ev.clientX - startX) / (zoom * 4);
      setDraggingClipId(null);
      setDragDeltaPx(0);
      onDragGuideX?.(null);
      if (Math.abs(deltaSec) > 0.1 && onMoveAtmoClip) {
        setOptimisticOffsets(prev => new Map(prev).set(clipId, deltaSec));
        const rc2 = realClips?.find(c => c.id === clipId);
        if (rc2) {
          onMoveAtmoClip(clipId, Math.max(0, rc2.startSec + deltaSec));
        }
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [zoom, onMoveAtmoClip, realClips, optimisticOffsets, onDragGuideX]);

  const handleResizeStart = useCallback((e: React.MouseEvent, clipId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    setResizingClipId(clipId);
    setResizeDeltaPx(0);

    const onMove = (ev: MouseEvent) => {
      setResizeDeltaPx(ev.clientX - startX);
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const deltaSec = (ev.clientX - startX) / (zoom * 4);
      setResizingClipId(null);
      setResizeDeltaPx(0);
      if (Math.abs(deltaSec) > 0.05 && onResizeAtmoClip) {
        const clip = clips.find(c => c.id === clipId);
        if (clip) {
          const newDuration = Math.max(0.5, clip.durationSec + deltaSec);
          setOptimisticResizes(prev => new Map(prev).set(clipId, newDuration - clip.durationSec));
          onResizeAtmoClip(clipId, newDuration, clip.originalDurationMs ?? Math.round(clip.durationSec * 1000), clip.speed ?? 1);
        }
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [zoom, onResizeAtmoClip]);

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
          loop: c.loop ?? false,
          clipLenSec: c.clipLenSec,
          speed: c.speed ?? 1,
          originalDurationMs: c.originalDurationMs,
        };
      })
    : [];

  const heightStyle = trackHeight ? `${trackHeight}px` : '2.5rem';
  const trackContent = (
    <div
      className={`flex border-b border-border/50 relative transition-colors ${isTrackSelected ? "bg-accent/20" : ""}`}
      style={{ width: `${duration * zoom * 4}px`, height: heightStyle }}
      onContextMenu={(e) => {
        if (isInsertableTrack) {
          const rect = e.currentTarget.getBoundingClientRect();
          clickXRef.current = e.clientX - rect.left;
        }
      }}
    >
      {clips.filter(c => c.start < c.end).map((clip, i) => {
        const isAtmoClip = clip.id.startsWith("atmo-");
        const isDragging = draggingClipId === clip.id;
        const isResizing = resizingClipId === clip.id;

        const optimisticOffsetSec = optimisticOffsets.get(clip.id) ?? 0;
        const optimisticResizeSec = optimisticResizes.get(clip.id) ?? 0;
        const effectiveLeftPx = (clip.start + optimisticOffsetSec) * zoom * 4 + (isDragging ? dragDeltaPx : 0);
        const effectiveWidthPx = (clip.end - clip.start + optimisticResizeSec) * zoom * 4 + (isResizing ? resizeDeltaPx : 0);
        const widthPx = Math.max(8, effectiveWidthPx);

        const isSelected = selectedSegmentId && clip.id === selectedSegmentId;
        const isChecked = checkedSegmentIds?.has(clip.id);
        const isSynthesizing = synthesizingSegmentIds?.has(clip.id);
        const isError = errorSegmentIds?.has(clip.id);

        // Fade visual widths in pixels
        const fadeInPx = showFades && clip.fadeInSec > 0 ? Math.min(clip.fadeInSec * zoom * 4, widthPx / 2) : 0;
        const fadeOutPx = showFades && clip.fadeOutSec > 0 ? Math.min(clip.fadeOutSec * zoom * 4, widthPx / 2) : 0;

        const hasFades = clip.fadeInSec > 0 || clip.fadeOutSec > 0;

        const clipElement = (
          <div
            className={`absolute top-1 bottom-1 rounded-sm transition-none cursor-pointer overflow-hidden ${
              isError
                ? "opacity-90 hover:opacity-100 ring-2 ring-destructive ring-offset-1 ring-offset-background"
                : clip.hasAudio ? "opacity-90 hover:opacity-100" : "opacity-60 hover:opacity-80"
            } ${isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-background opacity-100 z-10" : ""} ${isChecked && !isSelected ? "ring-2 ring-accent-foreground/50 ring-offset-1 ring-offset-background opacity-100" : ""} ${isSynthesizing ? "synth-oscilloscope" : ""} ${isDragging || isResizing ? "z-30 shadow-lg ring-2 ring-primary/50" : ""}`}
            style={{
              left: `${Math.max(0, effectiveLeftPx)}px`,
              width: `${widthPx}px`,
              backgroundColor: isError ? "hsl(var(--destructive))" : track.color,
              backgroundImage: isSynthesizing
                ? undefined
                : isError
                  ? "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.15) 3px, rgba(255,255,255,0.15) 6px)"
                  : clip.hasAudio
                    ? undefined
                    : "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(255,255,255,0.08) 3px, rgba(255,255,255,0.08) 6px)",
            }}
            title={`${clip.label} (${(clip.end - clip.start).toFixed(1)}s)${clip.speed !== 1 ? ` ×${clip.speed.toFixed(2)}` : ""}${clip.loop && clip.clipLenSec ? ` loop×${Math.ceil(clip.durationSec / clip.clipLenSec)}` : ""}${isError ? " ❌ Ошибка синтеза" : clip.hasAudio ? " 🔊" : ""}${isSynthesizing ? " ⏳" : ""}${hasFades ? ` | fade ${clip.fadeInSec.toFixed(2)}s / ${clip.fadeOutSec.toFixed(2)}s` : ""}`}
            onClick={() => onToggleCheck?.(clip.id)}
            onDoubleClick={() => onSelectSegment?.(clip.id)}
            onMouseDown={(e) => {
              // Only allow drag on atmo clips with left button, not on resize handle
              if (!isAtmoClip || e.button !== 0 || !onMoveAtmoClip) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const rightEdge = rect.right - 6;
              if (e.clientX >= rightEdge && onResizeAtmoClip) return; // resize zone
              handleDragStart(e, clip.id);
            }}
          >
            {/* Loop iteration markers */}
            {clip.loop && clip.clipLenSec && clip.clipLenSec > 0 && (() => {
              const iterPx = clip.clipLenSec * zoom * 4;
              const markers: JSX.Element[] = [];
              for (let m = iterPx; m < widthPx - 2; m += iterPx) {
                markers.push(
                  <div
                    key={m}
                    className="absolute top-0 bottom-0 w-px"
                    style={{ left: `${m}px`, borderLeft: "1px dashed rgba(255,255,255,0.35)" }}
                  />
                );
              }
              return markers;
            })()}

            {/* Fade overlays (only at high zoom and only for clips with fades) */}
            {fadeInPx >= 2 && (
              <FadeOverlay side="in" fadePx={fadeInPx} trackColor={track.color} />
            )}
            {fadeOutPx >= 2 && (
              <FadeOverlay side="out" fadePx={fadeOutPx} trackColor={track.color} />
            )}

            {widthPx > 40 && (
              <span className="text-[9px] text-primary-foreground px-1.5 truncate block mt-0.5 font-body relative z-[1]">
                {isError ? "❌ " : isSynthesizing ? "⏳ " : clip.hasAudio ? "🔊 " : ""}{clip.label}
              </span>
            )}

            {/* Resize handle on right edge for atmo clips */}
            {isAtmoClip && onResizeAtmoClip && (
              <div
                className="absolute top-0 bottom-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/30 z-[2]"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  handleResizeStart(e, clip.id);
                }}
              />
            )}
          </div>
        );

        // Atmosphere/SFX clips — context menu with delete/copy/paste
        if (isAtmoClip && onDeleteAtmoClip) {
          return (
            <ContextMenu key={i}>
              <ContextMenuTrigger asChild>
                {clipElement}
              </ContextMenuTrigger>
              <ContextMenuContent className="w-52">
                <ContextMenuLabel className="text-xs truncate">{clip.label}</ContextMenuLabel>
                <ContextMenuSeparator />
                {onCopyAtmoClip && (
                  <ContextMenuItem onClick={() => onCopyAtmoClip(clip.id)}>
                    <Copy className="h-3.5 w-3.5 mr-2" />
                    {isRu ? "Копировать" : "Copy"} <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+C</span>
                  </ContextMenuItem>
                )}
                {onPasteAtmoClip && hasClipboard && (
                  <ContextMenuItem onClick={() => onPasteAtmoClip()}>
                    <ClipboardPaste className="h-3.5 w-3.5 mr-2" />
                    {isRu ? "Вставить" : "Paste"} <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+V</span>
                  </ContextMenuItem>
                )}
                {(onCopyAtmoClip || (onPasteAtmoClip && hasClipboard)) && <ContextMenuSeparator />}
                {onSetFade && (
                  <>
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
                    <ContextMenuSeparator />
                  </>
                )}
                <ContextMenuItem
                  onClick={() => onDeleteAtmoClip(clip.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  {isRu ? "Удалить" : "Delete"}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        }

        // Voice clips with audio — context menu with fades
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

  // Wrap the whole track with a context menu for atmosphere/sfx tracks
  if (hasInsertMenu) {
    const atmoFiles = storageAtmosphere ?? [];
    const sfxFiles = storageSfx ?? [];
    const getInsertSec = () => Math.max(0, clickXRef.current / (zoom * 4));

    return (
      <ContextMenu onOpenChange={(open) => { if (!open) stopAudioPreview(); }}>
        <ContextMenuTrigger asChild>
          {trackContent}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel className="text-xs">
            {isRu ? "Вставить аудио" : "Insert audio"}
          </ContextMenuLabel>
          <ContextMenuSeparator />

          {atmoFiles.length > 0 && (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Waves className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                {isRu ? "Атмосфера" : "Atmosphere"}
                <span className="ml-auto text-[10px] text-muted-foreground">{atmoFiles.length}</span>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-64 overflow-y-auto w-56">
                {atmoFiles.map(f => (
                  <PreviewableMenuItem
                    key={f.path}
                    file={f}
                    icon={<Waves className="h-3 w-3 mr-2 shrink-0 text-muted-foreground" />}
                    onSelect={() => onInsertAudio!(f, getInsertSec(), "ambience")}
                  />
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}

          {sfxFiles.length > 0 && (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Music className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                {isRu ? "Эффекты" : "SFX"}
                <span className="ml-auto text-[10px] text-muted-foreground">{sfxFiles.length}</span>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-64 overflow-y-auto w-56">
                {sfxFiles.map(f => (
                  <PreviewableMenuItem
                    key={f.path}
                    file={f}
                    icon={<Music className="h-3 w-3 mr-2 shrink-0 text-muted-foreground" />}
                    onSelect={() => onInsertAudio!(f, getInsertSec(), "sfx")}
                  />
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}

          {atmoFiles.length === 0 && sfxFiles.length === 0 && (
            <ContextMenuItem disabled className="text-xs text-muted-foreground">
              {isRu ? "Нет доступных файлов" : "No files available"}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return trackContent;
}
