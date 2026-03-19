/**
 * AI-powered character psychological profiling.
 * Sends character names + scene excerpts to profile-characters-local edge function,
 * merges resulting profiles into local state.
 *
 * When a model pool is configured for the "profiler" role,
 * characters are split into batches and distributed across pool workers
 * via ModelPoolManager for parallel profiling.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getModelRegistryEntry } from "@/config/modelRegistry";
import { ModelPoolManager, type PoolTask, type PoolStats } from "@/lib/modelPoolManager";
import type { Scene, ChapterStatus, TocChapter, LocalCharacter, CharacterProfile } from "@/pages/parser/types";

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

/** Split array into N roughly equal chunks */
function chunkArray<T>(arr: T[], numChunks: number): T[][] {
  const chunks: T[][] = [];
  const size = Math.ceil(arr.length / numChunks);
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
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
  const { toast } = useToast();

  const profileCharacters = useCallback(async (charIds: string[]) => {
    const charsToProfile = characters.filter(c => charIds.includes(c.id));
    if (charsToProfile.length === 0) return;

    setProfiling(true);
    setProfileProgress(isRu ? "Подготовка…" : "Preparing…");

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
      toast({ title: isRu ? "Нет сцен для анализа" : "No scenes to analyze", variant: "destructive" });
      return;
    }

    const scenesSlice = scenesPayload.slice(0, 30);

    // ── Invoke profiling for a batch of characters with a specific model ──
    const invokeProfile = async (
      chars: LocalCharacter[],
      modelId: string,
    ): Promise<Array<{
      name: string;
      age_group?: string;
      temperament?: string;
      speech_style?: string;
      description?: string;
    }>> => {
      const registryEntry = getModelRegistryEntry(modelId);
      const apiKeyForModel = registryEntry?.apiKeyField
        ? userApiKeys[registryEntry.apiKeyField] || null
        : null;

      const existingProfiles: Record<string, string> = {};
      for (const c of chars) {
        if (c.profile?.description) existingProfiles[c.name] = c.profile.description;
      }

      const { data, error } = await supabase.functions.invoke("profile-characters-local", {
        body: {
          characters: chars.map(c => ({ name: c.name, aliases: c.aliases })),
          scenes: scenesSlice,
          lang: isRu ? "ru" : "en",
          model: modelId,
          apiKey: apiKeyForModel,
          existingProfiles: Object.keys(existingProfiles).length > 0 ? existingProfiles : undefined,
        },
      });

      if (error) throw error;
      return data?.profiles || [];
    };

    // ── Merge profiles into character state ──
    const applyProfiles = (profiles: Array<{
      name: string;
      age_group?: string;
      temperament?: string;
      speech_style?: string;
      description?: string;
    }>) => {
      const profileByName = new Map<string, CharacterProfile>();
      for (const p of profiles) {
        profileByName.set(p.name.toLowerCase(), {
          age_group: p.age_group,
          temperament: p.temperament,
          speech_style: p.speech_style,
          description: p.description,
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
        persist(next);
        return next;
      });

      return profiles.length;
    };

    const usePool = effectivePool && effectivePool.length > 1 && charsToProfile.length > 1;

    try {
      if (usePool) {
        // ── Pool mode: split characters into batches per model ──
        const numBatches = Math.min(effectivePool.length, charsToProfile.length);
        const batches = chunkArray(charsToProfile, numBatches);

        console.log(`[CharProfile] Pool mode: ${effectivePool.length} models, ${batches.length} batches, ${charsToProfile.length} chars`);

        setProfileProgress(
          isRu
            ? `Пул: ${effectivePool.length} моделей × ${charsToProfile.length} персонажей`
            : `Pool: ${effectivePool.length} models × ${charsToProfile.length} characters`
        );

        const manager = new ModelPoolManager(effectivePool, userApiKeys, 2);
        const tasks: PoolTask<Array<{
          name: string;
          age_group?: string;
          temperament?: string;
          speech_style?: string;
          description?: string;
        }>>[] = batches.map((batch, i) => ({
          id: `batch-${i}`,
          execute: async (modelId: string) => {
            setProfileProgress(
              isRu
                ? `Профайлинг: группа ${i + 1}/${batches.length} (${batch.length} перс.)`
                : `Profiling: batch ${i + 1}/${batches.length} (${batch.length} chars)`
            );
            return invokeProfile(batch, modelId);
          },
        }));

        const results = await manager.runAll(tasks, (progress) => {
          setProfileProgress(
            isRu
              ? `Профайлинг: ${progress.done}/${progress.total} групп`
              : `Profiling: ${progress.done}/${progress.total} batches`
          );
          setProfilePoolStats(manager.getStats());
        });
        setProfilePoolStats(manager.getStats());

        // Collect all successful profiles
        const allProfiles: Array<{
          name: string;
          age_group?: string;
          temperament?: string;
          speech_style?: string;
          description?: string;
        }> = [];
        let errorCount = 0;

        for (const [, result] of results) {
          if (result instanceof Error) {
            errorCount++;
            console.error("[CharProfile] Pool batch error:", result.message);
          } else {
            allProfiles.push(...result);
          }
        }

        const profiledCount = applyProfiles(allProfiles);

        if (errorCount > 0 && profiledCount > 0) {
          toast({
            title: isRu ? "Профайлинг частично завершён" : "Profiling partially complete",
            description: isRu
              ? `Профили созданы для ${profiledCount} персонажей. Ошибки: ${errorCount} из ${batches.length} групп.`
              : `Profiles created for ${profiledCount} characters. Errors: ${errorCount} of ${batches.length} batches.`,
          });
        } else if (errorCount > 0) {
          throw new Error(isRu ? "Все группы завершились с ошибкой" : "All batches failed");
        } else {
          toast({
            title: isRu ? "Профайлинг завершён" : "Profiling complete",
            description: isRu
              ? `Профили созданы для ${profiledCount} персонажей`
              : `Profiles created for ${profiledCount} characters`,
          });
        }
      } else {
        // ── Classic single-call mode ──
        setProfileProgress(
          isRu
            ? `Профайлинг ${charsToProfile.length} персонажей…`
            : `Profiling ${charsToProfile.length} characters…`
        );

        const profiles = await invokeProfile(charsToProfile, profilerModel);
        const profiledCount = applyProfiles(profiles);

        toast({
          title: isRu ? "Профайлинг завершён" : "Profiling complete",
          description: isRu
            ? `Профили созданы для ${profiledCount} персонажей`
            : `Profiles created for ${profiledCount} characters`,
        });
      }
    } catch (err) {
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
      setProfilePoolStats([]);
    }
  }, [characters, chapterResults, tocEntries, profilerModel, userApiKeys, isRu, setCharacters, persist, toast, effectivePool]);

  return {
    profiling,
    profileProgress,
    profileCharacters,
  };
}
