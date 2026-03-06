import { useState, useEffect, useCallback } from "react";
import { Users, UserPlus, Volume2, Loader2, Square, Play, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { YANDEX_VOICES, ROLE_LABELS } from "@/config/yandexVoices";

// ─── Types ──────────────────────────────────────────────

interface BookCharacter {
  id: string;
  name: string;
  aliases: string[];
  gender: string;
  age_group: string;
  temperament: string | null;
  speech_style: string | null;
  description: string | null;
  voice_config: {
    provider?: string;
    voice_id?: string;
    role?: string;
    speed?: number;
    pitch?: number;
    volume?: number;
  };
  color: string | null;
  sort_order: number;
}

// ─── Component ───────────────────────────────────────────

interface CharactersPanelProps {
  isRu: boolean;
  bookId?: string | null;
  sceneId?: string | null;
}

export function CharactersPanel({ isRu, bookId, sceneId }: CharactersPanelProps) {
  const [characters, setCharacters] = useState<BookCharacter[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Voice settings state (bound to selected character)
  const [voice, setVoice] = useState("marina");
  const [role, setRole] = useState("neutral");
  const [pitch, setPitch] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [volume, setVolume] = useState(0);
  const [dirty, setDirty] = useState(false);

  const [testing, setTesting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedVoice = YANDEX_VOICES.find(v => v.id === voice);
  const availableRoles = selectedVoice?.roles ?? ["neutral"];
  const selectedChar = characters.find(c => c.id === selectedId);

  // ── Load characters from DB ─────────────────────────────
  const loadCharacters = useCallback(async () => {
    if (!bookId) { setCharacters([]); return; }
    setLoading(true);
    try {
      let query = supabase
        .from("book_characters")
        .select("*")
        .eq("book_id", bookId)
        .order("sort_order");

      const { data, error } = await query;
      if (error) throw error;

      // If sceneId provided, filter to characters appearing in this scene
      if (sceneId && data && data.length > 0) {
        const { data: appearances } = await supabase
          .from("character_appearances")
          .select("character_id")
          .eq("scene_id", sceneId);
        
        const sceneCharIds = new Set(appearances?.map(a => a.character_id) || []);
        // Show scene characters first, then all others dimmed
        const sorted = [
          ...data.filter(c => sceneCharIds.has(c.id)),
          ...data.filter(c => !sceneCharIds.has(c.id)),
        ];
        setCharacters(sorted.map(c => ({
          ...c,
          voice_config: (c.voice_config as BookCharacter["voice_config"]) || {},
        })));
      } else {
        setCharacters((data || []).map(c => ({
          ...c,
          voice_config: (c.voice_config as BookCharacter["voice_config"]) || {},
        })));
      }
    } catch (e) {
      console.error("Load characters error:", e);
    } finally {
      setLoading(false);
    }
  }, [bookId, sceneId]);

  useEffect(() => { loadCharacters(); }, [loadCharacters]);

  // ── Sync voice settings when character selected ─────────
  useEffect(() => {
    if (!selectedChar) return;
    const vc = selectedChar.voice_config;
    setVoice(vc.voice_id || "marina");
    setRole(vc.role || "neutral");
    setSpeed(vc.speed ?? 1.0);
    setPitch(vc.pitch ?? 0);
    setVolume(vc.volume ?? 0);
    setDirty(false);
  }, [selectedId]);

  const markDirty = () => setDirty(true);

  const handleVoiceChange = (v: string) => {
    setVoice(v);
    markDirty();
    const newVoice = YANDEX_VOICES.find(x => x.id === v);
    if (newVoice?.roles && !newVoice.roles.includes(role)) {
      setRole(newVoice.roles[0] || "neutral");
    }
  };

  // ── Save voice config to DB ─────────────────────────────
  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const voiceConfig = {
        provider: "yandex",
        voice_id: voice,
        role: role !== "neutral" ? role : undefined,
        speed,
        pitch: pitch !== 0 ? pitch : undefined,
        volume: volume !== 0 ? volume : undefined,
      };
      const { error } = await supabase
        .from("book_characters")
        .update({ voice_config: voiceConfig, updated_at: new Date().toISOString() })
        .eq("id", selectedId);
      if (error) throw error;
      setDirty(false);
      // Update local state
      setCharacters(prev => prev.map(c =>
        c.id === selectedId ? { ...c, voice_config: voiceConfig } : c
      ));
      toast.success(isRu ? "Голос сохранён" : "Voice saved");
    } catch (e) {
      toast.error(isRu ? "Ошибка сохранения" : "Save error");
    } finally {
      setSaving(false);
    }
  };

  // ── TTS Preview ─────────────────────────────────────────
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
          {characters.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {characters.length}
            </Badge>
          )}
        </div>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="p-4 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : characters.length === 0 ? (
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
                  <div className="flex items-center gap-2">
                    <span className="truncate">{ch.name}</span>
                    {ch.voice_config?.voice_id && (
                      <Volume2 className="h-3 w-3 shrink-0 text-primary/60" />
                    )}
                  </div>
                  {ch.gender !== "unknown" && (
                    <span className="text-[10px] text-muted-foreground/60">
                      {ch.gender === "female" ? "♀" : "♂"}
                    </span>
                  )}
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
              {selectedChar
                ? `${isRu ? "Голос:" : "Voice:"} ${selectedChar.name}`
                : (isRu ? "Настройки голоса" : "Voice Settings")}
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
              <Select value={role} onValueChange={v => { setRole(v); markDirty(); }}>
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
              <Slider min={0.3} max={2.0} step={0.1} value={[speed]} onValueChange={([v]) => { setSpeed(v); markDirty(); }} className="flex-1" />
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { setSpeed(1.0); markDirty(); }} disabled={speed === 1.0}>
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
              <Slider min={-500} max={500} step={50} value={[pitch]} onValueChange={([v]) => { setPitch(v); markDirty(); }} className="flex-1" />
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { setPitch(0); markDirty(); }} disabled={pitch === 0}>
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
              <Slider min={-15} max={15} step={1} value={[volume]} onValueChange={([v]) => { setVolume(v); markDirty(); }} className="flex-1" />
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { setVolume(0); markDirty(); }} disabled={volume === 0}>
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <Separator />

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              onClick={handlePreview}
              disabled={testing}
              variant="outline"
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
                ? (isRu ? "Стоп" : "Stop")
                : (isRu ? "Прослушать" : "Preview")}
            </Button>

            {selectedId && (
              <Button
                onClick={handleSave}
                disabled={saving || !dirty}
                className="gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {isRu ? "Сохранить" : "Save"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
