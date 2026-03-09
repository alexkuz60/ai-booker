import { useState, useRef, useCallback } from "react";
import {
  Wand2, Loader2, Play, Pause, Save, Music, Volume2, Sparkles,
  Clock, Sliders, Zap, Trash2, Pencil, ArrowRight, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
  autoAtmosphere: isRu ? "Авто-атмосфера" : "Auto-Atmosphere",
  autoGenerating: isRu ? "AI генерирует…" : "AI generating…",
  noScene: isRu ? "Выберите сцену для авто-генерации" : "Select a scene for auto-generation",
  autoHint: isRu
    ? "AI проанализирует настроение сцены и сгенерирует фоновые звуки"
    : "AI will analyze scene mood and generate background sounds",
});

// ─── History item ──────────────────────────────────────────

interface HistoryItem {
  id: string;
  prompt: string;
  category: SoundCategory;
  sound: GeneratedSound;
  savedPath?: string;
  sceneAtmosphereId?: string; // if saved to scene_atmospheres
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
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState("");
  const [existingLayers, setExistingLayers] = useState<Array<{
    id: string;
    layer_type: string;
    prompt_used: string;
    volume: number;
    duration_ms: number;
  }>>([]);
  const [loadingExisting, setLoadingExisting] = useState(false);

  // Load existing atmosphere layers for this scene
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

  // Load on mount and sceneId change
  useState(() => { loadExisting(); });

  const handleAutoGenerate = useCallback(async () => {
    if (!sceneId) return;
    setLoading(true);
    setStep(isRu ? "Анализ сцены…" : "Analyzing scene…");

    try {
      // 1. Get AI prompts
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

      // 2. Generate sounds in parallel
      setStep(isRu ? `Генерация ${layers.length} слоёв…` : `Generating ${layers.length} layers…`);

      const results: HistoryItem[] = [];

      await Promise.all(
        layers.map(async (layer, idx) => {
          setStep(isRu ? `Генерация слоя ${idx + 1}/${layers.length}…` : `Generating layer ${idx + 1}/${layers.length}…`);

          const category: SoundCategory = layer.layer_type === "music" ? "music" : layer.layer_type === "sfx" ? "sfx" : "atmosphere";

          const sound = await generateSound({
            prompt: layer.prompt,
            category,
            durationSec: layer.duration_seconds,
            promptInfluence: category !== "music" ? 0.3 : undefined,
            lang: "en",
          });

          // 3. Save to storage
          const slug = layer.prompt
            .toLowerCase()
            .replace(/[^a-z0-9]+/gi, "-")
            .slice(0, 40);
          const fileName = `${slug}-${Date.now()}.mp3`;
          const path = await saveToStorage(sound.blob, category, fileName);

          // 4. Save to scene_atmospheres
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
        })
      );

      onGenerated(results);
      await loadExisting();
      toast.success(isRu ? `Сгенерировано ${results.length} слоёв атмосферы!` : `Generated ${results.length} atmosphere layers!`);
    } catch (e: any) {
      toast.error(e.message || (isRu ? "Ошибка авто-генерации" : "Auto-generation failed"));
    } finally {
      setLoading(false);
      setStep("");
    }
  }, [sceneId, isRu, onGenerated, loadExisting]);

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
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-3">
        <Button
          onClick={handleAutoGenerate}
          disabled={loading}
          className="gap-1.5"
          size="sm"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {loading ? step || i.autoGenerating : i.autoAtmosphere}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground/60 font-body flex items-center gap-1">
        <Sparkles className="h-3 w-3" /> {i.autoHint}
      </p>

      {/* History */}
      <ScrollArea className="flex-1 min-h-0">
        {loadingExisting ? (
          <div className="flex items-center justify-center h-16">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : existingLayers.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground font-body">
            {isRu ? "Нет атмосферных слоёв для этой сцены" : "No atmosphere layers for this scene"}
          </div>
        ) : (
          <div className="flex flex-col gap-2 pr-2">
            {existingLayers.map((layer) => (
              <div
                key={layer.id}
                className="flex items-center gap-2 p-2 rounded-md border border-border/50 bg-card/30"
              >
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {LAYER_LABELS[layer.layer_type] || layer.layer_type}
                </Badge>
                <span className="text-xs font-body truncate flex-1">{layer.prompt_used}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {Math.round(layer.duration_ms / 1000)}s
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
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

  const handleGenerated = useCallback((item: HistoryItem) => {
    setHistory((prev) => [item, ...prev]);
  }, []);

  const handleAutoGenerated = useCallback((items: HistoryItem[]) => {
    setHistory((prev) => [...items, ...prev]);
  }, []);

  return (
    <Tabs defaultValue="auto" className="h-full flex flex-col">
      <TabsList className="w-fit shrink-0 mx-4 mt-3">
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
