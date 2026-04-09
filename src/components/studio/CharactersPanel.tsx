import { useState, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAiRoles } from "@/hooks/useAiRoles";
import { enrichBodyWithKeys } from "@/lib/invokeWithFallback";
import { YANDEX_VOICES } from "@/config/yandexVoices";
import { VoiceCastingTable } from "@/components/studio/VoiceCastingTable";
import { CastingCandidatesPanel, type CastingCharacter } from "@/components/studio/CastingCandidatesPanel";
import { CharacterListSidebar } from "@/components/studio/CharacterListSidebar";
import { CharacterProfileEditor } from "@/components/studio/CharacterProfileEditor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { suggestVoiceCandidates, ACCENTUATION_YANDEX_ROLE, detectAccentuation, type VoiceCandidate } from "@/config/psychotypeVoicePresets";
import { useLocalCharacters } from "@/hooks/useLocalCharacters";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";

import { readStoryboardFromLocal } from "@/lib/storyboardSync";
import { deriveStoryboardCharacterIds, deriveStoryboardTypeMappings } from "@/lib/storyboardCharacterRouting";
import type { CharacterIndex } from "@/pages/parser/types";

// ─── Types ──────────────────────────────────────────────
type BookCharacter = CharacterIndex;

// ─── Voice Auto-Matching ─────────────────────────────────

