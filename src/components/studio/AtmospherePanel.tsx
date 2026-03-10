import { useState, useRef, useCallback } from "react";
import {
  Wand2, Loader2, Play, Pause, Save, Music, Volume2, Sparkles,
  Clock, Sliders, Zap, Trash2, Pencil, ArrowRight, RotateCcw,
  Waves, TreePine, CloudRain, Wind, Building2, Flame, Footprints,
  DoorOpen, Bomb, Bird, Guitar, Drum, Piano,
  Timer, Repeat, ChevronDown, Upload, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  generateSound,
  saveToStorage,
  type SoundCategory,
  type GeneratedSound,
} from "@/lib/soundProvider";
import { ElevenLabsCreditsWidget } from "./ElevenLabsCreditsWidget";
import { FreesoundPanel } from "./FreesoundPanel";

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
  autoAtmosphere: isRu ? "Авто-атмосфера" : "Auto-Atmosphere",
  autoGenerating: isRu ? "AI генерирует…" : "AI generating…",
  noScene: isRu ? "Выберите сцену для авто-генерации" : "Select a scene for auto-generation",
  autoHint: isRu
    ? "AI проанализирует настроение сцены и сгенерирует фоновые звуки"
    : "AI will analyze scene mood and generate background sounds",
  presets: isRu ? "Быстрые промпты" : "Quick prompts",
  loop: isRu ? "Зацикливание" : "Loop",
  genre: isRu ? "Жанр/Стиль" : "Genre/Style",
  mood: isRu ? "Настроение" : "Mood",
});

// ─── Presets per category ──────────────────────────────────

interface Preset {
  label: string;
  prompt: string;
  icon?: React.ReactNode;
  duration?: number;
}

const SFX_PRESETS: (isRu: boolean) => Preset[] = (isRu) => [
  { label: isRu ? "Дверь" : "Door", prompt: "wooden door creaking open slowly", icon: <DoorOpen className="h-3 w-3" />, duration: 3 },
  { label: isRu ? "Шаги" : "Footsteps", prompt: "footsteps walking on gravel path", icon: <Footprints className="h-3 w-3" />, duration: 5 },
  { label: isRu ? "Взрыв" : "Explosion", prompt: "distant explosion with debris falling", icon: <Bomb className="h-3 w-3" />, duration: 4 },
  { label: isRu ? "Огонь" : "Fire", prompt: "crackling fireplace with popping embers", icon: <Flame className="h-3 w-3" />, duration: 8 },
  { label: isRu ? "Птицы" : "Birds", prompt: "birds chirping in a quiet forest morning", icon: <Bird className="h-3 w-3" />, duration: 6 },
  { label: isRu ? "Волны" : "Waves", prompt: "ocean waves crashing on a rocky shore", icon: <Waves className="h-3 w-3" />, duration: 10 },
];

const AMBIENCE_PRESETS: (isRu: boolean) => Preset[] = (isRu) => [
  { label: isRu ? "Дождь" : "Rain", prompt: "steady rain falling on rooftop with distant thunder", icon: <CloudRain className="h-3 w-3" />, duration: 15 },
  { label: isRu ? "Лес" : "Forest", prompt: "peaceful forest ambience with birds and rustling leaves", icon: <TreePine className="h-3 w-3" />, duration: 15 },
  { label: isRu ? "Город" : "City", prompt: "busy city street ambience with traffic and distant voices", icon: <Building2 className="h-3 w-3" />, duration: 15 },
  { label: isRu ? "Ветер" : "Wind", prompt: "howling wind through abandoned building", icon: <Wind className="h-3 w-3" />, duration: 12 },
  { label: isRu ? "Ночь" : "Night", prompt: "quiet night ambience with crickets and occasional owl", icon: <Sparkles className="h-3 w-3" />, duration: 15 },
  { label: isRu ? "Таверна" : "Tavern", prompt: "medieval tavern ambience with chatter, mugs clinking, fireplace", icon: <Flame className="h-3 w-3" />, duration: 18 },
];

