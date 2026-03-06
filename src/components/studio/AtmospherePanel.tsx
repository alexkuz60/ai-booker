import { useState, useRef, useCallback } from "react";
import {
  Wand2, Loader2, Play, Pause, Save, Music, Volume2, Sparkles,
  Clock, Sliders,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  generateSound,
  saveToStorage,
  type SoundCategory,
  type GeneratedSound,
} from "@/lib/soundProvider";

// ─── i18n ──────────────────────────────────────────────────

const t = (isRu: boolean) => ({
  sfxTab: isRu ? "Звуковые эффекты" : "Sound Effects",
  ambienceTab: isRu ? "Атмосфера" : "Ambience",
  musicTab: isRu ? "Музыка" : "Music",
  promptPlaceholder: (cat: string) =>
    isRu
      ? `Опишите ${cat === "music" ? "музыку" : cat === "atmosphere" ? "атмосферу" : "звук"}…`
      : `Describe the ${cat === "music" ? "music" : cat === "atmosphere" ? "ambience" : "sound effect"}…`,
  generate: isRu ? "Генерировать" : "Generate",
  generating: isRu ? "Генерация…" : "Generating…",
  duration: isRu ? "Длительность" : "Duration",
  influence: isRu ? "Точность промпта" : "Prompt influence",
  save: isRu ? "Сохранить" : "Save",
  saved: isRu ? "Сохранено" : "Saved",
  noResults: isRu ? "Нет сгенерированных звуков" : "No generated sounds yet",
  hint: isRu
    ? "Опишите желаемый звук на английском для лучшего результата"
    : "Describe your desired sound in English for best results",
  sec: isRu ? "сек" : "sec",
});

// ─── History item ──────────────────────────────────────────

interface HistoryItem {
  id: string;
  prompt: string;
  category: SoundCategory;
  sound: GeneratedSound;
  savedPath?: string;
}

// ─── Sub-tab panel ─────────────────────────────────────────

