/**
 * AI-powered character extraction from analyzed scenes.
 * Iterates chapters, calls extract-characters edge function,
 * merges results live into UI state.
 *
 * When a model pool is configured for the "profiler" role,
 * chapters are distributed across pool workers via ModelPoolManager.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getModelRegistryEntry } from "@/config/modelRegistry";
import { ModelPoolManager, type PoolTask, type PoolStats } from "@/lib/modelPoolManager";
import type { Scene, ChapterStatus, TocChapter, LocalCharacter, CharacterAppearance, CharacterRole } from "@/pages/parser/types";

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
  /** Effective pool for the profiler role (from useAiRoles.getEffectivePool) */
  effectivePool?: string[];
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
  effectivePool,
}: UseCharacterExtractionParams) {
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<string | null>(null);
  const [extractPoolStats, setExtractPoolStats] = useState<PoolStats[]>([]);
  const [extractedCount, setExtractedCount] = useState(0);
  const [extractTotal, setExtractTotal] = useState(0);
  const { toast } = useToast();

  const extractCharacters = useCallback(async (opts?: { mode?: "fresh" | "continue" | "chapter"; chapterIdx?: number }) => {
    const mode = opts?.mode ?? "continue";
    setExtracting(true);
    setExtractProgress(isRu ? "Подготовка…" : "Preparing…");

    // ── "fresh" mode: wipe all non-system characters (including profiles) ──
    if (mode === "fresh") {
      const systemOnly = characters.filter(c => c.role === "system");
      setCharacters(systemOnly);
      await persist(systemOnly);
    }

    // ── Pre-populate system characters (Narrator + Commentator) if absent ──
    const SYSTEM_CHARS: Array<{ name: string; nameEn: string; role: CharacterRole }> = [
      { name: "Рассказчик", nameEn: "Narrator", role: "system" },
      { name: "Комментатор", nameEn: "Commentator", role: "system" },
    ];

    let currentChars = mode === "fresh" ? characters.filter(c => c.role === "system") : characters;
    const needSystemInsert: LocalCharacter[] = [];
    for (const sys of SYSTEM_CHARS) {
      const exists = currentChars.some(c =>
        c.name.toLowerCase() === sys.name.toLowerCase() ||
        c.name.toLowerCase() === sys.nameEn.toLowerCase() ||
        c.aliases.some(a => a.toLowerCase() === sys.name.toLowerCase() || a.toLowerCase() === sys.nameEn.toLowerCase())
      );
      if (!exists) {
        needSystemInsert.push({
          id: generateId(),
          name: isRu ? sys.name : sys.nameEn,
          aliases: isRu ? [sys.nameEn] : [sys.name],
          gender: "unknown",
          role: sys.role,
          appearances: [],
          sceneCount: 0,
        });
      }
    }
    if (needSystemInsert.length > 0) {
      currentChars = [...currentChars, ...needSystemInsert];
      setCharacters(currentChars);
      await persist(currentChars);
    }

    // Collect chapters that have analyzed scenes
    const chaptersToProcess: { idx: number; entry: TocChapter; scenes: Scene[] }[] = [];

    // Build set of chapter indices where characters were already extracted
    const alreadyExtractedIdx = new Set<number>();
    for (const ch of currentChars) {
      if (ch.role === "system") continue;
      for (const app of ch.appearances) {
        alreadyExtractedIdx.add(app.chapterIdx);
      }
    }

    chapterResults.forEach((result, idx) => {
      if (result.status !== "done" || !result.scenes?.length) return;
      if (mode === "chapter") {
        if (idx !== opts?.chapterIdx) return;
      } else if (mode === "continue") {
        if (alreadyExtractedIdx.has(idx)) return;
      }
      const entry = tocEntries[idx];
      if (!entry) return;
      chaptersToProcess.push({ idx, entry, scenes: result.scenes });
    });

    if (chaptersToProcess.length === 0) {
      setExtracting(false);
      setExtractProgress(null);
      toast({
        title: isRu
          ? (alreadyExtractedIdx.size > 0 ? "Все главы уже обработаны" : "Нет проанализированных глав")
          : (alreadyExtractedIdx.size > 0 ? "All chapters already processed" : "No analyzed chapters"),
        variant: alreadyExtractedIdx.size > 0 ? "default" : "destructive",
      });
      return;
    }

    if (alreadyExtractedIdx.size > 0) {
      console.log(`[CharExtract] Skipping ${alreadyExtractedIdx.size} already-extracted chapters, processing ${chaptersToProcess.length} new`);
    }

    // Accumulate all characters across chapters
    const allResults = new Map<string, {
      name: string;
      aliases: string[];
      gender: "male" | "female" | "unknown";
      role: CharacterRole;
      age_hint?: string;
      manner_hint?: string;
      appearances: CharacterAppearance[];
      sceneCount: number;
    }>();

    // Build intermediate LocalCharacter[] snapshot from allResults merged with existing
    const buildSnapshot = (): LocalCharacter[] => {
      const baseChars = mode === "fresh" ? currentChars : characters;
      const existingByName = new Map<string, LocalCharacter>();
      for (const ch of baseChars) {
        existingByName.set(ch.name.toLowerCase(), ch);
        for (const alias of ch.aliases) existingByName.set(alias.toLowerCase(), ch);
      }

      const snapshot: LocalCharacter[] = [...baseChars];
      const usedIds = new Set(baseChars.map(c => c.id));

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
          if (!existing.age_hint && data.age_hint) existing.age_hint = data.age_hint;
          if (!existing.manner_hint && data.manner_hint) existing.manner_hint = data.manner_hint;
          if (existing.role === "mentioned" && (data.role === "speaking" || data.role === "crowd")) {
            existing.role = data.role;
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
            role: data.role,
            age_hint: data.age_hint,
            manner_hint: data.manner_hint,
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

    // ── Merge a single chapter's extraction results into allResults ──
    const mergeChapterResults = (
      idx: number,
      entry: TocChapter,
      extracted: Array<{
        name: string;
        aliases: string[];
        gender: "male" | "female" | "unknown";
        role?: "speaking" | "mentioned" | "crowd";
        scene_numbers: number[];
        age_hint?: string;
        manner_hint?: string;
      }>,
    ) => {
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
          if (!existing.age_hint && char.age_hint) existing.age_hint = char.age_hint;
          if (!existing.manner_hint && char.manner_hint) existing.manner_hint = char.manner_hint;
          const charRole = char.role || "speaking";
          if (existing.role === "mentioned" && charRole !== "mentioned") {
            existing.role = charRole;
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
            role: char.role || "speaking",
            age_hint: char.age_hint,
            manner_hint: char.manner_hint,
            appearances: [{
              chapterIdx: idx,
              chapterTitle: entry.title,
              sceneNumbers: char.scene_numbers,
            }],
            sceneCount: char.scene_numbers.length,
          });
        }
      }
    };

    // ── Invoke edge function for a single chapter ──
    const invokeForChapter = async (
      chapterData: typeof chaptersToProcess[0],
      modelId: string,
    ) => {
      const scenesPayload = chapterData.scenes
        .filter(s => s.content && s.content.length > 20)
        .map(s => ({ scene_number: s.scene_number, text: s.content! }));
      if (scenesPayload.length === 0) return null;

      const registryEntry = getModelRegistryEntry(modelId);
      const apiKeyForModel = registryEntry?.apiKeyField
        ? userApiKeys[registryEntry.apiKeyField] || null
        : null;

      const { data, error } = await supabase.functions.invoke("extract-characters", {
        body: {
          scenes: scenesPayload,
          lang: isRu ? "ru" : "en",
          model: modelId,
          apiKey: apiKeyForModel,
        },
      });
      if (error) throw error;
      return data?.characters || [];
    };

    let errorCount = 0;
    const usePool = effectivePool && effectivePool.length > 1;
    setExtractedCount(0);
    setExtractTotal(chaptersToProcess.length);

    if (usePool) {
      // ── Pool mode: distribute chapters across models ──
      console.log(`[CharExtract] Pool mode: ${effectivePool.length} models, ${chaptersToProcess.length} chapters`);
      setExtractProgress(
        isRu
          ? `Пул: ${effectivePool.length} моделей × ${chaptersToProcess.length} глав`
          : `Pool: ${effectivePool.length} models × ${chaptersToProcess.length} chapters`
      );

      const manager = new ModelPoolManager(effectivePool, userApiKeys, 2);
      let completedChapters = 0;
      const tasks: PoolTask<{ idx: number; entry: TocChapter; extracted: any[] }>[] =
        chaptersToProcess.map(ch => ({
          id: String(ch.idx),
          execute: async (modelId: string) => {
            setExtractProgress(
              isRu
                ? `Глава ${ch.idx + 1}: ${ch.entry.title.slice(0, 40)}`
                : `Chapter ${ch.idx + 1}: ${ch.entry.title.slice(0, 40)}`
            );
            const extracted = await invokeForChapter(ch, modelId);
            const result = extracted || [];
            // Incremental merge + UI update
            if (result.length > 0) {
              mergeChapterResults(ch.idx, ch.entry, result);
            }
            completedChapters++;
            setExtractedCount(completedChapters);
            setCharacters(buildSnapshot());
            return { idx: ch.idx, entry: ch.entry, extracted: result };
          },
        }));

      const results = await manager.runAll(tasks, (progress) => {
        setExtractProgress(
          isRu
            ? `Извлечение: ${progress.done}/${progress.total} глав`
            : `Extracting: ${progress.done}/${progress.total} chapters`
        );
        setExtractPoolStats(manager.getStats());
      });
      setExtractPoolStats(manager.getStats());

      // Merge all results (maintain order for consistency)
      const sortedKeys = [...results.keys()].sort((a, b) => Number(a) - Number(b));
      for (const key of sortedKeys) {
        const result = results.get(key)!;
        if (result instanceof Error) {
          errorCount++;
          console.error(`[CharExtract] Pool error for chapter ${key}:`, result.message);
        } else {
          mergeChapterResults(result.idx, result.entry, result.extracted);
        }
      }
      setCharacters(buildSnapshot());

    } else {
      // ── Classic sequential mode ──
      for (let ci = 0; ci < chaptersToProcess.length; ci++) {
        const chapterData = chaptersToProcess[ci];
        setExtractProgress(
          isRu
            ? `Глава ${ci + 1}/${chaptersToProcess.length}: ${chapterData.entry.title.slice(0, 40)}`
            : `Chapter ${ci + 1}/${chaptersToProcess.length}: ${chapterData.entry.title.slice(0, 40)}`
        );

        try {
          const extracted = await invokeForChapter(chapterData, profilerModel);
          if (extracted) {
            mergeChapterResults(chapterData.idx, chapterData.entry, extracted);
          }
          setCharacters(buildSnapshot());
        } catch (err) {
          console.error("AI extraction failed for chapter", chapterData.idx, err);
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
    }

    const finalSnapshot = buildSnapshot();
    setCharacters(finalSnapshot);
    await persist(finalSnapshot);
    setExtracting(false);
    setExtractProgress(null);
    setExtractPoolStats([]);

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
  }, [chapterResults, tocEntries, characters, setCharacters, persist, profilerModel, userApiKeys, isRu, toast, effectivePool]);

  return {
    extracting,
    extractProgress,
    extractPoolStats,
    extractCharacters,
  };
}