const MUSIC_GENRES: (isRu: boolean) => Preset[] = (isRu) => [
  { label: isRu ? "Пианино" : "Piano", prompt: "soft ambient piano melody, contemplative mood", icon: <Piano className="h-3 w-3" />, duration: 30 },
  { label: isRu ? "Оркестр" : "Orchestral", prompt: "cinematic orchestral score, epic and dramatic", icon: <Music className="h-3 w-3" />, duration: 45 },
  { label: isRu ? "Гитара" : "Guitar", prompt: "gentle acoustic guitar fingerpicking, warm tone", icon: <Guitar className="h-3 w-3" />, duration: 30 },
  { label: isRu ? "Электроника" : "Electronic", prompt: "ambient electronic pads, atmospheric and spacious", icon: <Waves className="h-3 w-3" />, duration: 40 },
  { label: isRu ? "Ударные" : "Percussion", prompt: "tribal percussion rhythm, deep and primal", icon: <Drum className="h-3 w-3" />, duration: 20 },
  { label: isRu ? "Хоррор" : "Horror", prompt: "dark dissonant strings, unsettling horror atmosphere", icon: <Sparkles className="h-3 w-3" />, duration: 30 },
];

const MUSIC_MOODS: (isRu: boolean) => { label: string; suffix: string }[] = (isRu) => [
  { label: isRu ? "Спокойный" : "Calm", suffix: ", calm and peaceful" },
  { label: isRu ? "Тревожный" : "Tense", suffix: ", tense and suspenseful" },
  { label: isRu ? "Грустный" : "Sad", suffix: ", melancholic and sorrowful" },
  { label: isRu ? "Героический" : "Heroic", suffix: ", heroic and triumphant" },
  { label: isRu ? "Таинственный" : "Mysterious", suffix: ", mysterious and eerie" },
  { label: isRu ? "Романтичный" : "Romantic", suffix: ", romantic and tender" },
];

// ─── History item ──────────────────────────────────────────

interface HistoryItem {
  id: string;
  prompt: string;
  category: SoundCategory;
  sound: GeneratedSound;
  savedPath?: string;
  sceneAtmosphereId?: string;
}

// ─── Auto-atmosphere layer from AI ─────────────────────────

interface AtmosphereLayer {
  layer_type: "ambience" | "music" | "sfx";
  prompt: string;
  duration_seconds: number;
  volume: number;
  fade_in_ms: number;
  fade_out_ms: number;
}

// ─── Preset Chips ──────────────────────────────────────────

