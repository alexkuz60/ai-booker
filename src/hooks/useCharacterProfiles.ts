/**
 * AI-powered character psychological profiling.
 * Sends character names + scene excerpts to profile-characters-local edge function,
 * merges resulting profiles into local state.
 *
 * Supports modes:
 *  - "fresh": Re-profile all selected characters (clear existing profiles first)
 *  - "continue": Skip characters that already have profiles
 *  - "selective": Profile only specific charIds (default)
 *
 * When a model pool is configured for the "profiler" role,
 * characters are split into batches and distributed across pool workers
 * via ModelPoolManager for parallel profiling.
 */

import { useState, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { getModelRegistryEntry } from "@/config/modelRegistry";
import { invokeWithFallback } from "@/lib/invokeWithFallback";
import { ModelPoolManager, type PoolTask, type PoolStats, logPoolStats } from "@/lib/modelPoolManager";
import type { Scene, ChapterStatus, TocChapter, LocalCharacter, CharacterProfile } from "@/pages/parser/types";

export type ProfileMode = "fresh" | "continue" | "selective";

interface UseCharacterProfilesParams {
  tocEntries: TocChapter[];
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  characters: LocalCharacter[];
  setCharacters: React.Dispatch<React.SetStateAction<LocalCharacter[]>>;
  persist: (chars: LocalCharacter[]) => Promise<void>;
  profilerModel: string;
  userApiKeys: Record<string, string>;
  isRu: boolean;
  /** Effective pool for the profiler role (from useAiRoles.getEffectivePool) */
  effectivePool?: string[];
}

/** Max characters per batch to avoid output truncation */
const MAX_CHARS_PER_BATCH = 10;

/** Split array into chunks of at most `maxSize` */
function chunkBySize<T>(arr: T[], maxSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += maxSize) {
    chunks.push(arr.slice(i, i + maxSize));
  }
  return chunks;
}