function GeneratorPanel({
  category,
  isRu,
  history,
  onGenerated,
}: {
  category: SoundCategory;
  isRu: boolean;
  history: HistoryItem[];
  onGenerated: (item: HistoryItem) => void;
}) {
  const i = t(isRu);
  const [prompt, setPrompt] = useState("");
  const [durationSec, setDurationSec] = useState(category === "music" ? 30 : 5);
  const [influence, setInfluence] = useState(0.3);
  const [loading, setLoading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const maxDuration = category === "music" ? 120 : 22;

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      const sound = await generateSound({
        prompt: prompt.trim(),
        category,
        durationSec,
        promptInfluence: category !== "music" ? influence : undefined,
        lang: isRu ? "ru" : "en",
      });
      const item: HistoryItem = {
        id: crypto.randomUUID(),
        prompt: prompt.trim(),
        category,
        sound,
      };
      onGenerated(item);
      toast.success(isRu ? "Звук сгенерирован!" : "Sound generated!");
    } catch (e: any) {
      toast.error(e.message || (isRu ? "Ошибка генерации" : "Generation failed"));
    } finally {
      setLoading(false);
    }
  }, [prompt, category, durationSec, influence, isRu, onGenerated]);

  const togglePlay = useCallback(
    (item: HistoryItem) => {
      if (playingId === item.id) {
        audioRef.current?.pause();
        setPlayingId(null);
        return;
      }
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(item.sound.url);
      audio.onended = () => setPlayingId(null);
      audio.play();
      audioRef.current = audio;
      setPlayingId(item.id);
    },
    [playingId]
  );

  const handleSave = useCallback(
    async (item: HistoryItem) => {
      setSavingId(item.id);
      try {
        const slug = item.prompt
          .toLowerCase()
          .replace(/[^a-zа-я0-9]+/gi, "-")
          .slice(0, 40);
        const fileName = `${slug}-${Date.now()}.mp3`;
        const path = await saveToStorage(item.sound.blob, item.category, fileName);
        item.savedPath = path;
        toast.success(isRu ? "Сохранено в хранилище" : "Saved to storage");
      } catch (e: any) {
        toast.error(e.message || (isRu ? "Ошибка сохранения" : "Save failed"));
      } finally {
        setSavingId(null);
      }
    },
    [isRu]
  );

  const filtered = history.filter((h) => h.category === category);

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Prompt input */}
      <div className="flex gap-2">
        <Input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={i.promptPlaceholder(category)}
          className="flex-1 font-body text-sm"
          onKeyDown={(e) => e.key === "Enter" && !loading && handleGenerate()}
        />
        <Button
          size="sm"
          onClick={handleGenerate}
          disabled={loading || !prompt.trim()}
          className="gap-1.5 shrink-0"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          {loading ? i.generating : i.generate}
        </Button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 flex-1">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span className="shrink-0">{i.duration}:</span>
          <Slider
            value={[durationSec]}
            onValueChange={([v]) => setDurationSec(v)}
            min={1}
            max={maxDuration}
            step={1}
            className="flex-1 max-w-[160px]"
          />
          <span className="w-12 text-right font-body">{durationSec} {i.sec}</span>
        </div>
        {category !== "music" && (
          <div className="flex items-center gap-2 flex-1">
            <Sliders className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0">{i.influence}:</span>
            <Slider
              value={[influence]}
              onValueChange={([v]) => setInfluence(v)}
              min={0}
              max={1}
              step={0.05}
              className="flex-1 max-w-[160px]"
            />
            <span className="w-10 text-right font-body">{Math.round(influence * 100)}%</span>
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground/60 font-body flex items-center gap-1">
        <Sparkles className="h-3 w-3" /> {i.hint}
      </p>

      {/* History */}
      <ScrollArea className="flex-1 min-h-0">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground font-body">
            {i.noResults}
          </div>
        ) : (
          <div className="flex flex-col gap-2 pr-2">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2 rounded-md border border-border/50 bg-card/30 hover:bg-card/60 transition-colors"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => togglePlay(item)}
                >
                  {playingId === item.id ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </Button>
                <span className="text-xs font-body truncate flex-1">{item.prompt}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {item.sound.provider}
                </Badge>
                {item.savedPath ? (
                  <Badge variant="secondary" className="text-[10px] shrink-0">{i.saved}</Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => handleSave(item)}
                    disabled={savingId === item.id}
                  >
                    {savingId === item.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3" />
                    )}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ─── Main export ───────────────────────────────────────────

interface AtmospherePanelProps {
  isRu: boolean;
}

export function AtmospherePanel({ isRu }: AtmospherePanelProps) {
  const i = t(isRu);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const handleGenerated = useCallback((item: HistoryItem) => {
    setHistory((prev) => [item, ...prev]);
  }, []);

  return (
    <Tabs defaultValue="sfx" className="h-full flex flex-col">
      <TabsList className="w-fit shrink-0 mx-4 mt-3">
        <TabsTrigger value="sfx" className="gap-1.5 text-xs">
          <Volume2 className="h-3 w-3" />
          {i.sfxTab}
        </TabsTrigger>
        <TabsTrigger value="atmosphere" className="gap-1.5 text-xs">
          <Sparkles className="h-3 w-3" />
          {i.ambienceTab}
        </TabsTrigger>
        <TabsTrigger value="music" className="gap-1.5 text-xs">
          <Music className="h-3 w-3" />
          {i.musicTab}
        </TabsTrigger>
      </TabsList>

      {(["sfx", "atmosphere", "music"] as SoundCategory[]).map((cat) => (
        <TabsContent key={cat} value={cat} className="flex-1 px-4 pb-4 min-h-0">
          <GeneratorPanel
            category={cat}
            isRu={isRu}
            history={history}
            onGenerated={handleGenerated}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
