/**
 * AI-powered character psychological profiling.
 * Sends character names + scene excerpts to profile-characters-local edge function,
 * merges resulting profiles into local state.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getModelRegistryEntry } from "@/config/modelRegistry";
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
}: UseCharacterProfilesParams) {
  const [profiling, setProfiling] = useState(false);
  const [profileProgress, setProfileProgress] = useState<string | null>(null);
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

    setProfileProgress(
      isRu
        ? `Профайлинг ${charsToProfile.length} персонажей…`
        : `Profiling ${charsToProfile.length} characters…`
    );

    try {
      const registryEntry = getModelRegistryEntry(profilerModel);
      const apiKeyForModel = registryEntry?.apiKeyField
        ? userApiKeys[registryEntry.apiKeyField] || null
        : null;

      const existingProfiles: Record<string, string> = {};
      for (const c of charsToProfile) {
        if (c.profile?.description) existingProfiles[c.name] = c.profile.description;
      }

      const { data, error } = await supabase.functions.invoke("profile-characters-local", {
        body: {
          characters: charsToProfile.map(c => ({ name: c.name, aliases: c.aliases })),
          scenes: scenesPayload.slice(0, 30),
          lang: isRu ? "ru" : "en",
          model: profilerModel,
          apiKey: apiKeyForModel,
          existingProfiles: Object.keys(existingProfiles).length > 0 ? existingProfiles : undefined,
        },
      });

      if (error) throw error;

      const profiles: Array<{
        name: string;
        age_group?: string;
        temperament?: string;
        speech_style?: string;
        description?: string;
      }> = data?.profiles || [];

      // Merge profiles into characters
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

      const profiledCount = profiles.length;
      toast({
        title: isRu ? "Профайлинг завершён" : "Profiling complete",
        description: isRu
          ? `Профили созданы для ${profiledCount} персонажей`
          : `Profiles created for ${profiledCount} characters`,
      });
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
    }
  }, [characters, chapterResults, tocEntries, profilerModel, userApiKeys, isRu, setCharacters, persist, toast]);

  return {
    profiling,
    profileProgress,
    profileCharacters,
  };
}
