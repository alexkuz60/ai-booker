/**
 * useTranslationSynopsis — manages synopsis context for translation pipeline.
 *
 * Provides read/write/generate for all three levels:
 * - Book meta (era, genre, style)
 * - Chapter synopsis (summary, tone, themes)
 * - Scene synopsis (events, characters, mood, setting)
 *
 * Pre-flight logic:
 *   Before sending to the edge function the hook estimates input token count,
 *   trims content to fit the model context window, and calculates a sensible
 *   maxOutputTokens value.  This avoids truncated/empty AI responses.
 */

import { useState, useCallback } from "react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { CharacterIndex } from "@/pages/parser/types";
import {
  type BookMetaSynopsis,
  type ChapterSynopsis,
  type SceneSynopsis,
  readBookMeta,
  readChapterSynopsis,
  readSceneSynopsis,
  saveBookMeta,
  saveChapterSynopsis,
  saveSceneSynopsis,
  emptyBookMeta,
  emptyChapterSynopsis,
  emptySceneSynopsis,
  extractSceneCharacterProfiles,
} from "@/lib/translationSynopsis";
import { readCharacterIndex } from "@/lib/localCharacters";
import { getSceneCharacterIds } from "@/lib/localCharacters";
import { paths } from "@/lib/projectPaths";
import { invokeWithFallback } from "@/lib/invokeWithFallback";
import { toast } from "sonner";

// ─── Pre-flight helpers ─────────────────────────────────────────────

/** Rough chars → tokens ratio (≈4 chars per token for mixed ru/en text) */
const CHARS_PER_TOKEN = 3.5;

/** Known context window sizes by model pattern */
const MODEL_CONTEXT_LIMITS: Array<[RegExp, number]> = [
  [/gemini-2\.5-pro|gemini-3/i, 1_000_000],
  [/gemini-2\.5-flash/i, 1_000_000],
  [/gpt-5\.2/i, 256_000],
  [/gpt-5/i, 128_000],
  [/gpt-4o/i, 128_000],
  [/claude/i, 200_000],
  [/deepseek/i, 128_000],
  [/qwen/i, 32_000],
];

const DEFAULT_CONTEXT = 128_000;

function getModelContextWindow(model: string): number {
  for (const [re, limit] of MODEL_CONTEXT_LIMITS) {
    if (re.test(model)) return limit;
  }
  return DEFAULT_CONTEXT;
}

interface PreflightResult {
  trimmedContent: string;
  maxOutputTokens: number;
  inputChars: number;
  wasTrimmed: boolean;
}

/**
 * Estimate token budget and trim content to fit model context.
 *
 * Reserves tokens for: system prompt (~500), output (1024-4096), safety margin (512).
 */
function prepareSynopsisRequest(
  content: string,
  model: string,
  level: "chapter" | "scene",
): PreflightResult {
  const contextWindow = getModelContextWindow(model);
  const systemPromptTokens = 500; // conservative estimate
  const safetyMargin = 512;
  // Chapter synopses need more output (themes list, summary) than scene
  const desiredOutputTokens = level === "chapter" ? 2048 : 1024;

  const budgetForInput = contextWindow - systemPromptTokens - desiredOutputTokens - safetyMargin;
  const maxInputChars = Math.floor(budgetForInput * CHARS_PER_TOKEN);

  const wasTrimmed = content.length > maxInputChars;
  const trimmedContent = wasTrimmed ? content.slice(0, maxInputChars) : content;

  // Actual input tokens estimate
  const actualInputTokens = Math.ceil(trimmedContent.length / CHARS_PER_TOKEN) + systemPromptTokens;
  // Ensure output fits within remaining budget
  const maxOutputTokens = Math.min(
    desiredOutputTokens,
    Math.max(1024, contextWindow - actualInputTokens - safetyMargin),
  );

  return { trimmedContent, maxOutputTokens, inputChars: content.length, wasTrimmed };
}

// ─── Hook ───────────────────────────────────────────────────────────

interface Opts {
  /** Source project storage (original book) */
  sourceStorage: ProjectStorage | null;
  /** Translation project storage */
  translationStorage: ProjectStorage | null;
  isRu: boolean;
  model: string;
  userApiKeys: Record<string, string>;
  sourceLang: string;
}

