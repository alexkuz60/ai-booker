import { useState, useRef, useCallback } from "react";
import {
  Search, Play, Pause, Save, Loader2, Clock, Star, User, ExternalLink, ChevronLeft, ChevronRight, GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { saveToStorage } from "@/lib/soundProvider";
import { cn } from "@/lib/utils";
import { setDragAudio, clearDragAudio, DRAG_AUDIO_MIME } from "@/lib/dragAudioStore";
import { createDragGhost } from "@/lib/dragGhost";

interface FreesoundResult {
  id: number;
  name: string;
  duration: number;
  tags: string[];
  description: string;
  preview_url: string;
  waveform_url: string;
  username: string;
  license: string;
  rating: number;
}

interface FreesoundPanelProps {
  isRu: boolean;
}

export function FreesoundPanel({ isRu }: FreesoundPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FreesoundResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [durationMax, setDurationMax] = useState(30);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playerTime, setPlayerTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);

  const pageSize = 15;

  const search = useCallback(async (q: string, p: number) => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error("Not authenticated"); return; }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/freesound-search`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            query: q.trim(),
            page: p,
            page_size: pageSize,
            duration_max: durationMax,
            sort: "rating_desc",
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `Search failed (${response.status})`);
      }

      const data = await response.json();
      setResults(data.results || []);
      setTotalCount(data.count || 0);
      setPage(p);
    } catch (e: any) {
      toast.error(e.message || (isRu ? "Ошибка поиска" : "Search failed"));
    } finally {
      setLoading(false);
    }
  }, [isRu, durationMax]);

  const handleSearch = useCallback(() => search(query, 1), [search, query]);

  const togglePlay = useCallback((sound: FreesoundResult) => {
    if (playingId === sound.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.ontimeupdate = null;
    }
    const audio = new Audio(sound.preview_url);
    audio.onended = () => { setPlayingId(null); setPlayerTime(0); };
    audio.ontimeupdate = () => setPlayerTime(audio.currentTime);
    audio.onloadedmetadata = () => setPlayerDuration(audio.duration);
    audio.play().catch(() => toast.error(isRu ? "Не удалось воспроизвести" : "Playback failed"));
    audioRef.current = audio;
    setPlayingId(sound.id);
    setPlayerTime(0);
  }, [playingId, isRu]);

  const seekPlayer = useCallback((val: number[]) => {
    if (audioRef.current) {
      audioRef.current.currentTime = val[0];
      setPlayerTime(val[0]);
    }
  }, []);

  const handleSave = useCallback(async (sound: FreesoundResult) => {
    setSavingId(sound.id);
    try {
      const response = await fetch(sound.preview_url);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const slug = sound.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
      const fileName = `freesound-${slug}-${sound.id}.mp3`;
      await saveToStorage(blob, "sfx", fileName);
      toast.success(isRu ? "Сохранено в хранилище" : "Saved to storage");
    } catch (e: any) {
      toast.error(e.message || (isRu ? "Ошибка сохранения" : "Save failed"));
    } finally {
      setSavingId(null);
    }
  }, [isRu]);

  const fmtDur = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m > 0 ? `${m}:${sec.toString().padStart(2, "0")}` : `${sec}s`;
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Search bar */}
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isRu ? "Поиск звуков на Freesound…" : "Search sounds on Freesound…"}
          className="flex-1 font-body text-sm"
          onKeyDown={(e) => e.key === "Enter" && !loading && handleSearch()}
        />
        <Button size="sm" onClick={handleSearch} disabled={loading || !query.trim()} className="gap-1.5 shrink-0">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {isRu ? "Найти" : "Search"}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span className="text-[10px] shrink-0">{isRu ? "Макс. длит." : "Max dur."}:</span>
          <Slider
            compact
            value={[durationMax]}
            onValueChange={([v]) => setDurationMax(v)}
            min={1}
            max={120}
            step={1}
            className="w-[100px] shrink-0"
          />
          <span className="w-10 text-right font-body text-[10px]">{durationMax}s</span>
        </div>
        {totalCount > 0 && (
          <span className="text-[10px] ml-auto">
            {totalCount.toLocaleString()} {isRu ? "результатов" : "results"}
          </span>
        )}
      </div>

      {/* Active player */}
      {playingId && (() => {
        const active = results.find(r => r.id === playingId);
        if (!active) return null;
        return (
          <div className="flex items-center gap-2 p-2 rounded-md border border-primary/30 bg-primary/5">
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => togglePlay(active)}>
              <Pause className="h-3.5 w-3.5" />
            </Button>
            <Slider
              value={[playerTime]}
              max={playerDuration || 1}
              step={0.1}
              onValueChange={seekPlayer}
              className="flex-1"
            />
            <span className="text-[10px] font-body text-muted-foreground w-16 text-right shrink-0">
              {fmtDur(playerTime)} / {fmtDur(playerDuration)}
            </span>
          </div>
        );
      })()}

      {/* Results */}
      <ScrollArea className="flex-1 min-h-0">
        {results.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-20 text-xs text-muted-foreground font-body gap-1">
            <Search className="h-4 w-4 opacity-40" />
            {isRu ? "Введите запрос для поиска бесплатных звуков" : "Enter a query to search free sounds"}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 pr-2">
            {results.map((sound) => (
              <div
                key={sound.id}
                draggable
                onDragStart={(e) => {
                  const dragId = `freesound-${sound.id}`;
                  setDragAudio(dragId, {
                    fetchUrl: sound.preview_url,
                    prompt: sound.name,
                    category: "sfx",
                  });
                  e.dataTransfer.setData(DRAG_AUDIO_MIME, dragId);
                  e.dataTransfer.effectAllowed = "copy";
                  const ghost = createDragGhost(sound.name, "sfx");
                  e.dataTransfer.setDragImage(ghost, 20, 16);
                }}
                onDragEnd={() => clearDragAudio(`freesound-${sound.id}`)}
                className={cn(
                  "flex items-center gap-2 p-2 rounded-md border transition-colors cursor-grab active:cursor-grabbing",
                  playingId === sound.id
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/50 bg-card/30 hover:bg-card/60"
                )}
              >
                <GripVertical className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => togglePlay(sound)}
                  disabled={!sound.preview_url}
                >
                  {playingId === sound.id ? (
                    <Pause className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </Button>

                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-body truncate text-foreground">{sound.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" /> {fmtDur(sound.duration)}
                    </span>
                    {sound.rating > 0 && (
                      <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                        <Star className="h-2.5 w-2.5" /> {sound.rating.toFixed(1)}
                      </span>
                    )}
                    <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                      <User className="h-2.5 w-2.5" /> {sound.username}
                    </span>
                  </div>
                </div>

                {sound.tags.length > 0 && (
                  <div className="hidden sm:flex gap-1 shrink-0">
                    {sound.tags.slice(0, 2).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[8px] px-1 py-0">{tag}</Badge>
                    ))}
                  </div>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => handleSave(sound)}
                  disabled={savingId === sound.id}
                  title={isRu ? "Сохранить в хранилище" : "Save to storage"}
                >
                  {savingId === sound.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={page <= 1 || loading}
            onClick={() => search(query, page - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-[10px] text-muted-foreground font-body">
            {page} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={page >= totalPages || loading}
            onClick={() => search(query, page + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <p className="text-[9px] text-muted-foreground/40 font-body flex items-center gap-1">
        <ExternalLink className="h-2.5 w-2.5" />
        {isRu ? "Звуки от Freesound.org — проверьте лицензию перед коммерческим использованием" : "Sounds from Freesound.org — check license before commercial use"}
      </p>
    </div>
  );
}
