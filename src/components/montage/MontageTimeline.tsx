import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import { ZoomIn, ZoomOut, Maximize2, Play, Pause, Square, Volume2, VolumeX, ChevronUp, ChevronDown, RotateCcw, Loader2, RefreshCw, AlertTriangle, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTimelinePlayer } from "@/hooks/useTimelinePlayer";
import { resetAudioEngine } from "@/lib/audioEngine";
import { useMixerPersistence } from "@/hooks/useMixerPersistence";
import { TimelineMasterMeter } from "@/components/studio/TimelineMasterMeter";
import { TimelineRuler } from "@/components/studio/TimelineRuler";
import { Playhead } from "@/components/studio/TimelinePlayhead";
import { TrackMixerStrip } from "@/components/studio/TrackMixerStrip";
import { STEM_TRACKS } from "@/hooks/useMontageData";
import type { TimelineClip, SceneBoundary } from "@/hooks/useTimelineClips";

const MIXER_SIDEBAR = 160;

const MONTAGE_ZOOM_PRESETS = [95, 100, 200, 300, 400, 500] as const;

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

interface MontageTimelineProps {
  clips: TimelineClip[];
  sceneBoundaries: SceneBoundary[];
  totalDurationSec: number;
  chapterId: string | null;
  isRu: boolean;
  onSplitAtScene?: (sceneId: string) => void;
  hasParts?: boolean;
}

