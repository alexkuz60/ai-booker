/**
 * useSegmentTranslation — calls translate-literal for segments
 * and persists results to the lang subfolder within the main project.
 */

import { useState, useCallback, useRef } from "react";
import type { Segment } from "@/components/studio/storyboard/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { LocalStoryboardData } from "@/lib/storyboardSync";
import { paths } from "@/lib/projectPaths";
import { invokeWithFallback } from "@/lib/invokeWithFallback";
import { computeProgrammaticAxes, computeSemanticScore } from "@/lib/qualityRadar";
import { readStageRadar, readCritiqueRadar, writeStageRadar, writeCritiqueRadar, type StageSegmentRadar } from "@/lib/radarStages";
import { invalidateRadarCache } from "@/lib/radarCache";
import { toast } from "sonner";

interface TranslationResult {
  /** segmentId → translated text */
  translations: Map<string, string>;
}

interface UseSegmentTranslationReturn {
  translateSegments: (
    segments: Segment[],
    sceneId: string,
    chapterId: string,
  ) => Promise<TranslationResult | null>;
  translating: boolean;
  progressLabel: string | null;
}

interface Opts {
  storage: ProjectStorage | null;
  model: string;
  userApiKeys: Record<string, string>;
  sourceLang: string;
  targetLang: string;
  isRu: boolean;
}

export function useSegmentTranslation(opts: Opts): UseSegmentTranslationReturn {
  const { storage, model, userApiKeys, sourceLang, targetLang, isRu } = opts;
  const [translating, setTranslating] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const translateSegments = useCallback(async (
    segments: Segment[],
    sceneId: string,
    chapterId: string,
  ): Promise<TranslationResult | null> => {
    if (!storage || segments.length === 0) return null;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setTranslating(true);
    setProgressLabel(isRu
      ? `Подстрочный перевод (${segments.length} блоков)…`
      : `Literal translation (${segments.length} segments)…`);

    try {
      const segmentInputs = segments.map(seg => ({
        text: seg.phrases.map(p => p.text).join(" "),
        type: seg.segment_type,
        speaker: seg.speaker ?? undefined,
      }));

      const { data, error } = await invokeWithFallback<{
        translations: { original: string; translation: string }[];
      }>({
        functionName: "translate-literal",
        body: {
          segments: segmentInputs,
          source_lang: sourceLang,
          target_lang: targetLang,
          model,
        },
        userApiKeys,
        isRu,
      });

      if (controller.signal.aborted) return null;

      if (error || !data?.translations) {
        toast.error(isRu
          ? `Ошибка перевода: ${error?.message || "нет данных"}`
          : `Translation error: ${error?.message || "no data"}`);
        return null;
      }

      const translations = new Map<string, string>();
      segments.forEach((seg, i) => {
        const translated = data.translations[i]?.translation ?? "";
        translations.set(seg.segment_id, translated);
      });

      // Persist to translation subfolder storyboard
      setProgressLabel(isRu ? "Сохранение…" : "Saving…");
      await persistTranslations(storage, sceneId, chapterId, targetLang, translations);
      await cleanDownstreamRadar(storage, sceneId, chapterId, targetLang, new Set(translations.keys()));
      await persistLiteralRadar(
        storage, sceneId, chapterId, targetLang,
        segments, translations, sourceLang, targetLang, userApiKeys,
      );
      invalidateRadarCache(sceneId);

      toast.success(isRu
        ? `Переведено ${segments.length} блоков`
        : `Translated ${segments.length} segments`);

      return { translations };
    } catch (err: any) {
      if (err.name === "AbortError") return null;
      console.error("[useSegmentTranslation] error:", err);
      toast.error(isRu ? "Ошибка перевода" : "Translation failed");
      return null;
    } finally {
      setTranslating(false);
      setProgressLabel(null);
    }
  }, [storage, model, userApiKeys, sourceLang, targetLang, isRu]);

  return { translateSegments, translating, progressLabel };
}

