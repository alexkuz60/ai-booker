import { useState, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { Users, UsersRound, Volume2, Loader2, Sparkles, User, Filter, Merge, CheckSquare, X, Check, SearchCheck } from "lucide-react";
import { RoleBadge } from "@/components/ui/RoleBadge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAiRoles } from "@/hooks/useAiRoles";
import { YANDEX_VOICES } from "@/config/yandexVoices";
import { VoiceCastingTable } from "@/components/studio/VoiceCastingTable";
import { CastingCandidatesPanel, type CastingCharacter } from "@/components/studio/CastingCandidatesPanel";
import { suggestVoiceCandidates, ACCENTUATION_YANDEX_ROLE, detectAccentuation, type VoiceCandidate } from "@/config/psychotypeVoicePresets";

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
    is_extra?: boolean;
  };
  color: string | null;
  sort_order: number;
  speech_tags: string[];
  psycho_tags: string[];
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
  elder:   { ru: { m: "Старик", f: "Старуха", u: "Пожилой" },           en: { m: "Old man", f: "Old woman", u: "Elder" } },
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
  chapterSceneIds?: string[];
  selectedCharacterId?: string | null;
  onSelectCharacter?: (characterId: string | null) => void;
  onVoiceSaved?: () => void;
}

export interface CharactersPanelHandle {
  autoCast: () => Promise<void>;
  incrementalProfile: () => Promise<void>;
  casting: boolean;
  profiling: boolean;
}