function matchVoice(gender: string, ageGroup: string): string {
  const genderVoices = gender !== "unknown"
    ? YANDEX_VOICES.filter(v => v.gender === gender)
    : YANDEX_VOICES;

  if (genderVoices.length === 0) return "marina";

  const agePrefs: Record<string, Record<string, string[]>> = {
    female: {
      child: ["masha", "julia"], teen: ["masha", "lera"],
      young: ["dasha", "lera", "marina"], adult: ["alena", "jane", "marina"],
      elder: ["omazh", "julia"], infant: ["masha"],
    },
    male: {
      child: ["filipp"], teen: ["filipp", "anton"],
      young: ["anton", "alexander"], adult: ["kirill", "alexander", "madirus"],
      elder: ["zahar", "ermil"], infant: ["filipp"],
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
    sanguine: ["good", "friendly"],
    choleric: ["strict", "evil"],
    melancholic: ["neutral", "whisper"],
    phlegmatic: ["neutral", "friendly"],
  };

  const preferred = tempRoleMap[temperament ?? ""] ?? [];
  const found = preferred.find(r => v.roles!.includes(r));
  return found ?? "neutral";
}

// ─── Component ───────────────────────────────────────────

interface CharactersPanelProps {
  isRu: boolean;
  bookId?: string | null;
  sceneId?: string | null;
  chapterSceneIds?: string[];
  selectedCharacterId?: string | null;
  onSelectCharacter?: (characterId: string | null) => void;
  onVoiceSaved?: () => void;
  userApiKeys?: Record<string, string>;
  refreshToken?: number;
}

export interface CharactersPanelHandle {
  autoCast: () => Promise<void>;
  incrementalProfile: () => Promise<void>;
  casting: boolean;
  profiling: boolean;
}

export const CharactersPanel = forwardRef<CharactersPanelHandle, CharactersPanelProps>(function CharactersPanel({ isRu, bookId, sceneId, chapterSceneIds, selectedCharacterId, onSelectCharacter, onVoiceSaved, userApiKeys = {}, refreshToken = 0 }, ref) {
  const { getModelForRole } = useAiRoles();
  const { storage } = useProjectStorageContext();

  // ── LOCAL-FIRST: useLocalCharacters is the single source of truth ──
  const localChars = useLocalCharacters(storage, bookId ?? null, sceneId, chapterSceneIds, refreshToken);
  const characters = localChars.characters;
  const loading = localChars.loading;
  const sceneCharIds = localChars.sceneCharIds;
  const chapterCharIds = localChars.chapterCharIds;
  const segmentCounts = localChars.segmentCounts;
  const [storyboardSceneCharIds, setStoryboardSceneCharIds] = useState<Set<string>>(new Set());
  const [storyboardChapterCharIds, setStoryboardChapterCharIds] = useState<Set<string>>(new Set());

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profiling, setProfiling] = useState(false);
  const [casting, setCasting] = useState(false);
  const [castingCandidates, setCastingCandidates] = useState<CastingCharacter[] | null>(null);
  const [refiningSpeech, setRefiningSpeech] = useState(false);
  const [speechContextMap, setSpeechContextMap] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [filterMode, setFilterMode] = useState<"all" | "scene" | "chapter">("chapter");

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

  // Multi-select & merge
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

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
    const ch = characters.find(c => c.id === charId);
    if (ch) {
      await localChars.updateCharacter(charId, {
        voice_config: { ...ch.voice_config, is_extra: newVal },
      });
    }
  }, [isExtra, characters, localChars]);

  // System character names
  const SYSTEM_NAMES = useMemo(() => new Set([
    "Рассказчик", "Narrator", "Комментатор", "Commentator",
  ]), []);

  useEffect(() => {
    if (!storage || !sceneId) {
      setStoryboardSceneCharIds(new Set());
      return;
    }

    let cancelled = false;
    (async () => {
      const storyboard = await readStoryboardFromLocal(storage, sceneId);
      if (cancelled) return;

      const mappings = deriveStoryboardTypeMappings(
        storyboard?.segments ?? [],
        characters,
        storyboard?.typeMappings ?? [],
        storyboard?.inlineNarrationSpeaker ?? null,
      );
      setStoryboardSceneCharIds(deriveStoryboardCharacterIds(storyboard?.segments ?? [], characters, mappings));
    })();

    return () => {
      cancelled = true;
    };
  }, [storage, sceneId, characters, refreshToken]);

  useEffect(() => {
    if (!storage || !chapterSceneIds?.length) {
      setStoryboardChapterCharIds(new Set());
      return;
    }

    let cancelled = false;
    (async () => {
      const ids = new Set<string>();
      const storyboards = await Promise.all(chapterSceneIds.map((sid) => readStoryboardFromLocal(storage, sid)));
      if (cancelled) return;

      for (const storyboard of storyboards) {
        const mappings = deriveStoryboardTypeMappings(
          storyboard?.segments ?? [],
          characters,
          storyboard?.typeMappings ?? [],
          storyboard?.inlineNarrationSpeaker ?? null,
        );
        for (const id of deriveStoryboardCharacterIds(storyboard?.segments ?? [], characters, mappings)) {
          ids.add(id);
        }
      }

      setStoryboardChapterCharIds(ids);
    })();

    return () => {
      cancelled = true;
    };
  }, [storage, chapterSceneIds, characters, refreshToken]);

  const effectiveSceneCharIds = storyboardSceneCharIds.size > 0 ? storyboardSceneCharIds : sceneCharIds;
  const effectiveChapterCharIds = storyboardChapterCharIds.size > 0 ? storyboardChapterCharIds : chapterCharIds;

  // Filtered character list
  const filteredCharacters = useMemo(() => {
    let list: BookCharacter[];
    if (filterMode === "scene" && sceneId) {
      const sceneChars = characters.filter(c => effectiveSceneCharIds.has(c.id));
      list = sceneChars.length > 0 ? sceneChars : characters.filter(c => SYSTEM_NAMES.has(c.name));
    } else if (filterMode === "chapter") {
      const chapterChars = characters.filter(c => effectiveChapterCharIds.has(c.id) || SYSTEM_NAMES.has(c.name));
      list = chapterChars.length > 0 ? chapterChars : characters;
    } else {
      list = characters;
    }
    return [...list].sort((a, b) => {
      const aSys = SYSTEM_NAMES.has(a.name);
      const bSys = SYSTEM_NAMES.has(b.name);
      if (aSys !== bSys) return aSys ? -1 : 1;
      if (aSys && bSys) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      return a.name.localeCompare(b.name);
    });
  }, [characters, filterMode, effectiveSceneCharIds, effectiveChapterCharIds, sceneId, SYSTEM_NAMES]);

  // Sync voice settings when character selected
  useEffect(() => {
    if (!selectedChar) return;
    const vc = selectedChar.voice_config || {};
    const provider = (vc.provider as string) || "yandex";
    setVoiceProvider(provider === "elevenlabs" ? "elevenlabs" : provider === "proxyapi" ? "proxyapi" : provider === "salutespeech" ? "salutespeech" : "yandex");
    let voiceId = vc.voice_id || "marina";
    const savedVoice = YANDEX_VOICES.find(v => v.id === voiceId);
    if (savedVoice && selectedChar.gender !== "unknown" && savedVoice.gender !== selectedChar.gender) {
      voiceId = matchVoice(selectedChar.gender, selectedChar.age_group || "adult");
    }
    setVoice(voiceId);
    const currentVoice = YANDEX_VOICES.find(v => v.id === voiceId);
    setRole(currentVoice?.roles?.includes(vc.role || "") ? (vc.role || "neutral") : (currentVoice?.roles?.[0] || vc.role || "neutral"));
    setSpeed(vc.speed ?? 1.0);
    setPitch(vc.pitch ?? 0);
    setVolume(vc.volume ?? 0);
    setDirty(false);
  }, [selectedId]);

  // ── AI Profiling (local-first: reads scene content from OPFS) ───────
  const runProfile = async (sceneIdsForIncremental?: string[]) => {
    if (!bookId || !storage) return;
    setProfiling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error(isRu ? "Необходимо авторизоваться" : "Please sign in");
        return;
      }

      // Build scene excerpts from OPFS
      const { readStructureFromLocal } = await import("@/lib/localSync");
      const structResult = await readStructureFromLocal(storage);
      const scenesPayload: Array<{ title: string; text: string }> = [];
      if (structResult) {
        const targetSceneIds = sceneIdsForIncremental ? new Set(sceneIdsForIncremental) : null;
        structResult.chapterResults.forEach((result) => {
          if (!result.scenes?.length) return;
          for (const scene of result.scenes) {
            if (targetSceneIds && !targetSceneIds.has(scene.id)) continue;
            if (scene.content && scene.content.length > 20) {
              scenesPayload.push({ title: scene.title, text: scene.content });
            }
          }
        });
      }

      if (scenesPayload.length === 0) {
        toast.info(isRu ? "Нет сцен для анализа" : "No scenes for analysis");
        return;
      }

      // 🚫 К3: Use profile-characters-local (no DB reads)
      const { invokeWithFallback } = await import("@/lib/invokeWithFallback");
      const { data, error } = await invokeWithFallback({
        functionName: "profile-characters-local",
        body: {
          characters: characters.map(c => ({ name: c.name, aliases: c.aliases })),
          scenes: scenesPayload.slice(0, 30),
          lang: isRu ? "ru" : "en",
          model: getModelForRole("profiler"),
        },
        userApiKeys,
        modelField: "model",
        isRu,
      });

      if (error) throw error;
      const result = data as Record<string, unknown> | null;
      const profiles = (result?.profiles || []) as Array<{
        name: string; age_group?: string; temperament?: string;
        speech_style?: string; description?: string;
        speech_tags?: string[]; psycho_tags?: string[];
      }>;

      if (profiles.length > 0) {
        const profileByName = new Map(profiles.map(p => [p.name.toLowerCase(), p]));
        for (const c of characters) {
          const p = profileByName.get(c.name.toLowerCase())
            || [...profileByName.values()].find(pp => c.aliases.some(a => a.toLowerCase() === pp.name.toLowerCase()));
          if (!p) continue;
          await localChars.updateCharacter(c.id, {
            description: p.description || c.description,
            temperament: p.temperament || c.temperament,
            speech_style: p.speech_style || c.speech_style,
            age_group: p.age_group || c.age_group || "unknown",
            speech_tags: p.speech_tags?.length ? p.speech_tags : c.speech_tags,
            psycho_tags: p.psycho_tags?.length ? p.psycho_tags : c.psycho_tags,
          });
        }
      }

      toast.success(
        isRu
          ? `Профайлинг завершён: ${profiles.length} из ${characters.length}`
          : `Profiling complete: ${profiles.length} of ${characters.length}`
      );
    } catch (e) {
      console.error("Profiling error:", e);
      toast.error(e instanceof Error ? e.message : (isRu ? "Ошибка профайлинга" : "Profiling error"), { duration: Infinity, style: { background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', border: '1px solid', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' } });
    } finally {
      setProfiling(false);
    }
  };

  const handleProfile = () => runProfile();
  const handleIncrementalProfile = () => runProfile(chapterSceneIds);

  // ── Refine Speech Context (scene-level, reads from OPFS storyboard) ──
  const handleRefineSpeech = useCallback(async () => {
    if (!selectedId || !sceneId) return;
    const ch = characters.find(c => c.id === selectedId);
    if (!ch) return;

    setRefiningSpeech(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error(isRu ? "Необходимо авторизоваться" : "Please sign in");
        return;
      }

      // Load segments from OPFS storyboard
      if (!storage) {
        toast.error(isRu ? "Локальный проект не открыт" : "Local project not open");
        return;
      }
      const { paths } = await import("@/lib/projectPaths");
      const storyboard = await storage.readJSON<{ segments: Array<{ segment_id: string; segment_type: string; speaker?: string | null; phrases?: Array<{ text: string }> }> }>(paths.storyboard(sceneId));
      if (!storyboard?.segments?.length) {
        toast.info(isRu ? "Нет данных раскадровки" : "No storyboard data");
        return;
      }

      // Filter segments where this character speaks
      const charNames = new Set([ch.name.toLowerCase(), ...ch.aliases.map(a => a.toLowerCase())]);
      const charSegments = storyboard.segments.filter(s =>
        s.speaker && charNames.has(s.speaker.toLowerCase())
      );

      if (charSegments.length === 0) {
        toast.info(isRu ? `${ch.name} не говорит в этой сцене` : `${ch.name} has no lines in this scene`);
        return;
      }

      const segmentTexts = charSegments.map(seg =>
        (seg.phrases || []).map(p => p.text).join(" ")
      ).filter(Boolean);

      if (segmentTexts.length === 0) {
        toast.info(isRu ? "Нет текста для анализа" : "No text to analyze");
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refine-speech-context`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            scene_id: sceneId,
            character_name: ch.name,
            segments_text: segmentTexts,
            character_profile: {
              description: ch.description,
              temperament: ch.temperament,
              speech_style: ch.speech_style,
              speech_tags: ch.speech_tags,
              psycho_tags: ch.psycho_tags,
            },
            lang: isRu ? "ru" : "en",
            model: getModelForRole("profiler"),
          }),
        }
      );

      if (!response.ok) {
        const d = await response.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      const ctx = result.speech_context;

      // Save speech_context to OPFS storyboard metadata
      const updatedSegments = storyboard.segments.map(seg => {
        if (seg.speaker && charNames.has(seg.speaker.toLowerCase())) {
          return {
            ...seg,
            metadata: { ...(seg as any).metadata, speech_context: { ...ctx, character: ch.name } },
          };
        }
        return seg;
      });
      await storage.writeJSON(paths.storyboard(sceneId), { ...storyboard, segments: updatedSegments });

      setSpeechContextMap(prev => {
        const next = new Map(prev);
        next.set(`${selectedId}:${sceneId}`, ctx);
        return next;
      });

      toast.success(
        isRu
          ? `Речь ${ch.name} уточнена для сцены`
          : `Speech refined for ${ch.name} in scene`
      );
    } catch (e) {
      console.error("Refine speech error:", e);
      toast.error(e instanceof Error ? e.message : (isRu ? "Ошибка уточнения речи" : "Speech refinement error"));
    } finally {
      setRefiningSpeech(false);
    }
  }, [selectedId, sceneId, characters, isRu, getModelForRole, storage]);

  // Load existing speech_context from OPFS storyboard
  useEffect(() => {
    if (!selectedId || !sceneId || !storage) return;
    const ch = characters.find(c => c.id === selectedId);
    if (!ch) return;
    const cacheKey = `${selectedId}:${sceneId}`;
    if (speechContextMap.has(cacheKey)) return;

    (async () => {
      const { paths } = await import("@/lib/projectPaths");
      const storyboard = await storage.readJSON<{ segments: Array<{ speaker?: string | null; metadata?: Record<string, unknown> }> }>(paths.storyboard(sceneId));
      if (!storyboard?.segments) return;
      const charNames = new Set([ch.name.toLowerCase(), ...ch.aliases.map(a => a.toLowerCase())]);
      const seg = storyboard.segments.find(s => s.speaker && charNames.has(s.speaker.toLowerCase()));
      const meta = seg?.metadata;
      if (meta?.speech_context) {
        setSpeechContextMap(prev => {
          const next = new Map(prev);
          next.set(cacheKey, meta.speech_context as Record<string, unknown>);
          return next;
        });
      }
    })();
  }, [selectedId, sceneId, characters, storage]);

  // ── Save voice config (LOCAL-FIRST) ───────────────────────────
  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const currentChar = characters.find(c => c.id === selectedId);
      const voiceConfig = {
        provider: "yandex" as const,
        voice_id: voice,
        role: role !== "neutral" ? role : undefined,
        speed,
        pitch: pitch !== 0 ? pitch : undefined,
        volume: volume !== 0 ? volume : undefined,
        is_extra: currentChar?.voice_config?.is_extra,
      };
      await localChars.updateCharacter(selectedId, { voice_config: voiceConfig });
      setDirty(false);
      onVoiceSaved?.();
      toast.success(isRu ? "Голос сохранён" : "Voice saved");
    } catch {
      toast.error(isRu ? "Ошибка сохранения" : "Save error");
    } finally {
      setSaving(false);
    }
  };

  // ── Auto-cast voices ──
  const handleAutoCast = async () => {
    if (characters.length === 0) return;

    const toCast = characters.filter(ch => !ch.voice_config?.voice_id);
    if (toCast.length === 0) {
      toast.info(isRu ? "Все персонажи уже озвучены" : "All characters already have voices");
      return;
    }

    const castChars: CastingCharacter[] = [];
    for (const ch of toCast) {
      if (isExtra(ch.id)) continue;
      const candidates = suggestVoiceCandidates({
        gender: ch.gender,
        ageGroup: ch.age_group || "adult",
        temperament: ch.temperament,
        speechTags: ch.speech_tags || [],
        psychoTags: ch.psycho_tags || [],
        provider: "yandex",
      }, 3);
      if (candidates.length > 0) {
        castChars.push({
          id: ch.id, name: ch.name, gender: ch.gender,
          ageGroup: ch.age_group || "adult", temperament: ch.temperament,
          candidates,
        });
      }
    }

    // Auto-assign extras
    const extras = toCast.filter(ch => isExtra(ch.id));
    for (const ch of extras) {
      const pool = YANDEX_VOICES;
      const randomVoice = pool[Math.floor(Math.random() * pool.length)] || YANDEX_VOICES[0];
      const roles = randomVoice.roles ?? ["neutral"];
      const roleId = roles[Math.floor(Math.random() * roles.length)];
      const vc = {
        provider: "yandex" as const,
        voice_id: randomVoice.id,
        role: roleId !== "neutral" ? roleId : undefined,
        speed: 1.0,
        is_extra: true as const,
      };
      await localChars.updateCharacter(ch.id, { voice_config: vc });
    }
    if (extras.length > 0) {
      toast.success(
        isRu
          ? `Массовка: ${extras.length} голосов назначено автоматически`
          : `Extras: ${extras.length} voices auto-assigned`
      );
    }

    if (castChars.length > 0) {
      setCastingCandidates(castChars);
    }
  };

  // ── Confirm casting choices ──
  const handleCastingConfirm = async (picks: Map<string, VoiceCandidate>) => {
    setCasting(true);
    setCastingCandidates(null);
    try {
      for (const [charId, candidate] of picks) {
        const ch = characters.find(c => c.id === charId);
        if (!ch) continue;

        const voiceId = candidate.voiceId;
        const accentuation = detectAccentuation(ch.psycho_tags || []);
        const roleId = candidate.role
          || (accentuation ? ACCENTUATION_YANDEX_ROLE[accentuation] : undefined)
          || matchRole(voiceId, ch.temperament);

        const chosenVoice = YANDEX_VOICES.find(v => v.id === voiceId);
        const syncedGender = chosenVoice ? chosenVoice.gender : ch.gender;

        const vc = {
          provider: candidate.provider,
          voice_id: voiceId,
          role: roleId !== "neutral" ? roleId : undefined,
          speed: 1.0,
          is_extra: ch.voice_config?.is_extra,
        };
        await localChars.updateCharacter(charId, { voice_config: vc, gender: syncedGender });
      }

      if (selectedId) {
        const pick = picks.get(selectedId);
        if (pick) {
          setVoice(pick.voiceId);
          setRole(pick.role || "neutral");
          setSpeed(1.0);
          setPitch(0);
          setVolume(0);
          setDirty(false);
        }
      }

      onVoiceSaved?.();
      toast.success(
        isRu
          ? `Голоса подобраны для ${picks.size} персонажей`
          : `Voices matched for ${picks.size} characters`
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

  // ── Merge characters (LOCAL-FIRST) ────────────────────────────
  const handleMerge = async () => {
    if (selectedIds.size < 2) {
      toast.warning(isRu ? "Выберите минимум 2 персонажа" : "Select at least 2 characters");
      return;
    }
    setMerging(true);
    try {
      const ids = [...selectedIds];
      await localChars.mergeCharacters(ids);
      toast.success(
        isRu
          ? `${ids.length - 1} персонаж(ей) объединено`
          : `${ids.length - 1} character(s) merged`
      );
      setMultiSelect(false);
      setSelectedIds(new Set());
      setSelectedId(ids[0]);
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

  // ── Auto-clean duplicates (LOCAL-FIRST) ──────────────────────
  const [cleaningDupes, setCleaningDupes] = useState(false);

  const handleAutoCleanDuplicates = useCallback(async () => {
    if (characters.length < 2) return;
    setCleaningDupes(true);
    try {
      const nameMap = new Map<string, CharacterIndex[]>();
      for (const ch of characters) {
        const names = [ch.name, ...ch.aliases].map(n => n.toLowerCase().trim()).filter(Boolean);
        for (const n of names) {
          const arr = nameMap.get(n) || [];
          if (!arr.find(c => c.id === ch.id)) arr.push(ch);
          nameMap.set(n, arr);
        }
      }

      // Union-find for duplicate groups
      const parentMap = new Map<string, string>();
      const find = (id: string): string => {
        if (!parentMap.has(id)) parentMap.set(id, id);
        if (parentMap.get(id) !== id) parentMap.set(id, find(parentMap.get(id)!));
        return parentMap.get(id)!;
      };
      const union = (a: string, b: string) => { parentMap.set(find(a), find(b)); };

      for (const [, group] of nameMap) {
        if (group.length > 1) {
          for (let i = 1; i < group.length; i++) union(group[0].id, group[i].id);
        }
      }

      const groups = new Map<string, CharacterIndex[]>();
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
        const sorted = [...group].sort((a, b) => {
          const aSystem = SYSTEM_NAMES.has(a.name) ? 1 : 0;
          const bSystem = SYSTEM_NAMES.has(b.name) ? 1 : 0;
          if (aSystem !== bSystem) return bSystem - aSystem;
          const aCount = segmentCounts.get(a.id) ?? 0;
          const bCount = segmentCounts.get(b.id) ?? 0;
          if (aCount !== bCount) return bCount - aCount;
          return (a.sort_order ?? 0) - (b.sort_order ?? 0);
        });
        await localChars.mergeCharacters(sorted.map(c => c.id));
        totalMerged += sorted.length - 1;
      }

      toast.success(
        isRu
          ? `Объединено ${totalMerged} дубликат(ов) в ${dupeGroups.length} группах`
          : `Merged ${totalMerged} duplicate(s) in ${dupeGroups.length} groups`
      );
    } catch (e) {
      console.error("Auto-clean duplicates error:", e);
      toast.error(isRu ? "Ошибка очистки дубликатов" : "Duplicate cleanup error");
    } finally {
      setCleaningDupes(false);
    }
  }, [characters, segmentCounts, SYSTEM_NAMES, isRu, localChars]);

  // ── Gender/Age/Temperament update (LOCAL-FIRST) ──
  const handleGenderChange = useCallback(async (charId: string, g: string) => {
    const newVoiceId = matchVoice(g, characters.find(c => c.id === charId)?.age_group || "adult");
    const newVoice = YANDEX_VOICES.find(x => x.id === newVoiceId);
    const newRole = newVoice ? matchRole(newVoiceId, characters.find(c => c.id === charId)?.temperament ?? null) : role;
    setVoice(newVoiceId);
    setRole(newRole);
    setDirty(true);
    await localChars.updateCharacter(charId, { gender: g as "male" | "female" | "unknown" });
    toast.success(isRu ? "Пол сохранён" : "Gender saved");
  }, [characters, localChars, isRu, role]);

  const handleAgeChange = useCallback(async (charId: string, age: string) => {
    await localChars.updateCharacter(charId, { age_group: age });
    toast.success(isRu ? "Возраст сохранён" : "Age saved");
  }, [localChars, isRu]);

  const handleTemperamentChange = useCallback(async (charId: string, t: string) => {
    await localChars.updateCharacter(charId, { temperament: t });
    toast.success(isRu ? "Темперамент сохранён" : "Temperament saved");
  }, [localChars, isRu]);

  // ─── UI ───────────────────────────────────────────────

  const handleFilterModeChange = useCallback(() => {
    setFilterMode(prev =>
      prev === "chapter" ? (sceneId ? "scene" : "all")
        : prev === "scene" ? "all"
        : "chapter"
    );
  }, [sceneId]);

  const speechContext = selectedChar && sceneId
    ? speechContextMap.get(`${selectedChar.id}:${sceneId}`)
    : undefined;

  return (
    <div className="h-full flex">
      {/* Left: character list */}
      <CharacterListSidebar
        isRu={isRu}
        characters={characters}
        filteredCharacters={filteredCharacters}
        loading={loading}
        selectedId={selectedId}
        filterMode={filterMode}
        sceneId={sceneId}
        effectiveSceneCharIds={effectiveSceneCharIds}
        multiSelect={multiSelect}
        selectedIds={selectedIds}
        merging={merging}
        profiling={profiling}
        cleaningDupes={cleaningDupes}
        hasProfiles={hasProfiles}
        segmentCounts={segmentCounts}
        profilerModel={getModelForRole("profiler")}
        directorModel={getModelForRole("director")}
        isExtra={isExtra}
        onFilterModeChange={handleFilterModeChange}
        onToggleExtra={toggleExtra}
        onToggleMultiSelect={toggleMultiSelect}
        onSelectCharacter={handleSelectCharacter}
        onToggleCharInSelection={toggleCharInSelection}
        onMerge={handleMerge}
        onProfile={handleProfile}
        onAutoCleanDuplicates={handleAutoCleanDuplicates}
      />

      {/* Right: two-column layout — Profile + Voice */}
      <div className="flex-1 min-w-0 overflow-hidden flex">
        {/* Column 1: Profile */}
        <div className="flex-1 min-w-0 border-r border-border">
          <ScrollArea className="h-full">
            <CharacterProfileEditor
              isRu={isRu}
              selectedChar={selectedChar ?? null}
              isExtra={selectedChar ? isExtra(selectedChar.id) : false}
              profiling={profiling}
              sceneId={sceneId}
              effectiveSceneCharIds={effectiveSceneCharIds}
              speechContext={speechContext}
              refiningSpeech={refiningSpeech}
              getModelForRole={getModelForRole}
              onProfile={handleProfile}
              onGenderChange={handleGenderChange}
              onAgeChange={handleAgeChange}
              onTemperamentChange={handleTemperamentChange}
              onRefineSpeech={handleRefineSpeech}
            />
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
                  characters={filteredCharacters as any}
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