/**
 * Persist literal translations into the lang-subfolder storyboard.
 * Creates storyboard.json from source if it doesn't exist yet.
 */
async function persistTranslations(
  store: ProjectStorage,
  sceneId: string,
  chapterId: string,
  lang: string,
  translations: Map<string, string>,
): Promise<void> {
  const transPath = paths.translationStoryboard(sceneId, lang, chapterId);
  let existing = await store.readJSON<LocalStoryboardData>(transPath);

  // If translation storyboard doesn't exist, clone from source
  if (!existing?.segments) {
    const sourceSb = await store.readJSON<LocalStoryboardData>(paths.storyboard(sceneId, chapterId));
    if (!sourceSb?.segments) return;
    existing = { ...sourceSb, audioStatus: {} };
  }

  const updated: LocalStoryboardData = {
    ...existing,
    updatedAt: new Date().toISOString(),
    segments: existing.segments.map(seg => {
      const translatedText = translations.get(seg.segment_id);
      if (translatedText == null) return seg;
      return {
        ...seg,
        _literal: translatedText,
        _literary: undefined,
        phrases: seg.phrases.map((ph, pi) => {
          if (pi === 0) return { ...ph, text: translatedText };
          return { ...ph, text: "" };
        }),
      };
    }),
  };

  await store.writeJSON(transPath, updated);
}

async function cleanDownstreamRadar(
  store: ProjectStorage,
  sceneId: string,
  chapterId: string,
  lang: string,
  segmentIds: Set<string>,
): Promise<void> {
  const [literary, critique] = await Promise.all([
    readStageRadar(store, chapterId, sceneId, "literary", lang),
    readCritiqueRadar(store, chapterId, sceneId, lang),
  ]);

  if (literary?.segments.some(s => segmentIds.has(s.segmentId))) {
    const kept = literary.segments.filter(s => !segmentIds.has(s.segmentId));
    await writeStageRadar(store, chapterId, sceneId, "literary", kept, lang);
  }

  if (critique?.segments.some(s => segmentIds.has(s.segmentId))) {
    const kept = critique.segments.filter(s => !segmentIds.has(s.segmentId));
    await writeCritiqueRadar(store, chapterId, sceneId, kept, lang);
  }
}

async function persistLiteralRadar(
  store: ProjectStorage,
  sceneId: string,
  chapterId: string,
  lang: string,
  segments: Segment[],
  translations: Map<string, string>,
  sourceLang: string,
  targetLang: string,
  userApiKeys: Record<string, string>,
): Promise<void> {
  const existingRadar = await readStageRadar(store, chapterId, sceneId, "literal", lang);
  const translatedIds = new Set(translations.keys());
  const otherSegments = (existingRadar?.segments ?? []).filter(s => !translatedIds.has(s.segmentId));

  const newSegments = await Promise.all(
    segments.map(async (segment): Promise<StageSegmentRadar | null> => {
      const translatedText = translations.get(segment.segment_id);
      if (!translatedText) return null;

      const originalText = segment.phrases.map(phrase => phrase.text).join(" ");
      const [programmatic, semantic] = await Promise.all([
        Promise.resolve(computeProgrammaticAxes(originalText, translatedText, sourceLang as "ru" | "en", targetLang as "ru" | "en")),
        computeSemanticScore(originalText, translatedText, userApiKeys),
      ]);

      return {
        segmentId: segment.segment_id,
        radar: {
          semantic: semantic ?? 0, sentiment: 0,
          rhythm: programmatic.rhythm, phonetic: programmatic.phonetic,
          cultural: 0, weighted: 0,
        },
        literal: translatedText,
      };
    }),
  );

  await writeStageRadar(
    store, chapterId, sceneId, "literal",
    [...otherSegments, ...newSegments.filter((s): s is StageSegmentRadar => !!s)],
    lang,
  );
}