export function useTranslationSynopsis(opts: Opts) {
  const { sourceStorage, translationStorage, isRu, model, userApiKeys, sourceLang } = opts;

  const [bookMeta, setBookMeta] = useState<BookMetaSynopsis | null>(null);
  const [chapterSynopsis, setChapterSynopsis] = useState<ChapterSynopsis | null>(null);
  const [sceneSynopsis, setSceneSynopsis] = useState<SceneSynopsis | null>(null);
  const [generating, setGenerating] = useState<"book" | "chapter" | "scene" | null>(null);

  // ── Load from OPFS ──────────────────────────────────────

  const loadAll = useCallback(async (chapterId: string, sceneId: string) => {
    const store = translationStorage || sourceStorage;
    if (!store) return;

    const [bm, cs, ss] = await Promise.all([
      readBookMeta(store),
      readChapterSynopsis(store, chapterId),
      readSceneSynopsis(store, sceneId),
    ]);

    setBookMeta(bm ?? emptyBookMeta());
    setChapterSynopsis(cs ?? emptyChapterSynopsis(chapterId));
    setSceneSynopsis(ss ?? emptySceneSynopsis(sceneId));
  }, [translationStorage, sourceStorage]);

  // ── Save to OPFS ────────────────────────────────────────

  const saveAll = useCallback(async () => {
    const store = translationStorage || sourceStorage;
    if (!store) return;

    const tasks: Promise<void>[] = [];
    if (bookMeta) tasks.push(saveBookMeta(store, bookMeta));
    if (chapterSynopsis) tasks.push(saveChapterSynopsis(store, chapterSynopsis));
    if (sceneSynopsis) tasks.push(saveSceneSynopsis(store, sceneSynopsis));
    await Promise.all(tasks);
  }, [translationStorage, sourceStorage, bookMeta, chapterSynopsis, sceneSynopsis]);

  // ── AI generation ───────────────────────────────────────

  const generateChapter = useCallback(async (chapterId: string) => {
    if (!sourceStorage) return;
    setGenerating("chapter");
    try {
      // Gather chapter content from storyboards
      const sceneIndex = await sourceStorage.readJSON<Record<string, any>>(paths.sceneIndex());
      const entries = sceneIndex?.entries ?? {};
      const chapterScenes = Object.entries(entries)
        .filter(([, v]: [string, any]) => v.chapterId === chapterId)
        .map(([sid]) => sid);

      const texts: string[] = [];
      for (const sid of chapterScenes) {
        const sb = await sourceStorage.readJSON<any>(paths.storyboard(sid, chapterId));
        if (sb?.segments) {
          for (const seg of sb.segments) {
            const t = seg.phrases?.map((p: any) => p.text).join(" ") || seg.text || "";
            if (t.trim()) texts.push(t);
          }
        }
      }

      const rawContent = texts.join("\n\n");

      // Pre-flight: trim content & compute token limits
      const preflight = prepareSynopsisRequest(rawContent, model, "chapter");
      if (preflight.wasTrimmed) {
        console.warn(
          `[synopsis] Chapter content trimmed: ${preflight.inputChars} → ${preflight.trimmedContent.length} chars ` +
          `(model context: ${getModelContextWindow(model)} tokens)`,
        );
      }

      const result = await invokeWithFallback<any>({
        functionName: "generate-synopsis",
        body: {
          level: "chapter",
          content: preflight.trimmedContent,
          lang: sourceLang,
          model,
          maxOutputTokens: preflight.maxOutputTokens,
        },
        userApiKeys,
        isRu,
      });

      if (result.data && !result.error) {
        const cs: ChapterSynopsis = {
          chapterId,
          summary: result.data.summary || "",
          tone: result.data.tone || "",
          keyThemes: result.data.keyThemes || [],
        };
        setChapterSynopsis(cs);
        const store = translationStorage || sourceStorage;
        if (store) await saveChapterSynopsis(store, cs);
        toast.success(isRu ? "Синопсис главы сгенерирован" : "Chapter synopsis generated");
      } else {
        toast.error(isRu ? "Ошибка генерации" : "Generation error");
      }
    } catch (e) {
      console.error("generateChapter error:", e);
      toast.error(String(e));
    } finally {
      setGenerating(null);
    }
  }, [sourceStorage, translationStorage, model, userApiKeys, sourceLang, isRu]);

  const generateScene = useCallback(async (sceneId: string, chapterId: string) => {
    if (!sourceStorage) return;
    setGenerating("scene");
    try {
      const sb = await sourceStorage.readJSON<any>(paths.storyboard(sceneId, chapterId));
      const texts: string[] = [];
      if (sb?.segments) {
        for (const seg of sb.segments) {
          const prefix = seg.speaker ? `[${seg.speaker}] ` : "";
          const t = seg.phrases?.map((p: any) => p.text).join(" ") || seg.text || "";
          if (t.trim()) texts.push(`${prefix}${t}`);
        }
      }

      // Get character profiles for the scene
      const characters = await readCharacterIndex(sourceStorage);
      const charIds = await getSceneCharacterIds(sourceStorage, sceneId);
      const charProfiles = extractSceneCharacterProfiles(characters, charIds);

      const rawContent = texts.join("\n");

      // Pre-flight: trim content & compute token limits
      const preflight = prepareSynopsisRequest(rawContent, model, "scene");
      if (preflight.wasTrimmed) {
        console.warn(
          `[synopsis] Scene content trimmed: ${preflight.inputChars} → ${preflight.trimmedContent.length} chars`,
        );
      }

      const result = await invokeWithFallback<any>({
        functionName: "generate-synopsis",
        body: {
          level: "scene",
          content: preflight.trimmedContent,
          lang: sourceLang,
          model,
          maxOutputTokens: preflight.maxOutputTokens,
          characters: charProfiles.map((c) => ({
            name: c.name,
            gender: c.gender,
            temperament: c.temperament,
            speech_style: c.speech_style,
          })),
        },
        userApiKeys,
        isRu,
      });

      if (result.data && !result.error) {
        const ss: SceneSynopsis = {
          sceneId,
          events: result.data.events || "",
          mood: result.data.mood || "",
          setting: result.data.setting || "",
          characters: charProfiles,
        };
        setSceneSynopsis(ss);
        const store = translationStorage || sourceStorage;
        if (store) await saveSceneSynopsis(store, ss);
        toast.success(isRu ? "Синопсис сцены сгенерирован" : "Scene synopsis generated");
      } else {
        toast.error(isRu ? "Ошибка генерации" : "Generation error");
      }
    } catch (e) {
      console.error("generateScene error:", e);
      toast.error(String(e));
    } finally {
      setGenerating(null);
    }
  }, [sourceStorage, translationStorage, model, userApiKeys, sourceLang, isRu]);

  return {
    bookMeta,
    chapterSynopsis,
    sceneSynopsis,
    setBookMeta,
    setChapterSynopsis,
    setSceneSynopsis,
    loadAll,
    saveAll,
    generateChapter,
    generateScene,
    generating,
  };
}
