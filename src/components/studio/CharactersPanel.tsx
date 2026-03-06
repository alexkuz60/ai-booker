import { useState, useEffect, useCallback } from "react";
import { Users, Volume2, Loader2, Square, Play, RotateCcw, Save, Sparkles, User, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

const GENDER_LABELS: Record<string, { ru: string; en: string }> = {
  male: { ru: "Мужской ♂", en: "Male ♂" },
  female: { ru: "Женский ♀", en: "Female ♀" },
  unknown: { ru: "Не определён", en: "Unknown" },
};

const GENDER_OPTIONS = ["male", "female"] as const;

const TEMPERAMENT_OPTIONS = ["sanguine", "choleric", "melancholic", "phlegmatic", "mixed"] as const;

const AGE_LABELS: Record<string, { ru: { m: string; f: string; u: string }; en: { m: string; f: string; u: string } }> = {
  infant:  { ru: { m: "Младенец", f: "Младенец", u: "Младенец" },       en: { m: "Infant", f: "Infant", u: "Infant" } },
  child:   { ru: { m: "Мальчик", f: "Девочка", u: "Ребёнок" },         en: { m: "Boy", f: "Girl", u: "Child" } },
  teen:    { ru: { m: "Подросток", f: "Подросток", u: "Подросток" },    en: { m: "Teen boy", f: "Teen girl", u: "Teen" } },
  young:   { ru: { m: "Юноша", f: "Девушка", u: "Молодой" },           en: { m: "Young man", f: "Young woman", u: "Young" } },
  adult:   { ru: { m: "Мужчина", f: "Женщина", u: "Взрослый" },        en: { m: "Man", f: "Woman", u: "Adult" } },
  elder:   { ru: { m: "Пожилой", f: "Пожилая", u: "Пожилой" },         en: { m: "Old man", f: "Old woman", u: "Elder" } },
  unknown: { ru: { m: "Не определён", f: "Не определён", u: "Не определён" }, en: { m: "Unknown", f: "Unknown", u: "Unknown" } },
};

const AGE_OPTIONS = ["infant", "child", "teen", "young", "adult", "elder"] as const;

function getAgeLabel(ageGroup: string, gender: string, isRu: boolean): string {
  const entry = AGE_LABELS[ageGroup];
  if (!entry) return ageGroup;
  const lang = isRu ? "ru" : "en";
  const g = gender === "male" ? "m" : gender === "female" ? "f" : "u";
  return entry[lang][g];
}

const TEMPERAMENT_LABELS: Record<string, { ru: string; en: string }> = {
  sanguine: { ru: "Сангвиник", en: "Sanguine" },
  choleric: { ru: "Холерик", en: "Choleric" },
  melancholic: { ru: "Меланхолик", en: "Melancholic" },
  phlegmatic: { ru: "Флегматик", en: "Phlegmatic" },
  mixed: { ru: "Смешанный", en: "Mixed" },
};

// ─── Component ───────────────────────────────────────────

// ─── Voice Auto-Matching ─────────────────────────────────

/** Pick best Yandex voice for a character based on gender & age_group */
function matchVoice(gender: string, ageGroup: string): string {
  // Filter by gender first
  const genderVoices = gender !== "unknown"
    ? YANDEX_VOICES.filter(v => v.gender === gender)
    : YANDEX_VOICES;

  if (genderVoices.length === 0) return "marina";

  // Age-based preferences (heuristic mapping to specific voices)
  const agePrefs: Record<string, Record<string, string[]>> = {
    female: {
      child:  ["masha", "julia"],
      teen:   ["masha", "lera"],
      young:  ["dasha", "lera", "marina"],
      adult:  ["alena", "jane", "marina"],
      elder:  ["omazh", "julia"],
      infant: ["masha"],
    },
    male: {
      child:  ["filipp"],
      teen:   ["filipp", "anton"],
      young:  ["anton", "alexander"],
      adult:  ["kirill", "alexander", "madirus"],
      elder:  ["zahar", "ermil"],
      infant: ["filipp"],
    },
  };

  const g = gender === "female" ? "female" : "male";
  const prefs = agePrefs[g]?.[ageGroup];
  if (prefs) {
    const found = prefs.find(id => genderVoices.some(v => v.id === id));
    if (found) return found;
  }

  return genderVoices[0].id;
}

/** Pick a default role based on temperament */
function matchRole(voiceId: string, temperament: string | null): string {
  const v = YANDEX_VOICES.find(x => x.id === voiceId);
  if (!v?.roles || v.roles.length <= 1) return "neutral";
  
  const tempRoleMap: Record<string, string[]> = {
    sanguine: ["good", "friendly"],
    choleric: ["strict", "evil"],
    melancholic: ["neutral", "whisper"],
    phlegmatic: ["neutral", "friendly"],
  };
  
  const preferred = tempRoleMap[temperament ?? ""] ?? [];
  const found = preferred.find(r => v.roles!.includes(r));
  return found ?? "neutral";
}

interface CharactersPanelProps {
  isRu: boolean;
  bookId?: string | null;
  sceneId?: string | null;
}

export function CharactersPanel({ isRu, bookId, sceneId }: CharactersPanelProps) {
  const [characters, setCharacters] = useState<BookCharacter[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profiling, setProfiling] = useState(false);
  const [casting, setCasting] = useState(false);

  // Voice settings state
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
  const hasProfiles = characters.some(c => c.description);

  // ── Load characters from DB ─────────────────────────────
  const loadCharacters = useCallback(async () => {
    if (!bookId) { setCharacters([]); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("book_characters")
        .select("*")
        .eq("book_id", bookId)
        .order("sort_order");
      if (error) throw error;

      if (sceneId && data && data.length > 0) {
        const { data: appearances } = await supabase
          .from("character_appearances")
          .select("character_id")
          .eq("scene_id", sceneId);
        const sceneCharIds = new Set(appearances?.map(a => a.character_id) || []);
        const sorted = [
          ...data.filter(c => sceneCharIds.has(c.id)),
          ...data.filter(c => !sceneCharIds.has(c.id)),
        ];
        setCharacters(sorted.map(c => ({ ...c, voice_config: (c.voice_config as BookCharacter["voice_config"]) || {} })));
      } else {
        setCharacters((data || []).map(c => ({ ...c, voice_config: (c.voice_config as BookCharacter["voice_config"]) || {} })));
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

  // ── AI Profiling ────────────────────────────────────────
  const handleProfile = async () => {
    if (!bookId) return;
    setProfiling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error(isRu ? "Необходимо авторизоваться" : "Please sign in");
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/profile-characters`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ book_id: bookId, language: isRu ? "ru" : "en" }),
        }
      );

      if (!response.ok) {
        const d = await response.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      toast.success(
        isRu
          ? `Профайлинг завершён: ${result.profiled} из ${result.total} персонажей`
          : `Profiling complete: ${result.profiled} of ${result.total} characters`
      );
      await loadCharacters();
    } catch (e) {
      console.error("Profiling error:", e);
      toast.error(e instanceof Error ? e.message : (isRu ? "Ошибка профайлинга" : "Profiling error"));
    } finally {
      setProfiling(false);
    }
  };

  // ── Save voice config ───────────────────────────────────
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

  // ── Auto-cast voices for all characters ─────────────────
  const handleAutoCast = async () => {
    if (characters.length === 0) return;
    setCasting(true);
    try {
      // Track used voice IDs to avoid duplicates where possible
      const usedVoices = new Set<string>();
      const updates: { id: string; voice_config: BookCharacter["voice_config"] }[] = [];

      for (const ch of characters) {
        let voiceId = matchVoice(ch.gender, ch.age_group);

        // Try to avoid duplicates: pick alternate from same gender
        const genderVoices = YANDEX_VOICES.filter(v =>
          ch.gender !== "unknown" ? v.gender === ch.gender : true
        );
        if (usedVoices.has(voiceId) && genderVoices.length > 1) {
          const alt = genderVoices.find(v => !usedVoices.has(v.id));
          if (alt) voiceId = alt.id;
        }
        usedVoices.add(voiceId);

        const roleId = matchRole(voiceId, ch.temperament);
        const vc: BookCharacter["voice_config"] = {
          provider: "yandex",
          voice_id: voiceId,
          role: roleId !== "neutral" ? roleId : undefined,
          speed: 1.0,
        };
        updates.push({ id: ch.id, voice_config: vc });
      }

      // Batch save to DB
      for (const u of updates) {
        await supabase
          .from("book_characters")
          .update({ voice_config: u.voice_config, updated_at: new Date().toISOString() })
          .eq("id", u.id);
      }

      // Update local state
      setCharacters(prev => prev.map(c => {
        const u = updates.find(x => x.id === c.id);
        return u ? { ...c, voice_config: u.voice_config } : c;
      }));

      // Sync current selection
      if (selectedId) {
        const u = updates.find(x => x.id === selectedId);
        if (u) {
          setVoice(u.voice_config.voice_id || "marina");
          setRole(u.voice_config.role || "neutral");
          setSpeed(u.voice_config.speed ?? 1.0);
          setPitch(u.voice_config.pitch ?? 0);
          setVolume(u.voice_config.volume ?? 0);
          setDirty(false);
        }
      }

      toast.success(
        isRu
          ? `Голоса подобраны для ${updates.length} персонажей`
          : `Voices matched for ${updates.length} characters`
      );
    } catch (e) {
      console.error("Auto-cast error:", e);
      toast.error(isRu ? "Ошибка подбора" : "Casting error");
    } finally {
      setCasting(false);
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
      if (!session) { toast.error(isRu ? "Необходимо авторизоваться" : "Please sign in"); return; }

      const testText = isRu
        ? "Здравствуйте. Это предварительное прослушивание голоса для вашего персонажа."
        : "Hello. This is a voice preview for your character.";

      const body: Record<string, unknown> = {
        text: testText, voice, lang: selectedVoice?.lang === "en" ? "en" : "ru", speed,
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
        <div className="p-3 border-b border-border flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold font-display text-foreground">
              {isRu ? "Персонажи" : "Characters"}
            </span>
            {characters.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {characters.length}
              </Badge>
            )}
          </div>
          {characters.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 text-xs"
              onClick={handleProfile}
              disabled={profiling}
            >
              {profiling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {profiling
                ? (isRu ? "Анализ..." : "Profiling...")
                : hasProfiles
                  ? (isRu ? "Обновить профили" : "Re-profile")
                  : (isRu ? "AI-профайлинг" : "AI Profile")}
            </Button>
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
                    <span className="truncate font-medium">{ch.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {ch.description && <User className="h-3 w-3 text-primary/60" />}
                      {ch.voice_config?.voice_id && <Volume2 className="h-3 w-3 text-primary/60" />}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {ch.gender !== "unknown" && (
                      <span className="text-[10px] text-muted-foreground/60">
                        {ch.gender === "female" ? "♀" : "♂"}
                      </span>
                    )}
                    {ch.temperament && (
                      <span className="text-[10px] text-muted-foreground/50 truncate">
                        {TEMPERAMENT_LABELS[ch.temperament]?.[isRu ? "ru" : "en"] ?? ch.temperament}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right: two-column layout — Profile + Voice */}
      <div className="flex-1 min-w-0 overflow-hidden flex">
        {/* Column 1: Profile */}
        <div className="flex-1 min-w-0 border-r border-border">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <h3 className="text-xs font-semibold font-display text-muted-foreground uppercase tracking-wider">
                {isRu ? "Профайл" : "Profile"}
              </h3>

              {selectedChar ? (
                <>
                  <div>
                    <h4 className="text-base font-semibold font-display text-foreground mb-2">
                      {selectedChar.name}
                    </h4>
                    {selectedChar.description && (
                      <p className="text-sm text-foreground/90 leading-relaxed mb-3">
                        {selectedChar.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 mb-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="inline-flex items-center">
                            <Badge
                              variant="outline"
                              className={`text-xs cursor-pointer transition-colors hover:bg-accent/20 ${
                                selectedChar.gender === "unknown" ? "border-dashed border-warning text-warning" : ""
                              }`}
                            >
                              {GENDER_LABELS[selectedChar.gender]?.[isRu ? "ru" : "en"] ?? selectedChar.gender}
                              {selectedChar.gender === "unknown" && " ▾"}
                            </Badge>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-1.5" align="start">
                          <div className="grid gap-0.5">
                            {GENDER_OPTIONS.map(g => (
                              <button
                                key={g}
                                className={`px-3 py-1.5 text-xs rounded-md text-left transition-colors ${
                                  selectedChar.gender === g
                                    ? "bg-accent text-accent-foreground"
                                    : "hover:bg-muted text-foreground"
                                }`}
                                onClick={async () => {
                                  const charId = selectedChar.id;
                                  setCharacters(prev => prev.map(c =>
                                    c.id === charId ? { ...c, gender: g } : c
                                  ));
                                  try {
                                    const { error } = await supabase
                                      .from("book_characters")
                                      .update({ gender: g, updated_at: new Date().toISOString() })
                                      .eq("id", charId);
                                    if (error) throw error;
                                    toast.success(isRu ? "Пол сохранён" : "Gender saved");
                                  } catch {
                                    toast.error(isRu ? "Ошибка сохранения" : "Save error");
                                    loadCharacters();
                                  }
                                }}
                              >
                                {GENDER_LABELS[g]?.[isRu ? "ru" : "en"]}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="inline-flex items-center">
                            <Badge
                              variant="outline"
                              className={`text-xs cursor-pointer transition-colors hover:bg-accent/20 ${
                                selectedChar.age_group === "unknown" ? "border-dashed border-warning text-warning" : ""
                              }`}
                            >
                              {getAgeLabel(selectedChar.age_group, selectedChar.gender, isRu)}
                              {selectedChar.age_group === "unknown" && " ▾"}
                            </Badge>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-1.5" align="start">
                          <div className="grid gap-0.5">
                            {AGE_OPTIONS.map(age => (
                              <button
                                key={age}
                                className={`px-3 py-1.5 text-xs rounded-md text-left transition-colors ${
                                  selectedChar.age_group === age
                                    ? "bg-accent text-accent-foreground"
                                    : "hover:bg-muted text-foreground"
                                }`}
                                onClick={async () => {
                                  const charId = selectedChar.id;
                                  setCharacters(prev => prev.map(c =>
                                    c.id === charId ? { ...c, age_group: age } : c
                                  ));
                                  try {
                                    const { error } = await supabase
                                      .from("book_characters")
                                      .update({ age_group: age, updated_at: new Date().toISOString() })
                                      .eq("id", charId);
                                    if (error) throw error;
                                    toast.success(isRu ? "Возраст сохранён" : "Age saved");
                                  } catch {
                                    toast.error(isRu ? "Ошибка сохранения" : "Save error");
                                    loadCharacters();
                                  }
                                }}
                              >
                                {getAgeLabel(age, selectedChar.gender, isRu)}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="inline-flex items-center">
                            <Badge
                              variant="secondary"
                              className={`text-xs cursor-pointer transition-colors hover:bg-accent/20 ${
                                !selectedChar.temperament ? "border-dashed border-warning text-warning" : ""
                              }`}
                            >
                              {selectedChar.temperament
                                ? (TEMPERAMENT_LABELS[selectedChar.temperament]?.[isRu ? "ru" : "en"] ?? selectedChar.temperament)
                                : (isRu ? "Темперамент ▾" : "Temperament ▾")}
                            </Badge>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-1.5" align="start">
                          <div className="grid gap-0.5">
                            {TEMPERAMENT_OPTIONS.map(t => (
                              <button
                                key={t}
                                className={`px-3 py-1.5 text-xs rounded-md text-left transition-colors ${
                                  selectedChar.temperament === t
                                    ? "bg-accent text-accent-foreground"
                                    : "hover:bg-muted text-foreground"
                                }`}
                                onClick={async () => {
                                  const charId = selectedChar.id;
                                  setCharacters(prev => prev.map(c =>
                                    c.id === charId ? { ...c, temperament: t } : c
                                  ));
                                  try {
                                    const { error } = await supabase
                                      .from("book_characters")
                                      .update({ temperament: t, updated_at: new Date().toISOString() })
                                      .eq("id", charId);
                                    if (error) throw error;
                                    toast.success(isRu ? "Темперамент сохранён" : "Temperament saved");
                                  } catch {
                                    toast.error(isRu ? "Ошибка сохранения" : "Save error");
                                    loadCharacters();
                                  }
                                }}
                              >
                                {TEMPERAMENT_LABELS[t]?.[isRu ? "ru" : "en"]}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    {selectedChar.speech_style && (
                      <div className="mt-2">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          {isRu ? "Стиль речи" : "Speech Style"}
                        </span>
                        <p className="text-xs text-muted-foreground mt-1 italic">
                          {selectedChar.speech_style}
                        </p>
                      </div>
                    )}
                    {selectedChar.aliases.length > 0 && (
                      <div className="mt-2">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          {isRu ? "Также известен как" : "Also known as"}
                        </span>
                        <p className="text-xs text-muted-foreground mt-1">
                          {selectedChar.aliases.join(", ")}
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  {isRu ? "Выберите персонажа" : "Select a character"}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Column 2: Voice */}
        <div className="flex-1 min-w-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <h3 className="text-xs font-semibold font-display text-muted-foreground uppercase tracking-wider">
                {isRu ? "Голос" : "Voice"}
              </h3>

              <div>
                <p className="text-xs text-muted-foreground mb-3">
                  {isRu ? "Yandex SpeechKit · предпрослушивание" : "Yandex SpeechKit · preview"}
                </p>
              </div>

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

              {/* Role */}
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

              {/* Speed */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "Скорость" : "Speed"}</label>
                  <span className="text-xs text-muted-foreground tabular-nums">{speed.toFixed(1)}×</span>
                </div>
                <div className="flex items-center gap-2">
                  <Slider min={0.3} max={2.0} step={0.1} value={[speed]} onValueChange={([v]) => { setSpeed(v); markDirty(); }} className="flex-1" />
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { setSpeed(1.0); markDirty(); }} disabled={speed === 1.0}>
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Pitch */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "Тон (pitch)" : "Pitch"}</label>
                  <span className="text-xs text-muted-foreground tabular-nums">{pitch > 0 ? "+" : ""}{pitch} Hz</span>
                </div>
                <div className="flex items-center gap-2">
                  <Slider min={-500} max={500} step={50} value={[pitch]} onValueChange={([v]) => { setPitch(v); markDirty(); }} className="flex-1" />
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { setPitch(0); markDirty(); }} disabled={pitch === 0}>
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Volume */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "Громкость" : "Volume"}</label>
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
                <Button onClick={handlePreview} disabled={testing} variant="outline" className="gap-2">
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {playing ? (isRu ? "Стоп" : "Stop") : (isRu ? "Прослушать" : "Preview")}
                </Button>
                {selectedId && (
                  <Button onClick={handleSave} disabled={saving || !dirty} className="gap-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {isRu ? "Сохранить" : "Save"}
                  </Button>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