export const CharactersPanel = forwardRef<CharactersPanelHandle, CharactersPanelProps>(function CharactersPanel({ isRu, bookId, sceneId, chapterSceneIds, selectedCharacterId, onSelectCharacter, onVoiceSaved }, ref) {
  const { getModelForRole } = useAiRoles();
  const [characters, setCharacters] = useState<BookCharacter[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profiling, setProfiling] = useState(false);
  const [casting, setCasting] = useState(false);
  const [castingCandidates, setCastingCandidates] = useState<CastingCharacter[] | null>(null);

  // Filter: "all" or "scene"
  const [filterMode, setFilterMode] = useState<"all" | "scene" | "chapter">("chapter");
  const [sceneCharIds, setSceneCharIds] = useState<Set<string>>(new Set());
  const [chapterCharIds, setChapterCharIds] = useState<Set<string>>(new Set());

  // Sync with external selectedCharacterId
  useEffect(() => {
    if (selectedCharacterId !== undefined && selectedCharacterId !== selectedId) {
      setSelectedId(selectedCharacterId);
    }
  }, [selectedCharacterId]);

  const handleSelectCharacter = useCallback((id: string | null) => {
    setSelectedId(id);
    onSelectCharacter?.(id);
  }, [onSelectCharacter]);

  // Segment counts per character (for "extras" detection)
  const [segmentCounts, setSegmentCounts] = useState<Map<string, number>>(new Map());

  // Multi-select & merge
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);

   const [dirty, setDirty] = useState(false);
   const [saving, setSaving] = useState(false);

   // Keep voice/role for auto-cast matching only (not UI-editable here)
   const [voice, setVoice] = useState("marina");
   const [role, setRole] = useState("neutral");
   const [speed, setSpeed] = useState(1.0);
   const [pitch, setPitch] = useState(0);
   const [volume, setVolume] = useState(0);
   const [voiceProvider, setVoiceProvider] = useState<"yandex" | "elevenlabs" | "proxyapi" | "salutespeech">("yandex");

  const selectedVoice = YANDEX_VOICES.find(v => v.id === voice);
  const availableRoles = selectedVoice?.roles ?? ["neutral"];
  const selectedChar = characters.find(c => c.id === selectedId);
  const hasProfiles = characters.some(c => c.description);

  const isExtra = useCallback((charId: string) => {
    const ch = characters.find(c => c.id === charId);
    if (ch?.voice_config?.is_extra !== undefined) return ch.voice_config.is_extra;
    return (segmentCounts.get(charId) ?? 0) <= 1;
  }, [characters, segmentCounts]);

  const toggleExtra = useCallback(async (charId: string) => {
    const newVal = !isExtra(charId);
    // Update local state immediately
    setCharacters(prev => prev.map(c =>
      c.id === charId ? { ...c, voice_config: { ...c.voice_config, is_extra: newVal } } : c
    ));
    // Persist to DB
    const ch = characters.find(c => c.id === charId);
    if (ch) {
      await supabase
        .from("book_characters")
        .update({ voice_config: { ...ch.voice_config, is_extra: newVal }, updated_at: new Date().toISOString() })
        .eq("id", charId);
    }
  }, [isExtra, characters]);

  // ── Ensure system characters exist ──────────────────────
  const ensureSystemCharacters = useCallback(async (bookId: string, existing: string[]) => {
    const systemDefs = [
      { name: isRu ? "Рассказчик" : "Narrator", nameAlt: isRu ? "Narrator" : "Рассказчик", sort_order: -2, description: isRu ? "Голос повествования от третьего лица" : "Third-person narration voice" },
      { name: isRu ? "Комментатор" : "Commentator", nameAlt: isRu ? "Commentator" : "Комментатор", sort_order: -1, description: isRu ? "Озвучивание сносок и комментариев" : "Footnote and commentary voice" },
    ];
    const toCreate = systemDefs.filter(d => !existing.includes(d.name) && !existing.includes(d.nameAlt));
    if (toCreate.length === 0) return false;
    await supabase.from("book_characters").insert(
      toCreate.map(d => ({
        book_id: bookId, name: d.name, gender: "male", age_group: "adult",
        description: d.description, sort_order: d.sort_order, voice_config: { provider: "yandex" },
      }))
    );
    return true;
  }, [isRu]);

  // ── Load characters from DB ─────────────────────────────
  const loadCharacters = useCallback(async () => {
    if (!bookId) { setCharacters([]); setSceneCharIds(new Set()); setChapterCharIds(new Set()); setSegmentCounts(new Map()); return; }
    setLoading(true);
    try {
      let { data, error } = await supabase
        .from("book_characters")
        .select("*")
        .eq("book_id", bookId)
        .order("sort_order");
      if (error) throw error;

      // Auto-create system characters if missing
      const names = (data || []).map(c => c.name);
      const created = await ensureSystemCharacters(bookId, names);
      if (created) {
        const res = await supabase.from("book_characters").select("*").eq("book_id", bookId).order("sort_order");
        data = res.data;
      }

      // Load all appearances to count total segments per character
      const charIds = (data || []).map(c => c.id);
      const counts = new Map<string, number>();
      if (charIds.length > 0) {
        for (let i = 0; i < charIds.length; i += 200) {
          const batch = charIds.slice(i, i + 200);
          const { data: apps } = await supabase
            .from("character_appearances")
            .select("character_id, segment_ids")
            .in("character_id", batch);
          if (apps) {
            for (const a of apps) {
              counts.set(a.character_id, (counts.get(a.character_id) ?? 0) + (a.segment_ids?.length ?? 0));
            }
          }
        }
      }
      setSegmentCounts(counts);

      // Scene-level character IDs
      let scIds = new Set<string>();
      if (sceneId && data && data.length > 0) {
        const { data: appearances } = await supabase
          .from("character_appearances")
          .select("character_id")
          .eq("scene_id", sceneId);
        scIds = new Set(appearances?.map(a => a.character_id) || []);
      }
      setSceneCharIds(scIds);

      // Chapter-level character IDs (all scenes in this chapter)
      let chIds = new Set<string>();
      if (chapterSceneIds && chapterSceneIds.length > 0 && data && data.length > 0) {
        for (let i = 0; i < chapterSceneIds.length; i += 200) {
          const batch = chapterSceneIds.slice(i, i + 200);
          const { data: apps } = await supabase
            .from("character_appearances")
            .select("character_id")
            .in("scene_id", batch);
          if (apps) {
            for (const a of apps) chIds.add(a.character_id);
          }
        }
      }
      setChapterCharIds(chIds);

      if (scIds.size > 0 && data) {
        const sorted = [
          ...data.filter(c => scIds.has(c.id)),
          ...data.filter(c => !scIds.has(c.id)),
        ];
        setCharacters(sorted.map(c => ({
          ...c,
          voice_config: (c.voice_config as BookCharacter["voice_config"]) || {},
          speech_tags: (c as any).speech_tags || [],
          psycho_tags: (c as any).psycho_tags || [],
        })));
      } else {
        setCharacters((data || []).map(c => ({
          ...c,
          voice_config: (c.voice_config as BookCharacter["voice_config"]) || {},
          speech_tags: (c as any).speech_tags || [],
          psycho_tags: (c as any).psycho_tags || [],
        })));
      }
    } catch (e) {
      console.error("Load characters error:", e);
    } finally {
      setLoading(false);
    }
  }, [bookId, sceneId, chapterSceneIds]);

  useEffect(() => { loadCharacters(); }, [loadCharacters]);

  // System character names (Narrator / Commentator)
  const SYSTEM_NAMES = useMemo(() => new Set([
    "Рассказчик", "Narrator", "Комментатор", "Commentator",
  ]), []);

  // Filtered character list
  const filteredCharacters = useMemo(() => {
    let list: BookCharacter[];
    if (filterMode === "scene" && sceneId) {
      const sceneChars = characters.filter(c => sceneCharIds.has(c.id));
      list = sceneChars.length > 0 ? sceneChars : characters.filter(c => SYSTEM_NAMES.has(c.name));
    } else if (filterMode === "chapter") {
      const chapterChars = characters.filter(c => chapterCharIds.has(c.id) || SYSTEM_NAMES.has(c.name));
      list = chapterChars.length > 0 ? chapterChars : characters;
    } else {
      list = characters;
    }
    // System characters first (by sort_order), then alphabetical
    return [...list].sort((a, b) => {
      const aSys = SYSTEM_NAMES.has(a.name);
      const bSys = SYSTEM_NAMES.has(b.name);
      if (aSys !== bSys) return aSys ? -1 : 1;
      if (aSys && bSys) return a.sort_order - b.sort_order;
      return a.name.localeCompare(b.name);
    });
  }, [characters, filterMode, sceneCharIds, chapterCharIds, sceneId, SYSTEM_NAMES]);

  // ── Sync voice settings when character selected (for auto-cast only) ─────────
  useEffect(() => {
    if (!selectedChar) return;
    const vc = selectedChar.voice_config;
    const provider = (vc.provider as string) || "yandex";
    setVoiceProvider(provider === "elevenlabs" ? "elevenlabs" : provider === "proxyapi" ? "proxyapi" : provider === "salutespeech" ? "salutespeech" : "yandex");
    let voiceId = vc.voice_id || "marina";
    const savedVoice = YANDEX_VOICES.find(v => v.id === voiceId);
    if (savedVoice && selectedChar.gender !== "unknown" && savedVoice.gender !== selectedChar.gender) {
      voiceId = matchVoice(selectedChar.gender, selectedChar.age_group);
    }
    setVoice(voiceId);
    const currentVoice = YANDEX_VOICES.find(v => v.id === voiceId);
    setRole(currentVoice?.roles?.includes(vc.role || "") ? (vc.role || "neutral") : (currentVoice?.roles?.[0] || vc.role || "neutral"));
    setSpeed(vc.speed ?? 1.0);
    setPitch(vc.pitch ?? 0);
    setVolume(vc.volume ?? 0);
    setDirty(false);
  }, [selectedId]);

  // ── AI Profiling (full or incremental) ───────────────
  const runProfile = async (sceneIdsForIncremental?: string[]) => {
    if (!bookId) return;
    setProfiling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error(isRu ? "Необходимо авторизоваться" : "Please sign in");
        return;
      }

      const body: Record<string, unknown> = { book_id: bookId, language: isRu ? "ru" : "en", model: getModelForRole("profiler") };
      if (sceneIdsForIncremental?.length) body.scene_ids = sceneIdsForIncremental;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/profile-characters`,
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
        const d = await response.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      const skippedMsg = result.skipped > 0
        ? (isRu ? `, пропущено: ${result.skipped}` : `, skipped: ${result.skipped}`)
        : "";
      toast.success(
        isRu
          ? `Профайлинг завершён: ${result.profiled} из ${result.total}${skippedMsg}`
          : `Profiling complete: ${result.profiled} of ${result.total}${skippedMsg}`
      );
      await loadCharacters();
    } catch (e) {
      console.error("Profiling error:", e);
      toast.error(e instanceof Error ? e.message : (isRu ? "Ошибка профайлинга" : "Profiling error"));
    } finally {
      setProfiling(false);
    }
  };

  const handleProfile = () => runProfile();
  const handleIncrementalProfile = () => runProfile(chapterSceneIds);

  // ── Save voice config (only used by auto-cast now) ───────────────────────────
  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const currentChar = characters.find(c => c.id === selectedId);
      const voiceConfig = {
        provider: "yandex",
        voice_id: voice,
        role: role !== "neutral" ? role : undefined,
        speed,
        pitch: pitch !== 0 ? pitch : undefined,
        volume: volume !== 0 ? volume : undefined,
        is_extra: currentChar?.voice_config?.is_extra,
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
      onVoiceSaved?.();
      toast.success(isRu ? "Голос сохранён" : "Voice saved");
    } catch {
      toast.error(isRu ? "Ошибка сохранения" : "Save error");
    } finally {
      setSaving(false);
    }
  };

  // ── Auto-cast voices — show candidates panel for user choice ──
  const handleAutoCast = async () => {
    if (characters.length === 0) return;

    // Only cast characters that don't have a voice yet
    const toCast = characters.filter(ch => !ch.voice_config?.voice_id);
    if (toCast.length === 0) {
      toast.info(isRu ? "Все персонажи уже озвучены" : "All characters already have voices");
      return;
    }

    // Build candidates for each character
    const castChars: CastingCharacter[] = [];
    for (const ch of toCast) {
      if (isExtra(ch.id)) {
        // Extras get random voices — no UI needed, auto-assign
        continue;
      }
      const candidates = suggestVoiceCandidates({
        gender: ch.gender,
        ageGroup: ch.age_group,
        temperament: ch.temperament,
        speechTags: ch.speech_tags || [],
        psychoTags: ch.psycho_tags || [],
        provider: "yandex", // default provider
      }, 3);
      if (candidates.length > 0) {
        castChars.push({
          id: ch.id,
          name: ch.name,
          gender: ch.gender,
          ageGroup: ch.age_group,
          temperament: ch.temperament,
          candidates,
        });
      }
    }

    // Auto-assign extras immediately
    const extras = toCast.filter(ch => isExtra(ch.id));
    if (extras.length > 0) {
      for (const ch of extras) {
        const pool = YANDEX_VOICES;
        const randomVoice = pool[Math.floor(Math.random() * pool.length)] || YANDEX_VOICES[0];
        const roles = randomVoice.roles ?? ["neutral"];
        const roleId = roles[Math.floor(Math.random() * roles.length)];
        const vc: BookCharacter["voice_config"] = {
          provider: "yandex",
          voice_id: randomVoice.id,
          role: roleId !== "neutral" ? roleId : undefined,
          speed: 1.0,
          is_extra: true,
        };
        await supabase
          .from("book_characters")
          .update({ voice_config: vc, updated_at: new Date().toISOString() })
          .eq("id", ch.id);
        setCharacters(prev => prev.map(c => c.id === ch.id ? { ...c, voice_config: vc } : c));
      }
      if (extras.length > 0) {
        toast.success(
          isRu
            ? `Массовка: ${extras.length} голосов назначено автоматически`
            : `Extras: ${extras.length} voices auto-assigned`
        );
      }
    }

    // Show candidates panel for non-extras
    if (castChars.length > 0) {
      setCastingCandidates(castChars);
    }
  };

  // ── Confirm casting choices ──
  const handleCastingConfirm = async (picks: Map<string, VoiceCandidate>) => {
    setCasting(true);
    setCastingCandidates(null);
    try {
      const usedVoices = new Set<string>();
      for (const ch of characters) {
        if (ch.voice_config?.voice_id) usedVoices.add(ch.voice_config.voice_id);
      }

      const updates: { id: string; voice_config: BookCharacter["voice_config"]; gender?: string }[] = [];

      for (const [charId, candidate] of picks) {
        const ch = characters.find(c => c.id === charId);
        if (!ch) continue;

        const voiceId = candidate.voiceId;
        const accentuation = detectAccentuation(ch.psycho_tags || []);
        const roleId = candidate.role
          || (accentuation ? ACCENTUATION_YANDEX_ROLE[accentuation] : undefined)
          || matchRole(voiceId, ch.temperament);
        usedVoices.add(voiceId);

        const chosenVoice = YANDEX_VOICES.find(v => v.id === voiceId);
        const syncedGender = chosenVoice ? chosenVoice.gender : ch.gender;

        const vc: BookCharacter["voice_config"] = {
          provider: candidate.provider,
          voice_id: voiceId,
          role: roleId !== "neutral" ? roleId : undefined,
          speed: 1.0,
          is_extra: ch.voice_config?.is_extra,
        };
        updates.push({ id: ch.id, voice_config: vc, gender: syncedGender });
      }

      // Batch save to DB
      for (const u of updates) {
        const updateData: Record<string, unknown> = {
          voice_config: u.voice_config,
          updated_at: new Date().toISOString(),
        };
        if (u.gender) updateData.gender = u.gender;
        await supabase
          .from("book_characters")
          .update(updateData)
          .eq("id", u.id);
      }

      // Update local state
      setCharacters(prev => prev.map(c => {
        const u = updates.find(x => x.id === c.id);
        return u ? { ...c, voice_config: u.voice_config, gender: u.gender ?? c.gender } : c;
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

      onVoiceSaved?.();
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

  const handleCastingCancel = () => {
    setCastingCandidates(null);
  };

  useImperativeHandle(ref, () => ({ autoCast: handleAutoCast, incrementalProfile: handleIncrementalProfile, casting, profiling }), [characters, selectedId, casting, profiling, chapterSceneIds]);

  // ── Merge characters ────────────────────────────────────
  const handleMerge = async () => {
    if (selectedIds.size < 2) {
      toast.warning(isRu ? "Выберите минимум 2 персонажа" : "Select at least 2 characters");
      return;
    }
    setMerging(true);
    try {
      // Order: first selected in list order becomes primary
      const ordered = characters.filter(c => selectedIds.has(c.id));
      const primary = ordered[0];
      const others = ordered.slice(1);

      // Collect aliases: primary aliases + other names + other aliases
      const newAliases = [
        ...primary.aliases,
        ...others.flatMap(c => [c.name, ...c.aliases]),
      ].filter((v, i, a) => a.indexOf(v) === i && v !== primary.name);

      // Update primary character
      const { error: updateErr } = await supabase
        .from("book_characters")
        .update({ aliases: newAliases, updated_at: new Date().toISOString() })
        .eq("id", primary.id);
      if (updateErr) throw updateErr;

      // Update character_appearances: reassign merged characters' appearances to primary
      for (const other of others) {
        const { data: appearances } = await supabase
          .from("character_appearances")
          .select("*")
          .eq("character_id", other.id);
        if (appearances?.length) {
          for (const app of appearances) {
            // Check if primary already has an appearance in this scene
            const { data: existing } = await supabase
              .from("character_appearances")
              .select("id, segment_ids")
              .eq("character_id", primary.id)
              .eq("scene_id", app.scene_id)
              .maybeSingle();
            if (existing) {
              // Merge segment_ids
              const mergedSegments = [...new Set([...existing.segment_ids, ...app.segment_ids])];
              await supabase.from("character_appearances").update({ segment_ids: mergedSegments }).eq("id", existing.id);
              await supabase.from("character_appearances").delete().eq("id", app.id);
            } else {
              await supabase.from("character_appearances").update({ character_id: primary.id }).eq("id", app.id);
            }
          }
        }
        // Delete the merged character
        await supabase.from("book_characters").delete().eq("id", other.id);
      }

      toast.success(
        isRu
          ? `${others.length} персонаж(ей) объединено с "${primary.name}"`
          : `${others.length} character(s) merged into "${primary.name}"`
      );
      setMultiSelect(false);
      setSelectedIds(new Set());
      setSelectedId(primary.id);
      await loadCharacters();
    } catch (e) {
      console.error("Merge error:", e);
      toast.error(isRu ? "Ошибка объединения" : "Merge error");
    } finally {
      setMerging(false);
    }
  };

  const toggleMultiSelect = () => {
    setMultiSelect(prev => !prev);
    setSelectedIds(new Set());
  };

  const toggleCharInSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Auto-clean duplicates ──────────────────────────────
  const [cleaningDupes, setCleaningDupes] = useState(false);

  const handleAutoCleanDuplicates = useCallback(async () => {
    if (characters.length < 2) return;
    setCleaningDupes(true);
    try {
      // Build name→character index (lowercase)
      const nameMap = new Map<string, BookCharacter[]>();
      for (const ch of characters) {
        const names = [ch.name, ...ch.aliases].map(n => n.toLowerCase().trim()).filter(Boolean);
        for (const n of names) {
          const arr = nameMap.get(n) || [];
          if (!arr.find(c => c.id === ch.id)) arr.push(ch);
          nameMap.set(n, arr);
        }
      }

      // Find duplicate groups using union-find
      const parentMap = new Map<string, string>();
      const find = (id: string): string => {
        if (!parentMap.has(id)) parentMap.set(id, id);
        if (parentMap.get(id) !== id) parentMap.set(id, find(parentMap.get(id)!));
        return parentMap.get(id)!;
      };
      const union = (a: string, b: string) => {
        parentMap.set(find(a), find(b));
      };

      for (const [, group] of nameMap) {
        if (group.length > 1) {
          for (let i = 1; i < group.length; i++) {
            union(group[0].id, group[i].id);
          }
        }
      }

      // Collect groups of size > 1
      const groups = new Map<string, BookCharacter[]>();
      for (const ch of characters) {
        const root = find(ch.id);
        const arr = groups.get(root) || [];
        arr.push(ch);
        groups.set(root, arr);
      }

      const dupeGroups = [...groups.values()].filter(g => g.length > 1);
      if (dupeGroups.length === 0) {
        toast.info(isRu ? "Дубликатов не найдено" : "No duplicates found");
        setCleaningDupes(false);
        return;
      }

      let totalMerged = 0;

      for (const group of dupeGroups) {
        // Pick primary: prefer system chars, then highest segment count, then first by sort_order
        const sorted = [...group].sort((a, b) => {
          const aSystem = SYSTEM_NAMES.has(a.name) ? 1 : 0;
          const bSystem = SYSTEM_NAMES.has(b.name) ? 1 : 0;
          if (aSystem !== bSystem) return bSystem - aSystem;
          const aCount = segmentCounts.get(a.id) ?? 0;
          const bCount = segmentCounts.get(b.id) ?? 0;
          if (aCount !== bCount) return bCount - aCount;
          return a.sort_order - b.sort_order;
        });

        const primary = sorted[0];
        const others = sorted.slice(1);

        // Collect aliases
        const newAliases = [
          ...primary.aliases,
          ...others.flatMap(c => [c.name, ...c.aliases]),
        ].filter((v, i, a) => a.indexOf(v) === i && v.toLowerCase() !== primary.name.toLowerCase());

        // Update primary
        await supabase
          .from("book_characters")
          .update({ aliases: newAliases, updated_at: new Date().toISOString() })
          .eq("id", primary.id);

        // Reassign appearances and delete others
        for (const other of others) {
          const { data: appearances } = await supabase
            .from("character_appearances")
            .select("*")
            .eq("character_id", other.id);
          if (appearances?.length) {
            for (const app of appearances) {
              const { data: existing } = await supabase
                .from("character_appearances")
                .select("id, segment_ids")
                .eq("character_id", primary.id)
                .eq("scene_id", app.scene_id)
                .maybeSingle();
              if (existing) {
                const mergedSegments = [...new Set([...existing.segment_ids, ...app.segment_ids])];
                await supabase.from("character_appearances").update({ segment_ids: mergedSegments }).eq("id", existing.id);
                await supabase.from("character_appearances").delete().eq("id", app.id);
              } else {
                await supabase.from("character_appearances").update({ character_id: primary.id }).eq("id", app.id);
              }
            }
          }
          // Update scene_segments speaker references
          await supabase
            .from("scene_segments")
            .update({ speaker: primary.name })
            .eq("speaker", other.name);
          // Also update for aliases of the other character
          for (const alias of other.aliases) {
            await supabase
              .from("scene_segments")
              .update({ speaker: primary.name })
              .eq("speaker", alias);
          }
          await supabase.from("book_characters").delete().eq("id", other.id);
          totalMerged++;
        }
      }

      toast.success(
        isRu
          ? `Объединено ${totalMerged} дубликат(ов) в ${dupeGroups.length} группах`
          : `Merged ${totalMerged} duplicate(s) in ${dupeGroups.length} groups`
      );
      await loadCharacters();
    } catch (e) {
      console.error("Auto-clean duplicates error:", e);
      toast.error(isRu ? "Ошибка очистки дубликатов" : "Duplicate cleanup error");
    } finally {
      setCleaningDupes(false);
    }
  }, [characters, segmentCounts, SYSTEM_NAMES, isRu, loadCharacters]);

  // Voice editing is now on the Narrators page

  return (
    <div className="h-full flex">
      {/* Left: character list */}
      <div className="w-56 shrink-0 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold font-display text-foreground flex items-center gap-1.5">
              {isRu ? "Персонажи" : "Characters"}
              <RoleBadge roleId="profiler" model={getModelForRole("profiler")} isRu={isRu} size={13} />
              <RoleBadge roleId="director" model={getModelForRole("director")} isRu={isRu} size={13} />
            </span>
            <div className="flex items-center gap-1">
              {/* Filter toggle: chapter → scene → all → chapter */}
              <Button
                variant={filterMode !== "all" ? "secondary" : "ghost"}
                size="icon"
                className="h-6 w-6"
                onClick={() => setFilterMode(prev =>
                  prev === "chapter" ? (sceneId ? "scene" : "all")
                    : prev === "scene" ? "all"
                    : "chapter"
                )}
                title={filterMode === "chapter"
                  ? (isRu ? "Фильтр: глава" : "Filter: chapter")
                  : filterMode === "scene"
                    ? (isRu ? "Фильтр: сцена" : "Filter: scene")
                    : (isRu ? "Фильтр: все" : "Filter: all")}
              >
                <Filter className={`h-3 w-3 ${filterMode !== "all" ? "text-primary" : ""}`} />
              </Button>
              {filterMode !== "all" && (
                <span className="text-[9px] text-primary font-medium">
                  {filterMode === "chapter" ? (isRu ? "гл." : "ch.") : (isRu ? "сц." : "sc.")}
                </span>
              )}
              {/* Extras toggle for selected character */}
              {selectedId && !multiSelect && (
                <Button
                  variant={isExtra(selectedId) ? "secondary" : "ghost"}
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => toggleExtra(selectedId)}
                  title={isExtra(selectedId)
                    ? (isRu ? "Убрать из массовки" : "Remove from extras")
                    : (isRu ? "Пометить как массовку" : "Mark as extra")}
                >
                  <UsersRound className={`h-3 w-3 ${isExtra(selectedId) ? "text-primary" : ""}`} />
                </Button>
              )}
              {/* Multi-select toggle */}
              {characters.length > 1 && (
                <Button
                  variant={multiSelect ? "secondary" : "ghost"}
                  size="icon"
                  className="h-6 w-6"
                  onClick={toggleMultiSelect}
                  title={isRu ? "Мультивыбор для слияния" : "Multi-select for merge"}
                >
                  {multiSelect ? <X className="h-3 w-3" /> : <CheckSquare className="h-3 w-3" />}
                </Button>
              )}
              {characters.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {filterMode === "scene" && sceneCharIds.size > 0 ? filteredCharacters.length : characters.length}
                </Badge>
              )}
            </div>
          </div>
          {/* Merge button (shown in multi-select mode) */}
          {multiSelect && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 text-xs"
              onClick={handleMerge}
              disabled={merging || selectedIds.size < 2}
            >
              {merging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Merge className="h-3 w-3" />}
              {merging
                ? (isRu ? "Слияние..." : "Merging...")
                : (isRu ? `Объединить (${selectedIds.size})` : `Merge (${selectedIds.size})`)}
            </Button>
          )}
          {!multiSelect && characters.length > 0 && (
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5 text-xs"
                onClick={handleProfile}
                disabled={profiling || cleaningDupes}
              >
                {profiling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {profiling
                  ? (isRu ? "Анализ..." : "Profiling...")
                  : hasProfiles
                    ? (isRu ? "Обновить профайлы" : "Re-profile")
                    : (isRu ? "AI-профайлинг" : "AI Profile")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1 text-xs px-2"
                onClick={handleAutoCleanDuplicates}
                disabled={cleaningDupes || profiling}
                title={isRu ? "Найти и объединить дубликаты" : "Find & merge duplicates"}
              >
                {cleaningDupes ? <Loader2 className="h-3 w-3 animate-spin" /> : <SearchCheck className="h-3 w-3" />}
              </Button>
            </div>
          )}
        </div>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="p-4 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredCharacters.length === 0 ? (
            <div className="p-4 text-center">
              <Users className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">
                {filterMode === "scene"
                  ? (isRu ? "Повествовательная сцена — нет персонажей с диалогами. Используйте Рассказчика и Комментатора." : "Narrative scene — no dialogue characters. Use Narrator and Commentator.")
                  : (isRu ? "Персонажи появятся после сегментации сцен" : "Characters will appear after scene segmentation")}
              </p>
            </div>
          ) : (
            <div className="p-1 space-y-0.5">
              {filteredCharacters.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => {
                    if (multiSelect) {
                      toggleCharInSelection(ch.id);
                    } else {
                      handleSelectCharacter(ch.id);
                    }
                  }}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    multiSelect
                      ? selectedIds.has(ch.id)
                        ? "bg-primary/15 text-accent-foreground ring-1 ring-primary/30"
                        : "text-muted-foreground hover:bg-muted/50"
                      : selectedId === ch.id
                        ? "bg-accent/15 text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {multiSelect && (
                      <div className={`h-3.5 w-3.5 rounded border shrink-0 flex items-center justify-center ${
                        selectedIds.has(ch.id) ? "bg-primary border-primary" : "border-muted-foreground/40"
                      }`}>
                        {selectedIds.has(ch.id) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                      </div>
                    )}
                    <span className="truncate font-medium">{ch.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {isExtra(ch.id) && (
                        <span title={isRu ? "Массовка" : "Extra"}><UsersRound className="h-3 w-3 text-muted-foreground/50" /></span>
                      )}
                      {ch.description && <User className="h-3 w-3 text-primary/60" />}
                      {ch.voice_config?.voice_id && <Volume2 className="h-3 w-3 text-primary/60" />}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
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
                    {(ch.psycho_tags?.length > 0 || ch.speech_tags?.length > 0) && (
                      <span className="text-[10px] text-violet-400/70" title={[...(ch.psycho_tags || []), ...(ch.speech_tags || [])].join(", ")}>
                        🎭{(ch.psycho_tags?.length ?? 0) + (ch.speech_tags?.length ?? 0)}
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
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold font-display text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  {isRu ? "Профайл" : "Profile"}
                  <RoleBadge roleId="profiler" model={getModelForRole("profiler")} isRu={isRu} size={12} />
                </h3>
                {selectedChar && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 gap-1 text-xs"
                    onClick={handleProfile}
                    disabled={profiling}
                  >
                    {profiling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {isRu ? "Обновить профайл" : "Re-profile"}
                  </Button>
                )}
              </div>

              {selectedChar ? (
                <>
                  <div>
                    <h4 className="text-base font-semibold font-display text-foreground mb-2 flex items-center gap-2">
                      {selectedChar.name}
                      {isExtra(selectedChar.id) && (
                        <span title={isRu ? "Массовка" : "Extra"}><UsersRound className="h-4 w-4 text-muted-foreground/60" /></span>
                      )}
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
                                  // Re-match voice to new gender
                                  const newVoiceId = matchVoice(g, selectedChar.age_group);
                                  const newVoice = YANDEX_VOICES.find(x => x.id === newVoiceId);
                                  const newRole = newVoice ? matchRole(newVoiceId, selectedChar.temperament) : role;
                                  setVoice(newVoiceId);
                                  setRole(newRole);
                                  setCharacters(prev => prev.map(c =>
                                    c.id === charId ? { ...c, gender: g } : c
                                  ));
                                  setDirty(true);
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
                    {/* Speech & Psycho tags */}
                    {(selectedChar.speech_tags?.length > 0 || selectedChar.psycho_tags?.length > 0) && (
                      <div className="mt-3 space-y-2">
                        {selectedChar.speech_tags?.length > 0 && (
                          <div>
                            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                              {isRu ? "Манера речи" : "Speech manner"}
                            </span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {selectedChar.speech_tags.map((tag, i) => (
                                <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0 border-sky-500/40 text-sky-400">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        {selectedChar.psycho_tags?.length > 0 && (
                          <div>
                            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                              {isRu ? "Психотип" : "Psychotype"}
                            </span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {selectedChar.psycho_tags.map((tag, i) => (
                                <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0 border-violet-500/40 text-violet-400">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
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

        {/* Column 2: Voice Casting Table or Casting Candidates */}
        <div className="flex-1 min-w-0">
          {castingCandidates ? (
            <CastingCandidatesPanel
              characters={castingCandidates}
              isRu={isRu}
              onConfirm={handleCastingConfirm}
              onCancel={handleCastingCancel}
            />
          ) : (
            <div className="p-4 h-full flex flex-col">
              <h3 className="text-xs font-semibold font-display text-muted-foreground uppercase tracking-wider mb-3">
                {isRu ? "Голоса" : "Voices"}
              </h3>
              <div className="flex-1 min-h-0">
                <VoiceCastingTable
                  characters={filteredCharacters}
                  isRu={isRu}
                  selectedCharacterId={selectedId}
                  onSelectCharacter={handleSelectCharacter}
                  filterMode={filterMode}
                  sceneCharIds={sceneCharIds}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
