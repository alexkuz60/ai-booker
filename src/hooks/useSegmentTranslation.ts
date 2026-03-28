/**
 * useSegmentTranslation — calls translate-literal for segments
 * and persists results to the translation project storage.
 */

import { useState, useCallback, useRef } from "react";
import type { Segment } from "@/components/studio/storyboard/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { LocalStoryboardData } from "@/lib/storyboardSync";
import { invokeWithFallback } from "@/lib/invokeWithFallback";
import { toast } from "sonner";

interface TranslationResult {
  /** segmentId → translated text */
  translations: Map<string, string>;
}

interface UseSegmentTranslationReturn {
  /** Translate specific segments */
  translateSegments: (
    segments: Segment[],
    sceneId: string,
    chapterId: string,
  ) => Promise<TranslationResult | null>;
  /** Currently translating */
  translating: boolean;
  /** Progress label */
  progressLabel: string | null;
}

interface Opts {
  sourceStorage: ProjectStorage | null;
  translationStorage: ProjectStorage | null;
  model: string;
  userApiKeys: Record<string, string>;
  sourceLang: string;
  targetLang: string;
  isRu: boolean;
}

export function useSegmentTranslation(opts: Opts): UseSegmentTranslationReturn {
  const { sourceStorage, translationStorage, model, userApiKeys, sourceLang, targetLang, isRu } = opts;
  const [translating, setTranslating] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const translateSegments = useCallback(async (
    segments: Segment[],
    sceneId: string,
    chapterId: string,
  ): Promise<TranslationResult | null> => {
    if (!sourceStorage || !translationStorage || segments.length === 0) return null;

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

      // Build result map
      const translations = new Map<string, string>();
      segments.forEach((seg, i) => {
        const translated = data.translations[i]?.translation ?? "";
        translations.set(seg.segment_id, translated);
      });

      // Persist to translation project storyboard
      setProgressLabel(isRu ? "Сохранение…" : "Saving…");
      await persistTranslations(translationStorage, sceneId, chapterId, translations);

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
  }, [sourceStorage, translationStorage, model, userApiKeys, sourceLang, targetLang, isRu]);

  return { translateSegments, translating, progressLabel };
}

/**
 * Persist literal translations into the translation project's storyboard.
 * Merges with existing storyboard — only updates segments that were translated.
 */
async function persistTranslations(
  store: ProjectStorage,
  sceneId: string,
  chapterId: string,
  translations: Map<string, string>,
): Promise<void> {
  const sbPath = `chapters/${chapterId}/scenes/${sceneId}/storyboard.json`;
  const existing = await store.readJSON<LocalStoryboardData>(sbPath);
  if (!existing?.segments) return;

  const updated: LocalStoryboardData = {
    ...existing,
    updatedAt: new Date().toISOString(),
    segments: existing.segments.map(seg => {
      const translatedText = translations.get(seg.segment_id);
      if (translatedText == null) return seg;

      // Store literal translation in a separate field for pipeline
      return {
        ...seg,
        _literal: translatedText,
        phrases: seg.phrases.map((ph, pi) => {
          // For now, put full translation in first phrase, rest empty
          // Pipeline step 2 (literary) will redistribute properly
          if (pi === 0) return { ...ph, text: translatedText };
          return { ...ph, text: "" };
        }),
      };
    }),
  };

  await store.writeJSON(sbPath, updated);
}