export function useCharacterProfiles({
  tocEntries,
  chapterResults,
  characters,
  setCharacters,
  persist,
  profilerModel,
  userApiKeys,
  isRu,
  effectivePool,
}: UseCharacterProfilesParams) {
  const [profiling, setProfiling] = useState(false);
  const [profileProgress, setProfileProgress] = useState<string | null>(null);
  const [profilePoolStats, setProfilePoolStats] = useState<PoolStats[]>([]);
  const [profiledCount, setProfiledCount] = useState(0);
  const [profileTotal, setProfileTotal] = useState(0);
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const stopProfiling = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const profileCharacters = useCallback(async (
    charIds: string[],
    mode: ProfileMode = "selective",
  ) => {
    // Determine which characters to profile based on mode
    let charsToProfile: LocalCharacter[];

    if (mode === "fresh") {
      // All non-system characters, clear their profiles first
      charsToProfile = characters.filter(c => c.role !== "system");
      // Clear existing profiles
      setCharacters(prev => {
        const next = prev.map(c => c.role !== "system" ? { ...c, profile: undefined } : c);
        persist(next);
        return next;
      });
    } else if (mode === "continue") {
      // Only characters without profiles
      charsToProfile = characters.filter(c => c.role !== "system" && !c.profile?.description);
    } else {
      // selective — only selected charIds
      charsToProfile = characters.filter(c => charIds.includes(c.id));
    }

    if (charsToProfile.length === 0) {
      toast({
        title: isRu ? "Нечего профилировать" : "Nothing to profile",
        description: isRu
          ? (mode === "continue" ? "У всех персонажей уже есть профили" : "Нет подходящих персонажей")
          : (mode === "continue" ? "All characters already have profiles" : "No matching characters"),
      });
      return;
    }

    const abort = new AbortController();
    abortRef.current = abort;

    setProfiling(true);
    setProfileProgress(isRu ? "Подготовка…" : "Preparing…");
    setProfilePoolStats([]);
    setProfiledCount(0);
    setProfileTotal(charsToProfile.length);

    // Collect scene texts for context
    const scenesPayload: Array<{ title: string; text: string }> = [];
    chapterResults.forEach((result, idx) => {
      if (result.status !== "done" || !result.scenes?.length) return;
      const entry = tocEntries[idx];
      for (const scene of result.scenes) {
        if (scene.content && scene.content.length > 20) {
          scenesPayload.push({ title: `${entry?.title || ""} / ${scene.title}`, text: scene.content });
        }
      }
    });

    if (scenesPayload.length === 0) {
      setProfiling(false);
      setProfileProgress(null);
      abortRef.current = null;
      toast({ title: isRu ? "Нет сцен для анализа" : "No scenes to analyze", variant: "destructive" });
      return;
    }

    const scenesSlice = scenesPayload.slice(0, 30);

    // ── Invoke profiling for a batch of characters with a specific model ──
    const invokeProfile = async (
      chars: LocalCharacter[],
      modelId: string,
    ): Promise<{ profiles: Array<{
      name: string;
      age_group?: string;
      temperament?: string;
      speech_style?: string;
      description?: string;
    }>; usedModel: string }> => {
      if (abort.signal.aborted) throw new Error("aborted");

      const registryEntry = getModelRegistryEntry(modelId);
      const apiKeyForModel = registryEntry?.apiKeyField
        ? userApiKeys[registryEntry.apiKeyField] || null
        : null;

      console.log(`[CharProfile] invokeProfile model=${modelId} | registryEntry=${registryEntry?.id ?? 'NOT FOUND'} | apiKeyField=${registryEntry?.apiKeyField ?? 'none'} | hasApiKey=${!!apiKeyForModel} | userApiKeysFields=${Object.keys(userApiKeys).join(',')}`);


      const existingProfiles: Record<string, string> = {};
      for (const c of chars) {
        if (c.profile?.description) existingProfiles[c.name] = c.profile.description;
      }

      const { data, error } = await invokeWithFallback({
        functionName: "profile-characters-local",
        body: {
          characters: chars.map(c => ({ name: c.name, aliases: c.aliases })),
          scenes: scenesSlice,
          lang: isRu ? "ru" : "en",
          model: modelId,
          apiKey: apiKeyForModel,
          existingProfiles: Object.keys(existingProfiles).length > 0 ? existingProfiles : undefined,
        },
        userApiKeys,
        modelField: "model",
        isRu,
      });

      if (abort.signal.aborted) throw new Error("aborted");
      if (error) throw error;
      const result = data as Record<string, unknown> | null;
      return { profiles: (result?.profiles || []) as Array<{
        name: string; age_group?: string; temperament?: string;
        speech_style?: string; description?: string;
        speech_tags?: string[]; psycho_tags?: string[];
      }>, usedModel: String(result?.usedModel || modelId) };
    };

    // ── Merge profiles into character state ──
    // skipPersist: in pool mode we persist once after all batches complete
    const applyProfiles = (profiles: Array<{
      name: string;
      age_group?: string;
      temperament?: string;
      speech_style?: string;
      description?: string;
    }>, usedModel: string, skipPersist = false) => {
      const profileByName = new Map<string, CharacterProfile>();
      for (const p of profiles) {
        profileByName.set(p.name.toLowerCase(), {
          age_group: p.age_group,
          temperament: p.temperament,
          speech_style: p.speech_style,
          description: p.description,
          profiledBy: usedModel,
        });
      }

      setCharacters(prev => {
        const next = prev.map(c => {
          const key = c.name.toLowerCase();
          const profile = profileByName.get(key)
            || c.aliases.reduce<CharacterProfile | undefined>(
              (found, a) => found || profileByName.get(a.toLowerCase()), undefined);
          if (profile) return { ...c, profile };
          return c;
        });
        if (!skipPersist) {
          persist(next);
        }
        return next;
      });

      return profiles.length;
    };

    const usePool = effectivePool && effectivePool.length > 1 && charsToProfile.length > 1;

    console.log(`[CharProfile] effectivePool:`, effectivePool, `| usePool: ${usePool} | chars: ${charsToProfile.length} | profilerModel: ${profilerModel}`);

    try {
      if (usePool) {
        // ── Pool mode: size batches so each pool model gets work ──
        const poolSize = effectivePool.length;
        // Ensure at least as many batches as pool models for full distribution
        const batchSize = Math.min(
          MAX_CHARS_PER_BATCH,
          Math.max(1, Math.ceil(charsToProfile.length / poolSize)),
        );
        const batches = chunkBySize(charsToProfile, batchSize);

        console.log(`[CharProfile] Pool mode: ${poolSize} models [${effectivePool.join(', ')}], ${batches.length} batches (${batchSize} chars each), ${charsToProfile.length} chars total`);

        setProfileProgress(
          isRu
            ? `Пул: ${poolSize} моделей × ${charsToProfile.length} персонажей`
            : `Pool: ${poolSize} models × ${charsToProfile.length} characters`
        );

        const manager = new ModelPoolManager(effectivePool, userApiKeys, 3);
        let completedProfiles = 0;
        const tasks: PoolTask<{ profiles: Array<{
          name: string;
          age_group?: string;
          temperament?: string;
          speech_style?: string;
          description?: string;
        }>; usedModel: string }>[] = batches.map((batch, i) => ({
          id: `batch-${i}`,
          execute: async (modelId: string) => {
            if (abort.signal.aborted) throw new Error("aborted");
            setProfileProgress(
              isRu
                ? `Профайлинг: группа ${i + 1}/${batches.length} (${batch.length} перс.)`
                : `Profiling: batch ${i + 1}/${batches.length} (${batch.length} chars)`
            );
            const result = await invokeProfile(batch, modelId);
            // Apply profiles incrementally as each batch completes
            if (result.profiles.length > 0) {
              completedProfiles += result.profiles.length;
              setProfiledCount(completedProfiles);
              applyProfiles(result.profiles, result.usedModel, true /* skipPersist — single persist after all batches */);
            }
            return result;
          },
        }));

        const poolStartTime = Date.now();
        const results = await manager.runAll(tasks, (progress) => {
          if (abort.signal.aborted) return;
          setProfileProgress(
            isRu
              ? `Профайлинг: ${progress.done}/${progress.total} групп`
              : `Profiling: ${progress.done}/${progress.total} batches`
          );
          setProfilePoolStats(manager.getStats());
        });
        const finalStats = manager.getStats();
        setProfilePoolStats(finalStats);
        logPoolStats(finalStats, "profile_characters", Date.now() - poolStartTime);

        if (abort.signal.aborted) {
          // Still persist what we have so far
          setCharacters(prev => { persist(prev); return prev; });
          toast({ title: isRu ? "Профайлинг остановлен" : "Profiling stopped" });
          return;
        }

        // ── Single final persist with all profiles applied ──
        setCharacters(prev => { persist(prev); return prev; });

        // Count errors (profiles already applied incrementally)
        let errorCount = 0;
        let totalProfiled = 0;

        for (const [, result] of results) {
          if (result instanceof Error) {
            errorCount++;
            console.error("[CharProfile] Pool batch error:", result.message);
          } else {
            totalProfiled += result.profiles.length;
          }
        }

        if (errorCount > 0 && totalProfiled > 0) {
          toast({
            title: isRu ? "Профайлинг частично завершён" : "Profiling partially complete",
            description: isRu
              ? `Профили созданы для ${totalProfiled} персонажей. Ошибки: ${errorCount} из ${batches.length} групп.`
              : `Profiles created for ${totalProfiled} characters. Errors: ${errorCount} of ${batches.length} batches.`,
          });
        } else if (errorCount > 0) {
          throw new Error(isRu ? "Все группы завершились с ошибкой" : "All batches failed");
        } else {
          toast({
            title: isRu ? "Профайлинг завершён" : "Profiling complete",
            description: isRu
              ? `Профили созданы для ${totalProfiled} персонажей`
              : `Profiles created for ${totalProfiled} characters`,
          });
        }
      } else {
        // ── Single/sequential mode: chunk into batches of MAX_CHARS_PER_BATCH ──
        const batches = chunkBySize(charsToProfile, MAX_CHARS_PER_BATCH);
        let completedProfiles = 0;

        for (let i = 0; i < batches.length; i++) {
          if (abort.signal.aborted) {
            toast({ title: isRu ? "Профайлинг остановлен" : "Profiling stopped" });
            return;
          }

          const batch = batches[i];
          setProfileProgress(
            isRu
              ? `Профайлинг: группа ${i + 1}/${batches.length} (${batch.length} перс.)`
              : `Profiling: batch ${i + 1}/${batches.length} (${batch.length} chars)`
          );

          const { profiles, usedModel } = await invokeProfile(batch, profilerModel);
          const count = applyProfiles(profiles, usedModel);
          completedProfiles += count;
          setProfiledCount(completedProfiles);
        }

        toast({
          title: isRu ? "Профайлинг завершён" : "Profiling complete",
          description: isRu
            ? `Профили созданы для ${completedProfiles} персонажей`
            : `Profiles created for ${completedProfiles} characters`,
        });
      }
    } catch (err) {
      if (abort.signal.aborted) {
        toast({ title: isRu ? "Профайлинг остановлен" : "Profiling stopped" });
        return;
      }
      console.error("Profile characters failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: isRu ? "Ошибка профайлинга" : "Profiling error",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setProfiling(false);
      setProfileProgress(null);
      // Keep profilePoolStats visible after completion — cleared on next run start
      setProfiledCount(0);
      setProfileTotal(0);
      abortRef.current = null;
    }
  }, [characters, chapterResults, tocEntries, profilerModel, userApiKeys, isRu, setCharacters, persist, toast, effectivePool]);

  return {
    profiling,
    profileProgress,
    profilePoolStats,
    profiledCount,
    profileTotal,
    profileCharacters,
    stopProfiling,
  };
}
