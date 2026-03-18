/**
 * AI-powered character extraction from analyzed scenes.
 * Iterates chapters, calls extract-characters edge function,
 * merges results live into UI state.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getModelRegistryEntry } from "@/config/modelRegistry";
import type { Scene, ChapterStatus, TocChapter, LocalCharacter, CharacterAppearance } from "@/pages/parser/types";

function generateId(): string {
  return crypto.randomUUID();
}

interface UseCharacterExtractionParams {
  tocEntries: TocChapter[];
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  characters: LocalCharacter[];
  setCharacters: React.Dispatch<React.SetStateAction<LocalCharacter[]>>;
  persist: (chars: LocalCharacter[]) => Promise<void>;
  profilerModel: string;
  userApiKeys: Record<string, string>;
  isRu: boolean;
}

export function useCharacterExtraction({
  tocEntries,
  chapterResults,
  characters,
  setCharacters,
  persist,
  profilerModel,
  userApiKeys,
  isRu,
}: UseCharacterExtractionParams) {
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<string | null>(null);
  const { toast } = useToast();

  const extractCharacters = useCallback(async () => {
    setExtracting(true);
    setExtractProgress(isRu ? "Подготовка…" : "Preparing…");

    // Collect chapters that have analyzed scenes
    const chaptersToProcess: { idx: number; entry: TocChapter; scenes: Scene[] }[] = [];
    chapterResults.forEach((result, idx) => {
      if (result.status !== "done" || !result.scenes?.length) return;
      const entry = tocEntries[idx];
      if (!entry) return;
      chaptersToProcess.push({ idx, entry, scenes: result.scenes });
    });

    if (chaptersToProcess.length === 0) {
      setExtracting(false);
      setExtractProgress(null);
      toast({
        title: isRu ? "Нет проанализированных глав" : "No analyzed chapters",
        variant: "destructive",
      });
      return;
    }

    // Accumulate all characters across chapters
    const allResults = new Map<string, {
      name: string;
      aliases: string[];
      gender: "male" | "female" | "unknown";
      appearances: CharacterAppearance[];
      sceneCount: number;
    }>();

    // Build intermediate LocalCharacter[] snapshot from allResults merged with existing
    const buildSnapshot = (): LocalCharacter[] => {
      const existingByName = new Map<string, LocalCharacter>();
      for (const ch of characters) {
        existingByName.set(ch.name.toLowerCase(), ch);
        for (const alias of ch.aliases) existingByName.set(alias.toLowerCase(), ch);
      }

      const snapshot: LocalCharacter[] = [...characters];
      const usedIds = new Set(characters.map(c => c.id));

      for (const [key, data] of allResults) {
        const existing = existingByName.get(key)
          || data.aliases.reduce<LocalCharacter | undefined>(
            (found, a) => found || existingByName.get(a.toLowerCase()), undefined);

        if (existing) {
          existing.appearances = data.appearances;
          existing.sceneCount = data.sceneCount;
          if ((!existing.gender || existing.gender === "unknown") && data.gender !== "unknown") {
            existing.gender = data.gender;
          }
          const allAliases = new Set([...existing.aliases, ...data.aliases]);
          allAliases.delete(existing.name);
          existing.aliases = Array.from(allAliases);
        } else {
          const newChar: LocalCharacter = {
            id: generateId(),
            name: data.name,
            aliases: data.aliases,
            gender: data.gender,
            appearances: data.appearances,
            sceneCount: data.sceneCount,
          };
          snapshot.push(newChar);
          usedIds.add(newChar.id);
          existingByName.set(key, newChar);
        }
      }

      snapshot.sort((a, b) => b.sceneCount - a.sceneCount);
      return snapshot;
    };

    let errorCount = 0;

    for (let ci = 0; ci < chaptersToProcess.length; ci++) {
      const { idx, entry, scenes } = chaptersToProcess[ci];
      setExtractProgress(
        isRu
          ? `Глава ${ci + 1}/${chaptersToProcess.length}: ${entry.title.slice(0, 40)}`
          : `Chapter ${ci + 1}/${chaptersToProcess.length}: ${entry.title.slice(0, 40)}`
      );

      const scenesPayload = scenes
        .filter(s => s.content && s.content.length > 20)
        .map(s => ({
          scene_number: s.scene_number,
          text: s.content!,
        }));

      if (scenesPayload.length === 0) continue;

      try {
        const registryEntry = getModelRegistryEntry(profilerModel);
        const apiKeyForModel = registryEntry?.apiKeyField
          ? userApiKeys[registryEntry.apiKeyField] || null
          : null;

        const { data, error } = await supabase.functions.invoke("extract-characters", {
          body: {
            scenes: scenesPayload,
            lang: isRu ? "ru" : "en",
            model: profilerModel,
            apiKey: apiKeyForModel,
          },
        });

        if (error) {
          console.error("extract-characters error for chapter", idx, error);
          errorCount++;
          continue;
        }

        const extracted: Array<{
          name: string;
          aliases: string[];
          gender: "male" | "female" | "unknown";
          scene_numbers: number[];
        }> = data?.characters || [];

        for (const char of extracted) {
          const key = char.name.toLowerCase();

          let existingKey: string | null = null;
          for (const [k, v] of allResults) {
            if (k === key) { existingKey = k; break; }
            if (v.aliases.some(a => a.toLowerCase() === key)) { existingKey = k; break; }
            if (char.aliases.some(a => a.toLowerCase() === k)) { existingKey = k; break; }
          }

          if (existingKey) {
            const existing = allResults.get(existingKey)!;
            const allAliases = new Set([...existing.aliases, ...char.aliases]);
            allAliases.delete(existing.name);
            existing.aliases = Array.from(allAliases);
            if (existing.gender === "unknown" && char.gender !== "unknown") {
              existing.gender = char.gender;
            }
            existing.appearances.push({
              chapterIdx: idx,
              chapterTitle: entry.title,
              sceneNumbers: char.scene_numbers,
            });
            existing.sceneCount += char.scene_numbers.length;
          } else {
            allResults.set(key, {
              name: char.name,
              aliases: char.aliases,
              gender: char.gender,
              appearances: [{
                chapterIdx: idx,
                chapterTitle: entry.title,
                sceneNumbers: char.scene_numbers,
              }],
              sceneCount: char.scene_numbers.length,
            });
          }
        }

        // Push intermediate snapshot to UI
        setCharacters(buildSnapshot());
      } catch (err) {
        console.error("AI extraction failed for chapter", idx, err);
        errorCount++;
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("rate_limited") || msg.includes("429")) {
          toast({
            title: isRu ? "Превышен лимит запросов" : "Rate limit exceeded",
            description: isRu ? "Подождите и попробуйте снова" : "Wait and try again",
            variant: "destructive",
          });
          break;
        }
        if (msg.includes("payment_required") || msg.includes("402")) {
          toast({
            title: isRu ? "Недостаточно средств" : "Payment required",
            description: isRu ? "Пополните баланс AI" : "Top up your AI credits",
            variant: "destructive",
          });
          break;
        }
      }
    }

    const finalSnapshot = buildSnapshot();
    setCharacters(finalSnapshot);
    await persist(finalSnapshot);
    setExtracting(false);
    setExtractProgress(null);

    // Show appropriate toast based on error rate
    if (errorCount >= chaptersToProcess.length) {
      toast({
        title: isRu ? "Сервер недоступен" : "Server unavailable",
        description: isRu
          ? "Не удалось связаться с AI-сервером. Попробуйте позже."
          : "Could not reach AI server. Try again later.",
        variant: "destructive",
      });
    } else if (errorCount > 0) {
      toast({
        title: isRu ? "Персонажи частично извлечены" : "Characters partially extracted",
        description: isRu
          ? `Найдено ${allResults.size} персонажей. Ошибки в ${errorCount} из ${chaptersToProcess.length} глав.`
          : `Found ${allResults.size} characters. Errors in ${errorCount} of ${chaptersToProcess.length} chapters.`,
        variant: "default",
      });
    } else {
      toast({
        title: isRu ? "Персонажи извлечены" : "Characters extracted",
        description: isRu
          ? `Найдено ${allResults.size} персонажей в ${chaptersToProcess.length} главах`
          : `Found ${allResults.size} characters in ${chaptersToProcess.length} chapters`,
      });
    }

    return finalSnapshot;
  }, [chapterResults, tocEntries, characters, setCharacters, persist, profilerModel, userApiKeys, isRu, toast]);

  return {
    extracting,
    extractProgress,
    extractCharacters,
  };
}
