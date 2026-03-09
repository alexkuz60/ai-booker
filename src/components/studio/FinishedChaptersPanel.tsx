import { useState, useRef, useCallback, useEffect } from "react";
import { Download, Play, Pause, Headphones, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// ─── types ─────────────────────────────────────────────────

export interface FinishedChapter {
  id: string;
  title: string;
  chapterNumber: number;
  durationSec: number;
  status: "rendering" | "ready" | "error";
  audioUrl?: string;
  errorMessage?: string;
}

interface FinishedChaptersPanelProps {
  isRu: boolean;
  bookId?: string | null;
}

// ─── i18n ──────────────────────────────────────────────────

const t = (isRu: boolean) => ({
  title: isRu ? "Готовые аудио главы" : "Finished Audio Chapters",
  chapterCol: isRu ? "Глава" : "Chapter",
  durationCol: isRu ? "Длительность" : "Duration",
  statusCol: isRu ? "Статус" : "Status",
  actionsCol: "",
  ready: isRu ? "Готово" : "Ready",
  rendering: isRu ? "Рендеринг…" : "Rendering…",
  error: isRu ? "Ошибка" : "Error",
  empty: isRu
    ? "Пока нет готовых аудио глав. Завершите обработку хотя бы одной главы."
    : "No finished chapters yet. Complete processing of at least one chapter.",
  player: isRu ? "Аудио плеер" : "Audio Player",
  noTrack: isRu ? "Выберите главу для прослушивания" : "Select a chapter to play",
});

// ─── helpers ───────────────────────────────────────────────

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const STATUS_BADGE: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; }> = {
  ready: { variant: "default" },
  rendering: { variant: "secondary" },
  error: { variant: "destructive" },
};

// ─── placeholder data (to be replaced with real DB query) ──

function usePlaceholderChapters(): FinishedChapter[] {
  return [];
}

// ─── component ─────────────────────────────────────────────

export function FinishedChaptersPanel({ isRu, bookId }: FinishedChaptersPanelProps) {
  const i = t(isRu);
  const chapters = usePlaceholderChapters();

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTitle, setCurrentTitle] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  

  // cleanup on unmount
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const play = useCallback((ch: FinishedChapter) => {
    if (!ch.audioUrl) return;

    if (playingId === ch.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }

    audioRef.current?.pause();
    const audio = new Audio(ch.audioUrl);
    audio.onloadedmetadata = () => setDuration(audio.duration);
    audio.ontimeupdate = () => setCurrentTime(audio.currentTime);
    audio.onended = () => { setPlayingId(null); setCurrentTime(0); };
    audio.play();
    audioRef.current = audio;
    setPlayingId(ch.id);
    setCurrentTitle(ch.title);
  }, [playingId]);

  const seek = useCallback((val: number[]) => {
    if (audioRef.current) {
      audioRef.current.currentTime = val[0];
      setCurrentTime(val[0]);
    }
  }, []);

  const handleDownload = useCallback((ch: FinishedChapter) => {
    if (!ch.audioUrl) return;
    const a = document.createElement("a");
    a.href = ch.audioUrl;
    a.download = `${ch.title}.mp3`;
    a.click();
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Headphones className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-body">
            {i.title}
          </span>
        </div>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1 min-h-0">
        {chapters.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 px-6">
            <Headphones className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground font-body text-center max-w-md">
              {i.empty}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-center font-body text-xs">#</TableHead>
                <TableHead className="font-body text-xs">{i.chapterCol}</TableHead>
                <TableHead className="w-28 font-body text-xs">{i.durationCol}</TableHead>
                <TableHead className="w-28 font-body text-xs">{i.statusCol}</TableHead>
                <TableHead className="w-24 font-body text-xs">{i.actionsCol}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chapters.map((ch) => {
                const isPlaying = playingId === ch.id;
                const badge = STATUS_BADGE[ch.status] ?? STATUS_BADGE.error;
                const statusLabel = ch.status === "ready" ? i.ready : ch.status === "rendering" ? i.rendering : i.error;

                return (
                  <TableRow
                    key={ch.id}
                    className={isPlaying ? "bg-accent/30" : undefined}
                  >
                    <TableCell className="text-center text-xs text-muted-foreground font-body">
                      {ch.chapterNumber}
                    </TableCell>
                    <TableCell className="font-body text-sm">{ch.title}</TableCell>
                    <TableCell className="font-body text-xs text-muted-foreground">
                      {formatDuration(ch.durationSec)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={badge.variant} className="text-[10px]">
                        {statusLabel}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={ch.status !== "ready"}
                          onClick={() => play(ch)}
                        >
                          {isPlaying
                            ? <Pause className="h-3.5 w-3.5" />
                            : <Play className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={ch.status !== "ready"}
                          onClick={() => handleDownload(ch)}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </ScrollArea>

      {/* Audio Player */}
      <div className="shrink-0 border-t border-border bg-card/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <Headphones className="h-4 w-4 text-muted-foreground shrink-0" />
          {currentTitle ? (
            <>
              <span className="text-xs font-body text-foreground truncate max-w-[200px]">
                {currentTitle}
              </span>
              <span className="text-[10px] font-body text-muted-foreground shrink-0">
                {formatTime(currentTime)}
              </span>
              <Slider
                value={[currentTime]}
                onValueChange={seek}
                min={0}
                max={duration || 1}
                step={0.5}
                className="flex-1"
              />
              <span className="text-[10px] font-body text-muted-foreground shrink-0">
                {formatTime(duration)}
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground font-body">{i.noTrack}</span>
          )}
        </div>
      </div>
    </div>
  );
}
