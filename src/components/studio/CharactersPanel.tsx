import { useState } from "react";
import { Users, UserPlus, Volume2, Loader2, Square, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Yandex SpeechKit voice registry ─────────────────────────────

interface YandexVoice {
  id: string;
  name: { ru: string; en: string };
  gender: "male" | "female";
  lang: string;
  apiVersion: "v1" | "v3" | "both";
  roles?: string[];
}

const YANDEX_VOICES: YandexVoice[] = [
  // v1+v3
  { id: "alena", name: { ru: "Алёна", en: "Alena" }, gender: "female", lang: "ru", apiVersion: "both", roles: ["neutral", "good"] },
  { id: "filipp", name: { ru: "Филипп", en: "Filipp" }, gender: "male", lang: "ru", apiVersion: "both" },
  { id: "ermil", name: { ru: "Ермил", en: "Ermil" }, gender: "male", lang: "ru", apiVersion: "both", roles: ["neutral", "good"] },
  { id: "jane", name: { ru: "Джейн", en: "Jane" }, gender: "female", lang: "ru", apiVersion: "both", roles: ["neutral", "good", "evil"] },
  { id: "madirus", name: { ru: "Мадирус", en: "Madirus" }, gender: "male", lang: "ru", apiVersion: "both" },
  { id: "omazh", name: { ru: "Омаж", en: "Omazh" }, gender: "female", lang: "ru", apiVersion: "both", roles: ["neutral", "evil"] },
  { id: "zahar", name: { ru: "Захар", en: "Zahar" }, gender: "male", lang: "ru", apiVersion: "both", roles: ["neutral", "good"] },
  // v3-only
  { id: "dasha", name: { ru: "Даша", en: "Dasha" }, gender: "female", lang: "ru", apiVersion: "v3", roles: ["neutral", "friendly", "strict"] },
  { id: "julia", name: { ru: "Юлия", en: "Julia" }, gender: "female", lang: "ru", apiVersion: "v3", roles: ["neutral", "strict"] },
  { id: "lera", name: { ru: "Лера", en: "Lera" }, gender: "female", lang: "ru", apiVersion: "v3", roles: ["neutral", "friendly"] },
  { id: "masha", name: { ru: "Маша", en: "Masha" }, gender: "female", lang: "ru", apiVersion: "v3", roles: ["neutral", "friendly", "strict"] },
  { id: "marina", name: { ru: "Марина", en: "Marina" }, gender: "female", lang: "ru", apiVersion: "v3", roles: ["neutral", "whisper", "friendly"] },
  { id: "alexander", name: { ru: "Александр", en: "Alexander" }, gender: "male", lang: "ru", apiVersion: "v3", roles: ["neutral", "good"] },
  { id: "kirill", name: { ru: "Кирилл", en: "Kirill" }, gender: "male", lang: "ru", apiVersion: "v3", roles: ["neutral", "strict", "good"] },
  { id: "anton", name: { ru: "Антон", en: "Anton" }, gender: "male", lang: "ru", apiVersion: "v3", roles: ["neutral", "good"] },
  // English
  { id: "john", name: { ru: "Джон", en: "John" }, gender: "male", lang: "en", apiVersion: "both" },
];

const ROLE_LABELS: Record<string, { ru: string; en: string }> = {
  neutral: { ru: "Нейтральный", en: "Neutral" },
  good: { ru: "Радостный", en: "Cheerful" },
  evil: { ru: "Раздражённый", en: "Irritated" },
  friendly: { ru: "Дружелюбный", en: "Friendly" },
  strict: { ru: "Строгий", en: "Strict" },
  whisper: { ru: "Шёпот", en: "Whisper" },
};

// ─── Character type ──────────────────────────────────────────────

interface Character {
  id: string;
  name: string;
  voice?: string;
  role?: string;
  pitch: number;
  speed: number;
  volume: number;
}

// ─── Component ───────────────────────────────────────────────────

interface CharactersPanelProps {
  isRu: boolean;
}

export function CharactersPanel({ isRu }: CharactersPanelProps) {
  const [characters] = useState<Character[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Demo state for voice settings (no character selected → standalone preview)
  const [voice, setVoice] = useState("marina");
  const [role, setRole] = useState("neutral");
  const [pitch, setPitch] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [volume, setVolume] = useState(0);

  const [testing, setTesting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);

  const selectedVoice = YANDEX_VOICES.find(v => v.id === voice);
  const availableRoles = selectedVoice?.roles ?? ["neutral"];

  // Reset role if not available for selected voice
  const handleVoiceChange = (v: string) => {
    setVoice(v);
    const newVoice = YANDEX_VOICES.find(x => x.id === v);
    if (newVoice?.roles && !newVoice.roles.includes(role)) {
      setRole(newVoice.roles[0] || "neutral");
    }
  };

  const handlePreview = async () => {
    if (playing && audioRef) {
      audioRef.pause();
      audioRef.currentTime = 0;
      setPlaying(false);
      return;
    }

    setTesting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error(isRu ? "Необходимо авторизоваться" : "Please sign in");
        return;
      }

      const testText = isRu
        ? "Здравствуйте. Это предварительное прослушивание голоса для вашего персонажа."
        : "Hello. This is a voice preview for your character.";

      const body: Record<string, unknown> = {
        text: testText,
        voice,
        lang: selectedVoice?.lang === "en" ? "en" : "ru",
        speed,
        role: role !== "neutral" ? role : undefined,
        pitchShift: pitch !== 0 ? pitch : undefined,
        volume: volume !== 0 ? volume : undefined,
      };

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/yandex-tts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        let errMsg = `HTTP ${response.status}`;
        try { const d = await response.json(); errMsg = d.error || errMsg; } catch {}
        throw new Error(errMsg);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      setAudioRef(audio);
      setPlaying(true);
      audio.onended = () => { setPlaying(false); URL.revokeObjectURL(url); };
      await audio.play();
    } catch (e) {
      console.error("TTS preview error:", e);
      toast.error(e instanceof Error ? e.message : (isRu ? "Ошибка TTS" : "TTS error"));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="h-full flex">
      {/* Left: character list */}
      <div className="w-56 shrink-0 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold font-display text-foreground">
            {isRu ? "Персонажи" : "Characters"}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled>
            <UserPlus className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          {characters.length === 0 ? (
            <div className="p-4 text-center">
              <Users className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">
                {isRu
                  ? "Персонажи появятся после сегментации сцен"
                  : "Characters will appear after scene segmentation"}
              </p>
            </div>
          ) : (
            <div className="p-1 space-y-0.5">
              {characters.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => setSelectedId(ch.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    selectedId === ch.id
                      ? "bg-accent/15 text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {ch.name}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right: voice settings */}
      <div className="flex-1 min-w-0 overflow-auto">
        <div className="p-4 space-y-5 max-w-lg">
          <div>
            <h3 className="text-base font-semibold font-display text-foreground mb-1">
              {isRu ? "Настройки голоса" : "Voice Settings"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {isRu ? "Yandex SpeechKit · предпрослушивание" : "Yandex SpeechKit · preview"}
            </p>
          </div>

          <Separator />

          {/* Voice selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {isRu ? "Голос" : "Voice"}
            </label>
            <Select value={voice} onValueChange={handleVoiceChange}>
              <SelectTrigger className="bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {YANDEX_VOICES.map(v => (
                  <SelectItem key={v.id} value={v.id}>
                    <div className="flex items-center gap-2">
                      <span>{isRu ? v.name.ru : v.name.en}</span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        {v.gender === "female" ? "♀" : "♂"}
                      </Badge>
                      {v.apiVersion === "v3" && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0">v3</Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Role / амплуа */}
          {availableRoles.length > 1 && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {isRu ? "Амплуа" : "Role"}
              </label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {availableRoles.map(r => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]?.[isRu ? "ru" : "en"] ?? r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Speed slider */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {isRu ? "Скорость" : "Speed"}
              </label>
              <span className="text-xs text-muted-foreground tabular-nums">{speed.toFixed(1)}×</span>
            </div>
            <div className="flex items-center gap-2">
              <Slider min={0.3} max={2.0} step={0.1} value={[speed]} onValueChange={([v]) => setSpeed(v)} className="flex-1" />
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setSpeed(1.0)} disabled={speed === 1.0} title={isRu ? "Сбросить" : "Reset"}>
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Pitch slider */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {isRu ? "Тон (pitch)" : "Pitch"}
              </label>
              <span className="text-xs text-muted-foreground tabular-nums">{pitch > 0 ? "+" : ""}{pitch} Hz</span>
            </div>
            <div className="flex items-center gap-2">
              <Slider min={-500} max={500} step={50} value={[pitch]} onValueChange={([v]) => setPitch(v)} className="flex-1" />
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setPitch(0)} disabled={pitch === 0} title={isRu ? "Сбросить" : "Reset"}>
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Volume slider */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {isRu ? "Громкость" : "Volume"}
              </label>
              <span className="text-xs text-muted-foreground tabular-nums">{volume > 0 ? "+" : ""}{volume} dB</span>
            </div>
            <div className="flex items-center gap-2">
              <Slider min={-15} max={15} step={1} value={[volume]} onValueChange={([v]) => setVolume(v)} className="flex-1" />
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setVolume(0)} disabled={volume === 0} title={isRu ? "Сбросить" : "Reset"}>
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <Separator />

          {/* Preview button */}
          <Button
            onClick={handlePreview}
            disabled={testing}
            className="gap-2"
          >
            {testing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : playing ? (
              <Square className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {playing
              ? (isRu ? "Остановить" : "Stop")
              : (isRu ? "Прослушать" : "Preview")}
          </Button>
        </div>
      </div>
    </div>
  );
}
