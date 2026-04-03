/**
 * TimelineTransport — header bar with transport controls, zoom, render button.
 * Extracted from StudioTimeline.tsx for modularity.
 */

import { ChevronUp, ChevronDown, Film, Play, Pause, Square, Volume2, VolumeX, Download, Loader2, SlidersHorizontal, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimelineMasterMeter } from "./TimelineMasterMeter";
import { memo } from "react";

const SCENE_ZOOM_PRESETS = [90, 100, 200, 300, 400, 500] as const;

interface TimelineTransportProps {
  isRu: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  // Player
  playerState: "stopped" | "playing" | "paused";
  hasAudio: boolean;
  positionSec: number;
  totalDuration: number;
  volume: number;
  loopEnabled: boolean;
  loopRegion: { startSec: number; endSec: number } | null;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onChangeVolume: (v: number) => void;
  onToggleLoop: () => void;
  // Zoom
  sceneZoomPercent: number;
  onApplySceneZoom: (percent: number) => void;
  // Render
  isRendering: boolean;
  renderPercent: number;
  sceneId?: string | null;
  onRenderScene: () => void;
  // Tracks info
  charTrackCount: number;
  // View mode
  timelineView: "tracks" | "plugins";
  onToggleView: () => void;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export const TimelineTransport = memo(function TimelineTransport(props: TimelineTransportProps) {
  const {
    isRu, collapsed, onToggleCollapse,
    playerState, hasAudio, positionSec, totalDuration, volume,
    loopEnabled, loopRegion,
    onPlay, onPause, onStop, onChangeVolume, onToggleLoop,
    sceneZoomPercent, onApplySceneZoom,
    isRendering, renderPercent, sceneId, onRenderScene,
    charTrackCount,
    timelineView, onToggleView,
  } = props;

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          {collapsed ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-body">
            {isRu ? "Таймлайн" : "Timeline"}
          </span>
        </button>

        <div className="flex items-center gap-0.5">
          {playerState === "playing" ? (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPause} title={isRu ? "Пауза" : "Pause"}>
              <Pause className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPlay} disabled={!hasAudio} title={isRu ? "Воспроизвести" : "Play"}>
              <Play className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onStop} disabled={playerState === "stopped"} title={isRu ? "Стоп" : "Stop"}>
            <Square className="h-3 w-3" />
          </Button>
          <span className="text-[11px] text-muted-foreground font-mono min-w-[70px] text-center tabular-nums">
            {formatTime(positionSec)} / {formatTime(totalDuration)}
          </span>
          <TimelineMasterMeter />
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={() => onChangeVolume(volume > 0 ? 0 : 80)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title={isRu ? "Громкость" : "Volume"}
            >
              {volume === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
            <input
              type="range" min={0} max={100} value={volume}
              onChange={e => onChangeVolume(Number(e.target.value))}
              className="w-[72px] h-0.5 accent-primary cursor-pointer volume-slider-sm"
              title={`${volume}%`}
            />
          </div>
          <Button
            variant={loopEnabled ? "secondary" : "ghost"}
            size="icon"
            className={`h-7 w-7 ${loopEnabled ? "text-accent-foreground" : ""}`}
            onClick={onToggleLoop}
            disabled={!loopRegion}
            title={isRu ? "Зацикливание региона (выберите клипы Ctrl+клик)" : "Loop region (select clips with Ctrl+click)"}
          >
            <Repeat className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-1 text-[11px]">
          <Film className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground font-body">{isRu ? "Сцена" : "Scene"}</span>
        </div>

        {charTrackCount > 0 && (
          <span className="text-[10px] text-muted-foreground/60 font-body">
            {charTrackCount} {isRu ? "дикт." : "narr."}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Select value={String(sceneZoomPercent)} onValueChange={(v) => onApplySceneZoom(Number(v))}>
          <SelectTrigger className="h-7 w-[80px] text-xs font-body border-none bg-transparent px-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCENE_ZOOM_PRESETS.map((p) => (
              <SelectItem key={p} value={String(p)} className="text-xs">{p}%</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="w-px h-4 bg-border mx-1" />
        <Button
          variant={isRendering ? "secondary" : "outline"}
          size="sm"
          className="h-7 text-xs gap-1.5 font-body"
          onClick={onRenderScene}
          disabled={isRendering || !sceneId || !hasAudio}
          title={isRu ? "Рендер сцены (3 стема)" : "Render scene (3 stems)"}
        >
          {isRendering ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {renderPercent}%
            </>
          ) : (
            <>
              <Download className="h-3 w-3" />
              {isRu ? "Рендер" : "Render"}
            </>
          )}
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button
          variant={timelineView === "plugins" ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          onClick={onToggleView}
          title={isRu ? "Канальные плагины" : "Channel Plugins"}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
});