function PresetChips({
  presets,
  onSelect,
  isRu,
}: {
  presets: Preset[];
  onSelect: (preset: Preset) => void;
  isRu: boolean;
}) {
  const i = t(isRu);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? presets : presets.slice(0, 4);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Zap className="h-2.5 w-2.5" />
        <span>{i.presets}</span>
        {presets.length > 4 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-auto text-primary/70 hover:text-primary flex items-center gap-0.5"
          >
            <ChevronDown className={`h-2.5 w-2.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((p, idx) => (
          <button
            key={idx}
            onClick={() => onSelect(p)}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border border-border/50 bg-card/40 hover:bg-accent/30 hover:border-primary/30 transition-colors text-foreground/80"
          >
            {p.icon}
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Mood Chips (Music tab) ────────────────────────────────

function MoodChips({
  moods,
  activeMood,
  onSelect,
  isRu,
}: {
  moods: { label: string; suffix: string }[];
  activeMood: string;
  onSelect: (mood: { label: string; suffix: string }) => void;
  isRu: boolean;
}) {
  const i = t(isRu);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Sparkles className="h-2.5 w-2.5" />
        <span>{i.mood}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {moods.map((m, idx) => (
          <button
            key={idx}
            onClick={() => onSelect(m)}
            className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
              activeMood === m.suffix
                ? "border-primary bg-primary/15 text-primary"
                : "border-border/50 bg-card/30 text-foreground/70 hover:bg-accent/30"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
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
  const [durationSec, setDurationSec] = useState(category === "music" ? 30 : category === "atmosphere" ? 15 : 5);
  const [influence, setInfluence] = useState(0.3);
  const [loading, setLoading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [moodSuffix, setMoodSuffix] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playerTime, setPlayerTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);

  const maxDuration = category === "music" ? 120 : 22;

  const presets =
    category === "sfx"
      ? SFX_PRESETS(isRu)
      : category === "atmosphere"
        ? AMBIENCE_PRESETS(isRu)
        : MUSIC_GENRES(isRu);

  const moods = category === "music" ? MUSIC_MOODS(isRu) : [];

  const handlePresetSelect = useCallback((preset: Preset) => {
    setPrompt(preset.prompt);
    if (preset.duration) setDurationSec(preset.duration);
  }, []);

  const handleMoodSelect = useCallback((mood: { label: string; suffix: string }) => {
    setMoodSuffix(prev => prev === mood.suffix ? "" : mood.suffix);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      const finalPrompt = prompt.trim() + moodSuffix;
      const sound = await generateSound({
        prompt: finalPrompt,
        category,
        durationSec,
        promptInfluence: category !== "music" ? influence : undefined,
        lang: isRu ? "ru" : "en",
      });
      const item: HistoryItem = {
        id: crypto.randomUUID(),
        prompt: finalPrompt,
        category,
        sound,
      };
      onGenerated(item);
      // Auto-play the generated result
      togglePlay(item);
      toast.success(isRu ? "Звук сгенерирован!" : "Sound generated!");
    } catch (e: any) {
      toast.error(e.message || (isRu ? "Ошибка генерации" : "Generation failed"));
    } finally {
      setLoading(false);
    }
  }, [prompt, moodSuffix, category, durationSec, influence, isRu, onGenerated]);

  const togglePlay = useCallback(
    (item: HistoryItem) => {
      if (playingId === item.id) {
        audioRef.current?.pause();
        setPlayingId(null);
        return;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.onended = null;
        audioRef.current.ontimeupdate = null;
      }
      const audio = new Audio(item.sound.url);
      audio.onended = () => { setPlayingId(null); setPlayerTime(0); };
      audio.ontimeupdate = () => setPlayerTime(audio.currentTime);
      audio.onloadedmetadata = () => setPlayerDuration(audio.duration);
      audio.play();
      audioRef.current = audio;
      setPlayingId(item.id);
      setPlayerTime(0);
    },
    [playingId]
  );

  const seekPlayer = useCallback((val: number[]) => {
    if (audioRef.current) {
      audioRef.current.currentTime = val[0];
      setPlayerTime(val[0]);
    }
  }, []);

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
    <div className="flex flex-col gap-3 h-full">
      {/* Presets */}
      <PresetChips presets={presets} onSelect={handlePresetSelect} isRu={isRu} />

      {/* Music mood chips */}
      {category === "music" && moods.length > 0 && (
        <MoodChips moods={moods} activeMood={moodSuffix} onSelect={handleMoodSelect} isRu={isRu} />
      )}

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

      {/* Controls row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        {/* Duration */}
        <div className="flex items-center gap-2 min-w-[180px]">
          <Timer className="h-3.5 w-3.5 shrink-0" />
          <span className="shrink-0 text-[10px]">{i.duration}:</span>
          <Slider
            compact
            value={[durationSec]}
            onValueChange={([v]) => setDurationSec(v)}
            min={1}
            max={maxDuration}
            step={1}
            className="w-[100px] shrink-0"
          />
          <span className="w-12 text-right font-body text-[10px]">{durationSec} {i.sec}</span>
        </div>
        {/* Prompt influence (SFX + Atmosphere only) */}
        {category !== "music" && (
          <div className="flex items-center gap-2 min-w-[180px]">
            <Sliders className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0 text-[10px]">{i.influence}:</span>
            <Slider
              compact
              value={[influence]}
              onValueChange={([v]) => setInfluence(v)}
              min={0}
              max={1}
              step={0.05}
              className="w-[100px] shrink-0"
            />
            <span className="w-10 text-right font-body text-[10px]">{Math.round(influence * 100)}%</span>
          </div>
        )}
        {/* Mood badge for music */}
        {category === "music" && moodSuffix && (
          <Badge variant="secondary" className="text-[9px] gap-1">
            <Sparkles className="h-2.5 w-2.5" />
            {MUSIC_MOODS(isRu).find(m => m.suffix === moodSuffix)?.label}
          </Badge>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground/50 font-body flex items-center gap-1">
        <Sparkles className="h-2.5 w-2.5" /> {i.hint}
      </p>

      {/* Mini-player for active track */}
      {playingId && (() => {
        const active = filtered.find(h => h.id === playingId);
        if (!active) return null;
        const fmtTime = (s: number) => {
          const m = Math.floor(s / 60);
          const sec = Math.floor(s % 60);
          return `${m}:${sec.toString().padStart(2, "0")}`;
        };
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
              {fmtTime(playerTime)} / {fmtTime(playerDuration)}
            </span>
          </div>
        );
      })()}

      {/* History */}
      <ScrollArea className="flex-1 min-h-0">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-xs text-muted-foreground font-body">
            {i.noResults}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 pr-2">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2 rounded-md border border-border/50 bg-card/30 hover:bg-card/60 transition-colors"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => togglePlay(item)}
                >
                  {playingId === item.id ? (
                    <Pause className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </Button>
                <span className="text-[10px] font-body truncate flex-1">{item.prompt}</span>
                <Badge variant="outline" className="text-[9px] shrink-0">
                  {item.sound.provider}
                </Badge>
                {item.savedPath ? (
                  <Badge variant="secondary" className="text-[9px] shrink-0">{i.saved}</Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
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

// ─── Editable Layer Card ───────────────────────────────────

function EditableLayerCard({
  layer,
  index,
  isRu,
  onChange,
  onRemove,
}: {
  layer: AtmosphereLayer;
  index: number;
  isRu: boolean;
  onChange: (idx: number, updated: AtmosphereLayer) => void;
  onRemove: (idx: number) => void;
}) {
  const LAYER_LABELS: Record<string, string> = {
    ambience: isRu ? "🌧 Эмбиент" : "🌧 Ambience",
    music: isRu ? "🎵 Музыка" : "🎵 Music",
    sfx: isRu ? "💥 SFX" : "💥 SFX",
  };

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border border-border/60 bg-card/40">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] shrink-0">
          {LAYER_LABELS[layer.layer_type] || layer.layer_type}
        </Badge>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {layer.duration_seconds}s · vol:{Math.round(layer.volume * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-destructive/60 hover:text-destructive"
          onClick={() => onRemove(index)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <Textarea
        value={layer.prompt}
        onChange={(e) => onChange(index, { ...layer, prompt: e.target.value })}
        className="text-xs font-body min-h-[56px] resize-none"
        rows={2}
      />
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5 flex-1">
          <Clock className="h-3 w-3 shrink-0" />
          <Slider
            compact
            value={[layer.duration_seconds]}
            onValueChange={([v]) => onChange(index, { ...layer, duration_seconds: v })}
            min={2}
            max={layer.layer_type === "music" ? 120 : 22}
            step={1}
            className="w-[100px] shrink-0"
          />
          <span className="w-8 text-right">{layer.duration_seconds}s</span>
        </div>
        <div className="flex items-center gap-1.5 flex-1">
          <Volume2 className="h-3 w-3 shrink-0" />
          <Slider
            compact
            value={[layer.volume]}
            onValueChange={([v]) => onChange(index, { ...layer, volume: v })}
            min={0}
            max={1}
            step={0.05}
            className="w-[100px] shrink-0"
          />
          <span className="w-8 text-right">{Math.round(layer.volume * 100)}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px]">Fade:</span>
          <span className="text-[9px]">{layer.fade_in_ms}ms↗</span>
          <span className="text-[9px]">{layer.fade_out_ms}ms↘</span>
        </div>
      </div>
    </div>
  );
}

// ─── Auto-Atmosphere Panel ─────────────────────────────────

function AutoAtmospherePanel({
  isRu,
  sceneId,
  onGenerated,
}: {
  isRu: boolean;
  sceneId: string | null;
  onGenerated: (items: HistoryItem[]) => void;
}) {
  const i = t(isRu);
  const [promptLoading, setPromptLoading] = useState(false);
  const [synthLoading, setSynthLoading] = useState(false);
  const [step, setStep] = useState("");
  const [pendingLayers, setPendingLayers] = useState<AtmosphereLayer[] | null>(null);
  const [existingLayers, setExistingLayers] = useState<Array<{
    id: string;
    layer_type: string;
    prompt_used: string;
    volume: number;
    duration_ms: number;
  }>>([]);
  const [loadingExisting, setLoadingExisting] = useState(false);

  const loadExisting = useCallback(async () => {
    if (!sceneId) { setExistingLayers([]); return; }
    setLoadingExisting(true);
    const { data } = await supabase
      .from("scene_atmospheres")
      .select("id, layer_type, prompt_used, volume, duration_ms")
      .eq("scene_id", sceneId)
      .order("created_at");
    setExistingLayers((data as any[]) ?? []);
    setLoadingExisting(false);
  }, [sceneId]);

  useState(() => { loadExisting(); });

  const handleGeneratePrompts = useCallback(async () => {
    if (!sceneId) return;
    setPromptLoading(true);
    setPendingLayers(null);

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const promptRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-atmosphere-prompt`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ scene_id: sceneId, lang: isRu ? "ru" : "en" }),
        }
      );

      if (!promptRes.ok) {
        const err = await promptRes.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `Prompt generation failed (${promptRes.status})`);
      }

      const { layers } = (await promptRes.json()) as { layers: AtmosphereLayer[] };
      if (!layers?.length) {
        toast.info(isRu ? "AI не предложил слоёв для этой сцены" : "AI suggested no layers for this scene");
        return;
      }

      setPendingLayers(layers);
      toast.success(isRu ? `AI предложил ${layers.length} слоёв — отредактируйте и запустите синтез` : `AI suggested ${layers.length} layers — review and generate`);
    } catch (e: any) {
      toast.error(e.message || (isRu ? "Ошибка генерации промптов" : "Prompt generation failed"));
    } finally {
      setPromptLoading(false);
    }
  }, [sceneId, isRu]);

  const handleEditLayer = useCallback((idx: number, updated: AtmosphereLayer) => {
    setPendingLayers(prev => prev ? prev.map((l, i) => i === idx ? updated : l) : prev);
  }, []);

  const handleRemovePending = useCallback((idx: number) => {
    setPendingLayers(prev => prev ? prev.filter((_, i) => i !== idx) : prev);
  }, []);

  const handleSynthesizeAll = useCallback(async () => {
    if (!sceneId || !pendingLayers?.length) return;
    setSynthLoading(true);

    try {
      const results: HistoryItem[] = [];

      for (let idx = 0; idx < pendingLayers.length; idx++) {
        const layer = pendingLayers[idx];
        setStep(isRu ? `Синтез ${idx + 1}/${pendingLayers.length}…` : `Synthesizing ${idx + 1}/${pendingLayers.length}…`);

        const category: SoundCategory = layer.layer_type === "music" ? "music" : layer.layer_type === "sfx" ? "sfx" : "atmosphere";

        const sound = await generateSound({
          prompt: layer.prompt,
          category,
          durationSec: layer.duration_seconds,
          promptInfluence: category !== "music" ? 0.3 : undefined,
          lang: "en",
        });

        const slug = layer.prompt
          .toLowerCase()
          .replace(/[^a-z0-9]+/gi, "-")
          .slice(0, 40);
        const fileName = `${slug}-${Date.now()}.mp3`;
        const path = await saveToStorage(sound.blob, category, fileName);

        const { data: inserted } = await supabase
          .from("scene_atmospheres")
          .insert({
            scene_id: sceneId,
            layer_type: layer.layer_type,
            audio_path: path,
            prompt_used: layer.prompt,
            duration_ms: Math.round(layer.duration_seconds * 1000),
            volume: layer.volume,
            fade_in_ms: layer.fade_in_ms,
            fade_out_ms: layer.fade_out_ms,
          } as any)
          .select("id")
          .single();

        results.push({
          id: crypto.randomUUID(),
          prompt: layer.prompt,
          category,
          sound,
          savedPath: path,
          sceneAtmosphereId: (inserted as any)?.id,
        });
      }

      onGenerated(results);
      setPendingLayers(null);
      await loadExisting();
      toast.success(isRu ? `Сгенерировано ${results.length} слоёв!` : `Generated ${results.length} layers!`);
    } catch (e: any) {
      toast.error(e.message || (isRu ? "Ошибка синтеза" : "Synthesis failed"));
    } finally {
      setSynthLoading(false);
      setStep("");
    }
  }, [sceneId, pendingLayers, isRu, onGenerated, loadExisting]);

  const handleDeleteLayer = useCallback(async (layerId: string) => {
    await supabase.from("scene_atmospheres").delete().eq("id", layerId);
    setExistingLayers(prev => prev.filter(l => l.id !== layerId));
    toast.success(isRu ? "Слой удалён" : "Layer deleted");
  }, [isRu]);

  if (!sceneId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <Zap className="h-8 w-8 opacity-40" />
        <p className="text-sm font-body">{i.noScene}</p>
      </div>
    );
  }

  const LAYER_LABELS: Record<string, string> = {
    ambience: isRu ? "🌧 Эмбиент" : "🌧 Ambience",
    music: isRu ? "🎵 Музыка" : "🎵 Music",
    sfx: isRu ? "💥 SFX" : "💥 SFX",
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          onClick={handleGeneratePrompts}
          disabled={promptLoading || synthLoading}
          variant={pendingLayers ? "outline" : "default"}
          className="gap-1.5"
          size="sm"
        >
          {promptLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : pendingLayers ? <RotateCcw className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />}
          {promptLoading
            ? (isRu ? "AI анализирует…" : "AI analyzing…")
            : pendingLayers
              ? (isRu ? "Перегенерировать" : "Regenerate")
              : (isRu ? "Сгенерировать промпты" : "Generate Prompts")}
        </Button>

        {pendingLayers && pendingLayers.length > 0 && (
          <Button
            onClick={handleSynthesizeAll}
            disabled={synthLoading}
            className="gap-1.5"
            size="sm"
          >
            {synthLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
            {synthLoading
              ? step || (isRu ? "Синтез…" : "Synthesizing…")
              : (isRu ? `Синтез ${pendingLayers.length} слоёв` : `Synthesize ${pendingLayers.length} layers`)}
          </Button>
        )}
      </div>

      {!pendingLayers && (
        <p className="text-[10px] text-muted-foreground/50 font-body flex items-center gap-1">
          <Sparkles className="h-2.5 w-2.5" /> {i.autoHint}
        </p>
      )}

      <ScrollArea className="flex-1 min-h-0">
        {pendingLayers && pendingLayers.length > 0 && (
          <div className="flex flex-col gap-2 pr-2 mb-4">
            <p className="text-[10px] font-body text-muted-foreground flex items-center gap-1.5">
              <Pencil className="h-3 w-3" />
              {isRu ? "Отредактируйте промпты и нажмите «Синтез»" : "Edit prompts and click \"Synthesize\""}
            </p>
            {pendingLayers.map((layer, idx) => (
              <EditableLayerCard
                key={idx}
                layer={layer}
                index={idx}
                isRu={isRu}
                onChange={handleEditLayer}
                onRemove={handleRemovePending}
              />
            ))}
          </div>
        )}

        {loadingExisting ? (
          <div className="flex items-center justify-center h-16">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : existingLayers.length > 0 && (
          <div className="flex flex-col gap-2 pr-2">
            <p className="text-[10px] font-body text-muted-foreground">
              {isRu ? "Сохранённые слои" : "Saved layers"}
            </p>
            {existingLayers.map((layer) => (
              <div
                key={layer.id}
                className="flex items-center gap-2 p-2 rounded-md border border-border/50 bg-card/30"
              >
                <Badge variant="outline" className="text-[9px] shrink-0">
                  {LAYER_LABELS[layer.layer_type] || layer.layer_type}
                </Badge>
                <span className="text-[10px] font-body truncate flex-1">{layer.prompt_used}</span>
                <span className="text-[9px] text-muted-foreground shrink-0">
                  {Math.round(layer.duration_ms / 1000)}s
                </span>
                <span className="text-[9px] text-muted-foreground shrink-0">
                  vol:{Math.round(layer.volume * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-destructive/60 hover:text-destructive"
                  onClick={() => handleDeleteLayer(layer.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {!pendingLayers && !loadingExisting && existingLayers.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs text-muted-foreground font-body">
            {isRu ? "Нет атмосферных слоёв для этой сцены" : "No atmosphere layers for this scene"}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ─── Main export ───────────────────────────────────────────

interface AtmospherePanelProps {
  isRu: boolean;
  sceneId?: string | null;
}

export function AtmospherePanel({ isRu, sceneId }: AtmospherePanelProps) {
  const i = t(isRu);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGenerated = useCallback((item: HistoryItem) => {
    setHistory((prev) => [item, ...prev]);
  }, []);

  const handleAutoGenerated = useCallback((items: HistoryItem[]) => {
    setHistory((prev) => [...items, ...prev]);
  }, []);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      toast.error(isRu ? "Выберите аудиофайл" : "Please select an audio file");
      return;
    }
    try {
      const category: SoundCategory = "sfx";
      const slug = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zа-я0-9]+/gi, "-").slice(0, 40);
      const fileName = `${slug}-${Date.now()}.mp3`;
      const path = await saveToStorage(file, category, fileName);
      const url = URL.createObjectURL(file);
      const item: HistoryItem = {
        id: crypto.randomUUID(),
        prompt: file.name,
        category,
        sound: { blob: file, url, provider: "upload" },
        savedPath: path,
      };
      setHistory((prev) => [item, ...prev]);
      toast.success(isRu ? "Файл загружен и сохранён" : "File uploaded and saved");
    } catch (err: any) {
      toast.error(err.message || (isRu ? "Ошибка загрузки" : "Upload failed"));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [isRu]);

  return (
    <Tabs defaultValue="auto" className="h-full flex flex-col">
      <div className="shrink-0 mx-4 mt-3 flex items-center gap-2 flex-wrap">
        <TabsList className="w-fit">
          <TabsTrigger value="auto" className="gap-1.5 text-xs">
            <Zap className="h-3 w-3" />
            {isRu ? "Авто" : "Auto"}
          </TabsTrigger>
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

        <div className="flex items-center gap-2 ml-auto">
          <ElevenLabsCreditsWidget isRu={isRu} compact />
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-[10px]"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3 w-3" />
            {isRu ? "Загрузить" : "Upload"}
          </Button>
        </div>
      </div>

      <TabsContent value="auto" className="flex-1 px-4 pb-4 min-h-0">
        <AutoAtmospherePanel
          isRu={isRu}
          sceneId={sceneId ?? null}
          onGenerated={handleAutoGenerated}
        />
      </TabsContent>

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