export function MontageTimeline({ clips, sceneBoundaries, totalDurationSec, chapterId, isRu, onSplitAtScene, hasParts }: MontageTimelineProps) {
  const player = useTimelinePlayer(clips);
  const duration = player.totalDuration > 0 ? player.totalDuration : totalDurationSec;

  const trackIds = useMemo(() => STEM_TRACKS.map(t => t.id), []);
  const { scheduleSave: onMixChange } = useMixerPersistence(chapterId, trackIds);

  const [timelineHeight, setTimelineHeight] = useState(300);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);

  // ── Zoom ────────────────────────────────────────────────────
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = tracksContainerRef.current;
    if (!el) { setContainerWidth(0); return; }
    const measure = () => setContainerWidth(el.clientWidth - MIXER_SIDEBAR);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [timelineCollapsed]);

  const fitZoom = useMemo(() => {
    if (containerWidth <= 0 || duration <= 0) return 1;
    return containerWidth / (duration * 4);
  }, [containerWidth, duration]);

  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const zoom = zoomOverride ?? fitZoom;
  useEffect(() => { setZoomOverride(null); }, [fitZoom]);

  const toPercent = useCallback((z: number) => fitZoom > 0 ? (z / fitZoom) * 100 : 100, [fitZoom]);
  const displayZoomPercent = Math.round(toPercent(zoom));

  const adjustZoom = useCallback((dir: "in" | "out") => {
    setZoomOverride(prev => {
      const cur = toPercent(prev ?? fitZoom);
      return (fitZoom * stepZoom(cur, dir)) / 100;
    });
  }, [fitZoom, toPercent]);

  const resetZoom = useCallback(() => setZoomOverride(null), []);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = timelineHeight;
    const onMove = (ev: MouseEvent) => {
      setTimelineHeight(Math.min(Math.max(160, startH + (startY - ev.clientY)), Math.floor(window.innerHeight * 0.6)));
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [timelineHeight]);

  // ── Clips grouped by track ──────────────────────────────────
  const clipsByTrack = useMemo(() => {
    const map = new Map<string, TimelineClip[]>();
    for (const clip of clips) {
      const list = map.get(clip.trackId) ?? [];
      list.push(clip);
      map.set(clip.trackId, list);
    }
    return map;
  }, [clips]);

  return (
    <div
      className="flex flex-col bg-background border-t border-border shrink-0"
      style={{ height: timelineCollapsed ? 41 : timelineHeight }}
    >
      {!timelineCollapsed && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="h-2 cursor-row-resize hover:bg-primary/30 bg-border/50 transition-colors shrink-0 flex items-center justify-center"
        >
          <div className="w-8 h-0.5 rounded-full bg-muted-foreground/30" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setTimelineCollapsed(!timelineCollapsed)} className="flex items-center gap-1.5 hover:text-foreground transition-colors">
            {timelineCollapsed ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-body">
              {isRu ? "Стемы" : "Stems"}
            </span>
          </button>

          {/* Loading progress */}
          {player.loadProgress && player.loadProgress.total > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground animate-in fade-in">
              {player.loadProgress.done < player.loadProgress.total ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  <div className="flex items-center gap-1.5">
                    <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${(player.loadProgress.done / player.loadProgress.total) * 100}%` }}
                      />
                    </div>
                    <span className="font-mono tabular-nums">{player.loadProgress.done}/{player.loadProgress.total}</span>
                    {player.loadProgress.failed > 0 && (
                      <span className="text-destructive font-mono tabular-nums flex items-center gap-0.5">
                        <AlertTriangle className="h-3 w-3" />{player.loadProgress.failed}
                      </span>
                    )}
                    <span className="max-w-[160px] truncate font-body opacity-70">{player.loadProgress.currentLabel}</span>
                  </div>
                </>
              ) : player.loadProgress.failed > 0 ? (
                <>
                  <AlertTriangle className="h-3 w-3 text-destructive" />
                  <span className="text-destructive font-body">
                    {player.loadProgress.failed} {isRu ? "не загружено" : "failed"}
                  </span>
                  <span className="font-mono tabular-nums">
                    {player.loadProgress.loaded}/{player.loadProgress.total}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-5 px-2 text-[10px] gap-1"
                    onClick={player.retryFailed}
                  >
                    <RefreshCw className="h-3 w-3" />
                    {isRu ? "Повторить" : "Retry"}
                  </Button>
                </>
              ) : null}
            </div>
          )}

          {/* Transport */}
          <div className="flex items-center gap-0.5">
            {player.state === "playing" ? (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={player.pause}><Pause className="h-3.5 w-3.5" /></Button>
            ) : (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={player.play} disabled={!player.hasAudio || (player.loadProgress != null && player.loadProgress.total > 0 && player.loadProgress.done < player.loadProgress.total)}><Play className="h-3.5 w-3.5" /></Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={player.stop} disabled={player.state === "stopped"}><Square className="h-3 w-3" /></Button>
            <span className="text-[11px] text-muted-foreground font-mono min-w-[70px] text-center tabular-nums">
              {formatTime(player.positionSec)} / {formatTime(player.totalDuration)}
            </span>
            <TimelineMasterMeter />
            <div className="flex items-center gap-1 ml-1">
              <button onClick={() => player.changeVolume(player.volume > 0 ? 0 : 80)} className="text-muted-foreground hover:text-foreground transition-colors">
                {player.volume === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </button>
              <input type="range" min={0} max={100} value={player.volume} onChange={e => player.changeVolume(Number(e.target.value))} className="w-[72px] h-0.5 accent-primary cursor-pointer volume-slider-sm" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Split button */}
          {onSplitAtScene && (() => {
            // Find which scene boundary the transport is within
            const pos = player.positionSec;
            let splitSceneId: string | null = null;
            for (let i = sceneBoundaries.length - 1; i >= 0; i--) {
              if (pos >= sceneBoundaries[i].startSec) {
                splitSceneId = sceneBoundaries[i].sceneId;
                break;
              }
            }
            // Can't split at last scene
            const isLast = splitSceneId === sceneBoundaries[sceneBoundaries.length - 1]?.sceneId;
            const canSplit = !!splitSceneId && !isLast && sceneBoundaries.length > 1;
            return (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] gap-1 text-muted-foreground hover:text-primary"
                disabled={!canSplit}
                title={isRu ? "Разделить главу в этой позиции" : "Split chapter at this position"}
                onClick={() => {
                  if (splitSceneId) {
                    onSplitAtScene(splitSceneId);
                    toast.success(isRu ? "Глава разделена" : "Chapter split");
                  }
                }}
              >
                <Scissors className="h-3.5 w-3.5" />
                <span className="font-body">{isRu ? "Разделить" : "Split"}</span>
              </Button>
            );
          })()}

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            title={isRu ? "Сброс аудио движка" : "Reset audio engine"}
            onClick={() => {
              resetAudioEngine();
              toast.success(isRu ? "Аудио движок перезапущен" : "Audio engine restarted");
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjustZoom("out")}><ZoomOut className="h-3.5 w-3.5" /></Button>
          <span className="text-xs text-muted-foreground font-body w-10 text-center">{displayZoomPercent}%</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjustZoom("in")}><ZoomIn className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetZoom}><Maximize2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {/* Stem tracks */}
      {!timelineCollapsed && (
        <div ref={tracksContainerRef} className="flex-1 flex min-h-0 overflow-hidden">
          {/* Mixer sidebar */}
          <div className="shrink-0 border-r border-border flex flex-col" style={{ width: `${MIXER_SIDEBAR}px` }}>
            <div className="h-6 border-b border-border" />
            {STEM_TRACKS.map((track) => (
              <TrackMixerStrip
                key={track.id}
                trackId={track.id}
                label={track.label}
                color={track.color}
                expanded={false}
                onMixChange={onMixChange}
              />
            ))}
          </div>

          {/* Timeline area */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden">
            <div
              className="relative cursor-crosshair"
              style={{ width: `${duration * zoom * 4}px`, minWidth: "100%" }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                player.seek(Math.max(0, Math.min(x / (zoom * 4), duration)));
              }}
            >
              <div className="sticky top-0 z-20 bg-background">
                <TimelineRuler
                  zoom={zoom}
                  duration={duration}
                  sceneBoundaries={sceneBoundaries}
                  loadPercent={
                    player.loadProgress && player.loadProgress.total > 0
                      ? Math.round((player.loadProgress.done / player.loadProgress.total) * 100)
                      : null
                  }
                  isLoading={
                    player.loadProgress != null &&
                    player.loadProgress.total > 0 &&
                    player.loadProgress.done < player.loadProgress.total
                  }
                  loadLabel={player.loadProgress?.currentLabel || undefined}
                />
              </div>

              {STEM_TRACKS.map((track) => {
                const trackClips = clipsByTrack.get(track.id) ?? [];
                return (
                  <div key={track.id} className="h-10 border-b border-border/50 relative">
                    {trackClips.map((clip) => {
                      const left = clip.startSec * zoom * 4;
                      const width = clip.durationSec * zoom * 4;
                      return (
                        <div
                          key={clip.id}
                          className="absolute top-1 bottom-1 rounded-sm opacity-80 hover:opacity-100 transition-opacity"
                          style={{ left: `${left}px`, width: `${width}px`, backgroundColor: track.color }}
                          title={`${clip.label} (${clip.durationSec.toFixed(1)}s)`}
                        >
                          {width > 50 && (
                            <span className="text-[9px] text-primary-foreground px-1.5 truncate block mt-0.5 font-body">
                              {clip.label}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              <Playhead positionSec={player.positionSec} zoom={zoom} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
