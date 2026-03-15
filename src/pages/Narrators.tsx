import { motion } from "framer-motion";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Volume2, Loader2, Play, Square, Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLanguage } from "@/hooks/useLanguage";
import { usePageHeader } from "@/hooks/usePageHeader";
import { YANDEX_VOICES, ROLE_LABELS } from "@/config/yandexVoices";
import { ELEVENLABS_VOICES } from "@/config/elevenlabsVoices";
import { SALUTESPEECH_VOICES } from "@/config/salutespeechVoices";
import { PROXYAPI_TTS_VOICES, PROXYAPI_TTS_MODELS, getVoicesForModel } from "@/config/proxyapiVoices";
import { ElevenLabsCreditsWidget } from "@/components/studio/ElevenLabsCreditsWidget";
import { useSaveBookToProject } from "@/hooks/useSaveBookToProject";
import { SaveBookButton } from "@/components/SaveBookButton";

// ─── Types ──────────────────────────────────────────────

interface BookCharacter {
  id: string;
  name: string;
  gender: string;
  age_group: string;
  temperament: string | null;
  voice_config: Record<string, unknown>;
}

interface BookOption {
  id: string;
  title: string;
}

// ─── Voice matching helpers ─────────────────────────────

function matchVoice(gender: string, ageGroup: string): string {
  const genderVoices = gender !== "unknown"
    ? YANDEX_VOICES.filter(v => v.gender === gender)
    : YANDEX_VOICES;
  if (genderVoices.length === 0) return "marina";
  const agePrefs: Record<string, Record<string, string[]>> = {
    female: {
      child: ["masha", "julia"], teen: ["masha", "lera"], young: ["dasha", "lera", "marina"],
      adult: ["alena", "jane", "marina"], elder: ["omazh", "julia"], infant: ["masha"],
    },
    male: {
      child: ["filipp"], teen: ["filipp", "anton"], young: ["anton", "alexander"],
      adult: ["kirill", "alexander", "madirus"], elder: ["zahar", "ermil"], infant: ["filipp"],
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

function matchRole(voiceId: string, temperament: string | null): string {
  const v = YANDEX_VOICES.find(x => x.id === voiceId);
  if (!v?.roles || v.roles.length <= 1) return "neutral";
  const tempRoleMap: Record<string, string[]> = {
    sanguine: ["good", "friendly"], choleric: ["strict", "evil"],
    melancholic: ["neutral", "whisper"], phlegmatic: ["neutral", "friendly"],
  };
  const preferred = tempRoleMap[temperament ?? ""] ?? [];
  const found = preferred.find(r => v.roles!.includes(r));
  return found ?? "neutral";
}

// ─── Component ──────────────────────────────────────────────

const Narrators = () => {
  const { isRu } = useLanguage();
  const { setPageHeader } = usePageHeader();

  // Book & character selection
  const [books, setBooks] = useState<BookOption[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [characters, setCharacters] = useState<BookCharacter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Voice state — Yandex
  const [voice, setVoice] = useState("marina");
  const [role, setRole] = useState("neutral");
  const [pitch, setPitch] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [volume, setVolume] = useState(0);

  // Voice state — ElevenLabs
  const [elVoice, setElVoice] = useState("JBFqnCBsd6RMkjVDRZzb");
  const [elStability, setElStability] = useState(0.5);
  const [elSimilarity, setElSimilarity] = useState(0.75);
  const [elStyle, setElStyle] = useState(0.4);
  const [elSpeed, setElSpeed] = useState(0.95);

  // Voice state — ProxyAPI
  const [paVoice, setPaVoice] = useState("alloy");
  const [paModel, setPaModel] = useState("gpt-4o-mini-tts");
  const [paSpeed, setPaSpeed] = useState(1.0);
  const [paInstructions, setPaInstructions] = useState("");

  // Voice state — SaluteSpeech
  const [ssVoice, setSsVoice] = useState("Nec_24000");
  const [ssSpeed, setSsSpeed] = useState(1.0);

  const [voiceProvider, setVoiceProvider] = useState<"yandex" | "elevenlabs" | "proxyapi" | "salutespeech">("yandex");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);

  // ElevenLabs credits
  const [elCredits, setElCredits] = useState<{ used: number; limit: number; tier: string } | null>(null);
  const [elCreditsLoading, setElCreditsLoading] = useState(false);

  const selectedChar = characters.find(c => c.id === selectedId);
  const selectedVoice = YANDEX_VOICES.find(v => v.id === voice);
  const availableRoles = selectedVoice?.roles ?? ["neutral"];
  const markDirty = () => setDirty(true);
  const { saveBook, saving: savingBook } = useSaveBookToProject({
    isRu,
    currentBookId: selectedBookId,
  });

  const headerRight = useMemo(
    () => <SaveBookButton isRu={isRu} onClick={saveBook} loading={savingBook} disabled={!selectedBookId} />,
    [isRu, saveBook, savingBook, selectedBookId],
  );

  // Page header
  useEffect(() => {
    setPageHeader({
      title: isRu ? "Дикторы" : "Narrators",
      subtitle: isRu ? "Библиотека голосов и настройка TTS-провайдеров" : "Voice library and TTS provider settings",
      headerRight,
    });
    return () => setPageHeader({});
  }, [isRu, headerRight, setPageHeader]);

  // Load books
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("books")
        .select("id, title")
        .order("updated_at", { ascending: false });
      if (data) {
        setBooks(data);
        if (data.length > 0 && !selectedBookId) setSelectedBookId(data[0].id);
      }
    })();
  }, []);

  // Load characters for selected book
  const loadCharacters = useCallback(async () => {
    if (!selectedBookId) { setCharacters([]); return; }
    setLoading(true);
    try {
      const { data } = await supabase
        .from("book_characters")
        .select("id, name, gender, age_group, temperament, voice_config")
        .eq("book_id", selectedBookId)
        .order("sort_order");
      setCharacters((data || []).map(c => ({
        ...c,
        voice_config: (c.voice_config as Record<string, unknown>) || {},
      })));
    } finally {
      setLoading(false);
    }
  }, [selectedBookId]);

  useEffect(() => { loadCharacters(); }, [loadCharacters]);

  // Sync voice fields when character selected
  useEffect(() => {
    if (!selectedChar) return;
    const vc = selectedChar.voice_config;
    const provider = (vc.provider as string) || "yandex";
    setVoiceProvider(provider === "elevenlabs" ? "elevenlabs" : provider === "proxyapi" ? "proxyapi" : provider === "salutespeech" ? "salutespeech" : "yandex");

    if (provider === "salutespeech") {
      setSsVoice((vc.voice_id as string) || "Nec_24000");
      setSsSpeed((vc.speed as number) ?? 1.0);
    } else if (provider === "proxyapi") {
      setPaVoice((vc.voice_id as string) || "alloy");
      setPaModel((vc.model as string) || "gpt-4o-mini-tts");
      setPaSpeed((vc.speed as number) ?? 1.0);
      setPaInstructions((vc.instructions as string) || "");
    } else if (provider === "elevenlabs") {
      setElVoice((vc.voice_id as string) || "JBFqnCBsd6RMkjVDRZzb");
      setElStability((vc.stability as number) ?? 0.5);
      setElSimilarity((vc.similarity_boost as number) ?? 0.75);
      setElStyle((vc.style as number) ?? 0.4);
      setElSpeed((vc.speed as number) ?? 0.95);
    } else {
      let voiceId = (vc.voice_id as string) || "marina";
      const savedVoice = YANDEX_VOICES.find(v => v.id === voiceId);
      if (savedVoice && selectedChar.gender !== "unknown" && savedVoice.gender !== selectedChar.gender) {
        voiceId = matchVoice(selectedChar.gender, selectedChar.age_group);
      }
      setVoice(voiceId);
      const currentVoice = YANDEX_VOICES.find(v => v.id === voiceId);
      setRole(currentVoice?.roles?.includes((vc.role as string) || "") ? ((vc.role as string) || "neutral") : (currentVoice?.roles?.[0] || (vc.role as string) || "neutral"));
      setSpeed((vc.speed as number) ?? 1.0);
      setPitch((vc.pitch as number) ?? 0);
      setVolume((vc.volume as number) ?? 0);
    }
    setDirty(false);
  }, [selectedId]);

  // Save voice config
  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const currentChar = characters.find(c => c.id === selectedId);
      const isExtra = currentChar?.voice_config?.is_extra as boolean | undefined;
      const voiceConfig = voiceProvider === "salutespeech"
        ? { provider: "salutespeech", voice_id: ssVoice, speed: ssSpeed, is_extra: isExtra }
        : voiceProvider === "proxyapi"
        ? { provider: "proxyapi", voice_id: paVoice, model: paModel, speed: paSpeed, instructions: paInstructions || undefined, is_extra: isExtra }
        : voiceProvider === "elevenlabs"
        ? { provider: "elevenlabs", voice_id: elVoice, stability: elStability, similarity_boost: elSimilarity, style: elStyle, speed: elSpeed, is_extra: isExtra }
        : { provider: "yandex", voice_id: voice, role: role !== "neutral" ? role : undefined, speed, pitch: pitch !== 0 ? pitch : undefined, volume: volume !== 0 ? volume : undefined, is_extra: isExtra };

      const { error } = await supabase
        .from("book_characters")
        .update({ voice_config: voiceConfig, updated_at: new Date().toISOString() })
        .eq("id", selectedId);
      if (error) throw error;
      setDirty(false);
      setCharacters(prev => prev.map(c => c.id === selectedId ? { ...c, voice_config: voiceConfig } : c));
      toast.success(isRu ? "Голос сохранён" : "Voice saved");
    } catch {
      toast.error(isRu ? "Ошибка сохранения" : "Save error");
    } finally {
      setSaving(false);
    }
  };

  // TTS Preview
  const handlePreview = async () => {
    if (playing && audioRef) {
      audioRef.pause(); audioRef.currentTime = 0; setPlaying(false); return;
    }
    setTesting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error(isRu ? "Необходимо авторизоваться" : "Please sign in"); return; }
      const testText = isRu
        ? "Здравствуйте. Это предварительное прослушивание голоса для вашего персонажа."
        : "Hello. This is a voice preview for your character.";
      let response: Response;

      if (voiceProvider === "salutespeech") {
        response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/salutespeech-tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ text: testText, voice: ssVoice, lang: isRu ? "ru" : "en" }),
        });
      } else if (voiceProvider === "proxyapi") {
        const paBody: Record<string, unknown> = { text: testText, model: paModel, voice: paVoice, speed: paSpeed, lang: isRu ? "ru" : "en" };
        if (paInstructions && paModel === "gpt-4o-mini-tts") paBody.instructions = paInstructions;
        response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/proxyapi-tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify(paBody),
        });
      } else if (voiceProvider === "elevenlabs") {
        response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ text: testText, voiceId: elVoice, lang: isRu ? "ru" : "en" }),
        });
      } else {
        const body: Record<string, unknown> = { text: testText, voice, lang: selectedVoice?.lang === "en" ? "en" : "ru", speed, role: role !== "neutral" ? role : undefined, pitchShift: pitch !== 0 ? pitch : undefined, volume: volume !== 0 ? volume : undefined };
        response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/yandex-tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify(body),
        });
      }
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
      toast.error(e instanceof Error ? e.message : (isRu ? "Ошибка TTS" : "TTS error"));
    } finally {
      setTesting(false);
    }
  };

  // Load EL credits
  const loadElCredits = useCallback(async () => {
    setElCreditsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-credits`, {
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.access_token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setElCredits({ used: data.character_count, limit: data.character_limit, tier: data.tier });
      }
    } finally { setElCreditsLoading(false); }
  }, []);

  useEffect(() => {
    if (voiceProvider === "elevenlabs" && !elCredits && !elCreditsLoading) loadElCredits();
  }, [voiceProvider]);

  const handleVoiceChange = (v: string) => {
    setVoice(v); markDirty();
    const newVoice = YANDEX_VOICES.find(x => x.id === v);
    if (newVoice?.roles && !newVoice.roles.includes(role)) setRole(newVoice.roles[0] || "neutral");
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex h-[calc(100vh-3rem)] min-h-0 overflow-hidden">
      {/* Left: Book + Character list */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border space-y-2">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Книга" : "Book"}
          </label>
          <Select value={selectedBookId ?? ""} onValueChange={v => { setSelectedBookId(v); setSelectedId(null); }}>
            <SelectTrigger className="bg-secondary border-border text-xs h-8">
              <SelectValue placeholder={isRu ? "Выберите книгу" : "Select book"} />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              {books.map(b => (
                <SelectItem key={b.id} value={b.id} className="text-xs">{b.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="p-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : characters.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              {isRu ? "Нет персонажей" : "No characters"}
            </div>
          ) : (
            <div className="p-1 space-y-0.5">
              {characters.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => setSelectedId(selectedId === ch.id ? null : ch.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    selectedId === ch.id
                      ? "bg-accent/15 text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{ch.name}</span>
                    {ch.gender !== "unknown" && (
                      <span className="text-[10px] text-muted-foreground/60">
                        {ch.gender === "female" ? "♀" : "♂"}
                      </span>
                    )}
                    {(ch.voice_config as any)?.voice_id && <Volume2 className="h-3 w-3 text-primary/60 shrink-0" />}
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right: Voice editor */}
      <div className="flex-1 min-w-0">
        <ScrollArea className="h-full">
          <div className="p-6 max-w-2xl space-y-6">
            {selectedChar ? (
              <>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-display font-semibold text-foreground">{selectedChar.name}</h2>
                  {selectedChar.gender !== "unknown" && (
                    <Badge variant="outline" className="text-xs">
                      {selectedChar.gender === "female" ? "♀" : "♂"}
                    </Badge>
                  )}
                </div>

                <Tabs value={voiceProvider} onValueChange={v => { setVoiceProvider(v as typeof voiceProvider); markDirty(); }}>
                  <TabsList className="w-full">
                    <TabsTrigger value="yandex" className="flex-1 text-xs">Yandex</TabsTrigger>
                    <TabsTrigger value="salutespeech" className="flex-1 text-xs">Salute</TabsTrigger>
                    <TabsTrigger value="elevenlabs" className="flex-1 text-xs">ElevenLabs</TabsTrigger>
                    <TabsTrigger value="proxyapi" className="flex-1 text-xs">OpenAI</TabsTrigger>
                  </TabsList>

                  {/* ─── Yandex ─── */}
                  <TabsContent value="yandex" className="space-y-4 mt-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "Голос" : "Voice"}</label>
                      <Select value={voice} onValueChange={handleVoiceChange}>
                        <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {YANDEX_VOICES.map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              <div className="flex items-center gap-2">
                                <span>{isRu ? v.name.ru : v.name.en}</span>
                                <Badge variant="outline" className="text-[10px] px-1 py-0">{v.gender === "female" ? "♀" : "♂"}</Badge>
                                {v.apiVersion === "v3" && <Badge variant="secondary" className="text-[10px] px-1 py-0">v3</Badge>}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {availableRoles.length > 1 && (
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "Амплуа" : "Role"}</label>
                        <Select value={role} onValueChange={v => { setRole(v); markDirty(); }}>
                          <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            {availableRoles.map(r => (
                              <SelectItem key={r} value={r}>{ROLE_LABELS[r]?.[isRu ? "ru" : "en"] ?? r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <SliderField label={isRu ? "Скорость" : "Speed"} value={speed} min={0.3} max={2.0} step={0.1} suffix="×" default_={1.0} onChange={v => { setSpeed(v); markDirty(); }} onReset={() => { setSpeed(1.0); markDirty(); }} />
                    <SliderField label={isRu ? "Тон (pitch)" : "Pitch"} value={pitch} min={-500} max={500} step={50} suffix=" Hz" default_={0} showSign onChange={v => { setPitch(v); markDirty(); }} onReset={() => { setPitch(0); markDirty(); }} />
                    <SliderField label={isRu ? "Громкость" : "Volume"} value={volume} min={-15} max={15} step={1} suffix=" dB" default_={0} showSign onChange={v => { setVolume(v); markDirty(); }} onReset={() => { setVolume(0); markDirty(); }} />
                  </TabsContent>

                  {/* ─── SaluteSpeech ─── */}
                  <TabsContent value="salutespeech" className="space-y-4 mt-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "Голос" : "Voice"}</label>
                      <Select value={ssVoice} onValueChange={v => { setSsVoice(v); markDirty(); }}>
                        <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border max-h-64">
                          {SALUTESPEECH_VOICES.map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              <div className="flex items-center gap-2">
                                <span>{isRu ? v.name.ru : v.name.en}</span>
                                <Badge variant="outline" className="text-[10px] px-1 py-0">{v.gender === "female" ? "♀" : "♂"}</Badge>
                                <span className="text-[10px] text-muted-foreground">{isRu ? v.description.ru : v.description.en}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <SliderField label={isRu ? "Скорость" : "Speed"} value={ssSpeed} min={0.5} max={2.0} step={0.1} suffix="×" default_={1.0} onChange={v => { setSsSpeed(v); markDirty(); }} onReset={() => { setSsSpeed(1.0); markDirty(); }} />
                    <div className="rounded-md border border-border bg-muted/30 p-2.5">
                      <p className="text-[10px] text-muted-foreground">
                        {isRu ? "🇷🇺 SaluteSpeech (Сбер) — бесплатный для физлиц. Поддержка SSML, 6 голосов, формат Opus/WAV." : "🇷🇺 SaluteSpeech (Sber) — free for individuals. SSML support, 6 voices, Opus/WAV format."}
                      </p>
                    </div>
                  </TabsContent>

                  {/* ─── ElevenLabs ─── */}
                  <TabsContent value="elevenlabs" className="space-y-4 mt-4">
                    {elCredits && (
                      <div className="rounded-md border border-border bg-muted/30 p-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{isRu ? "Кредиты" : "Credits"}: <span className="font-semibold text-foreground capitalize">{elCredits.tier}</span></span>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={loadElCredits} disabled={elCreditsLoading}>
                            <RotateCcw className={`h-3 w-3 ${elCreditsLoading ? "animate-spin" : ""}`} />
                          </Button>
                        </div>
                        <div className="mt-1.5">
                          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                            <span>{elCredits.used.toLocaleString()} / {elCredits.limit.toLocaleString()}</span>
                            <span>{Math.round((elCredits.used / elCredits.limit) * 100)}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, (elCredits.used / elCredits.limit) * 100)}%` }} />
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "Голос" : "Voice"}</label>
                      <Select value={elVoice} onValueChange={v => { setElVoice(v); markDirty(); }}>
                        <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border max-h-64">
                          {ELEVENLABS_VOICES.map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              <div className="flex items-center gap-2">
                                <span>{v.name}</span>
                                <Badge variant="outline" className="text-[10px] px-1 py-0">{v.gender === "female" ? "♀" : "♂"}</Badge>
                                <span className="text-[10px] text-muted-foreground">{isRu ? v.description.ru : v.description.en}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <SliderField label={isRu ? "Стабильность" : "Stability"} value={elStability} min={0} max={1} step={0.05} suffix="%" multiplier={100} default_={0.5} onChange={v => { setElStability(v); markDirty(); }} onReset={() => { setElStability(0.5); markDirty(); }} />
                    <SliderField label={isRu ? "Схожесть" : "Similarity"} value={elSimilarity} min={0} max={1} step={0.05} suffix="%" multiplier={100} default_={0.75} onChange={v => { setElSimilarity(v); markDirty(); }} onReset={() => { setElSimilarity(0.75); markDirty(); }} />
                    <SliderField label={isRu ? "Стиль" : "Style"} value={elStyle} min={0} max={1} step={0.05} suffix="%" multiplier={100} default_={0.4} onChange={v => { setElStyle(v); markDirty(); }} onReset={() => { setElStyle(0.4); markDirty(); }} />
                    <SliderField label={isRu ? "Скорость" : "Speed"} value={elSpeed} min={0.7} max={1.2} step={0.05} suffix="×" default_={0.95} decimals={2} onChange={v => { setElSpeed(v); markDirty(); }} onReset={() => { setElSpeed(0.95); markDirty(); }} />
                  </TabsContent>

                  {/* ─── OpenAI / ProxyAPI ─── */}
                  <TabsContent value="proxyapi" className="space-y-4 mt-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "Модель" : "Model"}</label>
                      <Select value={paModel} onValueChange={v => {
                        setPaModel(v);
                        const available = getVoicesForModel(v);
                        if (!available.some(av => av.id === paVoice)) setPaVoice(available[0]?.id ?? "alloy");
                        markDirty();
                      }}>
                        <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {PROXYAPI_TTS_MODELS.map(m => (
                            <SelectItem key={m.id} value={m.id}>
                              <div className="flex items-center gap-2">
                                <span>{m.name}</span>
                                <span className="text-[10px] text-muted-foreground">{isRu ? m.description.ru : m.description.en}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "Голос" : "Voice"}</label>
                      <Select value={paVoice} onValueChange={v => { setPaVoice(v); markDirty(); }}>
                        <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border max-h-64">
                          {getVoicesForModel(paModel).map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              <div className="flex items-center gap-2">
                                <span>{v.name}</span>
                                <Badge variant="outline" className="text-[10px] px-1 py-0">{v.gender === "female" ? "♀" : "♂"}</Badge>
                                <span className="text-[10px] text-muted-foreground">{isRu ? v.description.ru : v.description.en}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <SliderField label={isRu ? "Скорость" : "Speed"} value={paSpeed} min={0.25} max={4.0} step={0.05} suffix="×" default_={1.0} onChange={v => { setPaSpeed(v); markDirty(); }} onReset={() => { setPaSpeed(1.0); markDirty(); }} />
                    {paModel === "gpt-4o-mini-tts" && (
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "Инструкции" : "Instructions"}</label>
                        <Textarea
                          value={paInstructions}
                          onChange={e => { setPaInstructions(e.target.value); markDirty(); }}
                          placeholder={isRu ? "Говори с радостной интонацией, спокойно и размеренно..." : "Speak with a joyful tone, calmly and steadily..."}
                          className="min-h-[80px] text-xs bg-secondary border-border resize-y"
                        />
                        <p className="text-[10px] text-muted-foreground/60">{isRu ? "Управляйте акцентом, эмоциями, скоростью и тоном речи" : "Control accent, emotion, speed and tone of speech"}</p>
                      </div>
                    )}
                    <div className="rounded-md border border-border bg-muted/30 p-2.5">
                      <p className="text-[10px] text-muted-foreground">
                        {isRu ? "⚡ Требуется ключ ProxyAPI в Профиле → API-роутеры." : "⚡ Requires ProxyAPI key in Profile → API Routers."}
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>

                <Separator />

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
              </>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                <div className="text-center space-y-2">
                  <Volume2 className="h-10 w-10 mx-auto text-muted-foreground/30" />
                  <p className="text-sm">{isRu ? "Выберите персонажа для настройки голоса" : "Select a character to configure voice"}</p>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </motion.div>
  );
};

export default Narrators;

// ─── Reusable slider field ──────────────────────────────────

function SliderField({ label, value, min, max, step, suffix, default_, showSign, multiplier, decimals, onChange, onReset }: {
  label: string; value: number; min: number; max: number; step: number;
  suffix?: string; default_: number; showSign?: boolean; multiplier?: number; decimals?: number;
  onChange: (v: number) => void; onReset: () => void;
}) {
  const display = multiplier ? (value * multiplier).toFixed(decimals ?? 0) : value.toFixed(decimals ?? 1);
  const sign = showSign && value > 0 ? "+" : "";
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
        <span className="text-xs text-muted-foreground tabular-nums">{sign}{display}{suffix ?? ""}</span>
      </div>
      <div className="flex items-center gap-2">
        <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} className="flex-1" />
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={onReset} disabled={value === default_}>
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
