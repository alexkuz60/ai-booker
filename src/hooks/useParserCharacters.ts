/**
 * Hook for managing characters in the Parser module (local-first).
 * Uses AI (Profiler role) to extract characters from analyzed scenes.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { Scene, ChapterStatus, TocChapter, LocalCharacter, CharacterAppearance } from "@/pages/parser/types";
import { saveCharactersToLocal, readCharactersFromLocal } from "@/lib/localSync";

interface UseParserCharactersParams {
  storage: ProjectStorage | null;
  tocEntries: TocChapter[];
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  bookId: string | null;
  /** Resolved model for the profiler role */
  profilerModel?: string;
  isRu?: boolean;
}

function generateId(): string {
  return crypto.randomUUID();
}

export function useParserCharacters({
  storage,
  tocEntries,
  chapterResults,
  bookId,
  profilerModel = "google/gemini-2.5-flash",
  isRu = true,
}: UseParserCharactersParams) {
  const [characters, setCharacters] = useState<LocalCharacter[]>([]);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<string | null>(null);
  const loadedBookRef = useRef<string | null>(null);
  const { toast } = useToast();

  // Load characters from local storage when book changes
  useEffect(() => {
    if (!storage || !bookId || bookId === loadedBookRef.current) return;
    loadedBookRef.current = bookId;
    (async () => {
      setLoading(true);
      const loaded = await readCharactersFromLocal(storage);
      setCharacters(loaded);
      setLoading(false);
    })();
  }, [storage, bookId]);

  // Save helper
  const persist = useCallback(async (chars: LocalCharacter[]) => {
    if (!storage) return;
    await saveCharactersToLocal(storage, chars);
  }, [storage]);

  // Extract characters using AI (per-chapter, then merge)
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

    for (let ci = 0; ci < chaptersToProcess.length; ci++) {
      const { idx, entry, scenes } = chaptersToProcess[ci];
      setExtractProgress(
        isRu
          ? `Глава ${ci + 1}/${chaptersToProcess.length}: ${entry.title.slice(0, 40)}`
          : `Chapter ${ci + 1}/${chaptersToProcess.length}: ${entry.title.slice(0, 40)}`
      );

      // Build scenes payload for AI
      const scenesPayload = scenes
        .filter(s => s.content && s.content.length > 20)
        .map(s => ({
          scene_number: s.scene_number,
          text: s.content!,
        }));

      if (scenesPayload.length === 0) continue;

      try {
        const { data, error } = await supabase.functions.invoke("extract-characters", {
          body: {
            scenes: scenesPayload,
            lang: isRu ? "ru" : "en",
            model: profilerModel,
          },
        });

        if (error) {
          console.error("extract-characters error for chapter", idx, error);
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

          // Check if this character (or an alias) already exists in results
          let existingKey: string | null = null;
          for (const [k, v] of allResults) {
            if (k === key) { existingKey = k; break; }
            if (v.aliases.some(a => a.toLowerCase() === key)) { existingKey = k; break; }
            if (char.aliases.some(a => a.toLowerCase() === k)) { existingKey = k; break; }
          }

          if (existingKey) {
            const existing = allResults.get(existingKey)!;
            // Merge aliases
            const allAliases = new Set([...existing.aliases, ...char.aliases]);
            allAliases.delete(existing.name);
            existing.aliases = Array.from(allAliases);
            // Merge gender (prefer non-unknown)
            if (existing.gender === "unknown" && char.gender !== "unknown") {
              existing.gender = char.gender;
            }
            // Add appearance for this chapter
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
      } catch (err) {
        console.error("AI extraction failed for chapter", idx, err);
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

    // Merge with existing characters (keep manually edited data)
    const existingByName = new Map<string, LocalCharacter>();
    for (const ch of characters) {
      existingByName.set(ch.name.toLowerCase(), ch);
      for (const alias of ch.aliases) {
        existingByName.set(alias.toLowerCase(), ch);
      }
    }

    const updated: LocalCharacter[] = [...characters];
    const usedIds = new Set(characters.map(c => c.id));

    for (const [key, data] of allResults) {
      const existing = existingByName.get(key)
        || data.aliases.reduce<LocalCharacter | undefined>(
          (found, a) => found || existingByName.get(a.toLowerCase()),
          undefined,
        );

      if (existing) {
        // Update appearances & gender, keep manually set data
        existing.appearances = data.appearances;
        existing.sceneCount = data.sceneCount;
        if ((!existing.gender || existing.gender === "unknown") && data.gender !== "unknown") {
          existing.gender = data.gender;
        }
        // Merge new aliases
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
        updated.push(newChar);
        usedIds.add(newChar.id);
        existingByName.set(key, newChar);
      }
    }

    // Sort by scene count descending
    updated.sort((a, b) => b.sceneCount - a.sceneCount);

    setCharacters(updated);
    await persist(updated);
    setExtracting(false);
    setExtractProgress(null);

    toast({
      title: isRu ? "Персонажи извлечены" : "Characters extracted",
      description: isRu
        ? `Найдено ${allResults.size} персонажей в ${chaptersToProcess.length} главах`
        : `Found ${allResults.size} characters in ${chaptersToProcess.length} chapters`,
    });

    return updated;
  }, [chapterResults, tocEntries, characters, persist, profilerModel, isRu, toast]);

  // CRUD operations
  const renameCharacter = useCallback(async (id: string, newName: string) => {
    setCharacters(prev => {
      const next = prev.map(c => c.id === id ? { ...c, name: newName } : c);
      persist(next);
      return next;
    });
  }, [persist]);

  const updateAliases = useCallback(async (id: string, aliases: string[]) => {
    setCharacters(prev => {
      const next = prev.map(c => c.id === id ? { ...c, aliases } : c);
      persist(next);
      return next;
    });
  }, [persist]);

  const deleteCharacter = useCallback(async (id: string) => {
    setCharacters(prev => {
      const next = prev.filter(c => c.id !== id);
      persist(next);
      return next;
    });
  }, [persist]);

  const mergeCharacters = useCallback(async (sourceId: string, targetId: string) => {
    setCharacters(prev => {
      const source = prev.find(c => c.id === sourceId);
      const target = prev.find(c => c.id === targetId);
      if (!source || !target) return prev;

      const allAliases = new Set([...target.aliases, source.name, ...source.aliases]);
      allAliases.delete(target.name);

      const appMap = new Map<number, CharacterAppearance>();
      for (const app of [...target.appearances, ...source.appearances]) {
        const existing = appMap.get(app.chapterIdx);
        if (existing) {
          const scenes = new Set([...existing.sceneNumbers, ...app.sceneNumbers]);
          existing.sceneNumbers = Array.from(scenes).sort((a, b) => a - b);
        } else {
          appMap.set(app.chapterIdx, { ...app });
        }
      }

      const merged: LocalCharacter = {
        ...target,
        aliases: Array.from(allAliases),
        gender: target.gender || source.gender,
        appearances: Array.from(appMap.values()),
        sceneCount: Array.from(appMap.values()).reduce((sum, a) => sum + a.sceneNumbers.length, 0),
      };

      const next = prev.filter(c => c.id !== sourceId).map(c => c.id === targetId ? merged : c);
      persist(next);
      return next;
    });
  }, [persist]);

  const addCharacter = useCallback(async (name: string) => {
    const newChar: LocalCharacter = {
      id: generateId(),
      name,
      aliases: [],
      appearances: [],
      sceneCount: 0,
    };
    setCharacters(prev => {
      const next = [...prev, newChar];
      persist(next);
      return next;
    });
    return newChar;
  }, [persist]);

  return {
    characters,
    loading,
    extracting,
    extractProgress,
    extractCharacters,
    renameCharacter,
    updateAliases,
    deleteCharacter,
    mergeCharacters,
    addCharacter,
  };
}
