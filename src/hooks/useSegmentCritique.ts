/**
 * useSegmentCritique — calls critique-translation for a single segment
 * and persists the result + writes radar-critique.json.
 */

import { useState, useCallback } from "react";
import type { Segment } from "@/components/studio/storyboard/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { LocalStoryboardData } from "@/lib/storyboardSync";
import { invokeWithFallback } from "@/lib/invokeWithFallback";
import { computeProgrammaticAxes } from "@/lib/qualityRadar";
import {
  readCritiqueRadar,
  writeCritiqueRadar,
  type CritiqueSegmentRadar,
} from "@/lib/radarStages";
import { toast } from "sonner";

interface Opts {
  translationStorage: ProjectStorage | null;
  model: string;
  userApiKeys: Record<string, string>;
  sourceLang: string;
  targetLang: string;
  isRu: boolean;
}

export function useSegmentCritique(opts: Opts) {
  const { translationStorage, model, userApiKeys, sourceLang, targetLang, isRu } = opts;
  const [critiquing, setCritiquing] = useState(false);

  const critiqueSegment = useCallback(async (
    segment: Segment,
    sceneId: string,
    chapterId: string,
    originalText: string,
  ) => {
    if (!translationStorage) return null;

    // Read current storyboard to get the literary translation
    const sbPath = `chapters/${chapterId}/scenes/${sceneId}/storyboard.json`;
    const sbData = await translationStorage.readJSON<LocalStoryboardData>(sbPath);
    const transSeg = sbData?.segments?.find(s => s.segment_id === segment.segment_id);
    const literaryText = (transSeg as any)?._literary
      || transSeg?.phrases?.map(p => p.text).filter(Boolean).join(" ")
      || "";

    if (!literaryText) {
      toast.error(isRu ? "Сначала выполните арт-правку" : "Art edit first");
      return null;
    }

    setCritiquing(true);
    try {
      // Compute programmatic deltas for the critique
      const prog = computeProgrammaticAxes(
        originalText,
        literaryText,
        sourceLang as "ru" | "en",
        targetLang as "ru" | "en",
      );

      const { data, error } = await invokeWithFallback<{
        scores: { semantic: number; sentiment: number; rhythm: number; phonetics: number; cultural: number };
        overall: number;
        verdict: string;
        issues: any[];
        summary: string;
        usedModel: string;
      }>({
        functionName: "critique-translation",
        body: {
          original: originalText,
          translation: literaryText,
          type: segment.segment_type,
          speaker: segment.speaker ?? undefined,
          sourceLang,
          targetLang,
          embeddingDeltas: {
            rhythm: prog.rhythm,
            phonetic: prog.phonetic,
          },
          model,
        },
        userApiKeys,
        isRu,
      });

      if (error || !data?.scores) {
        toast.error(isRu
          ? `Ошибка оценки: ${error?.message || "нет данных"}`
          : `Critique error: ${error?.message || "no data"}`);
        return null;
      }

      // Read existing critique radar to merge
      const existingRadar = await readCritiqueRadar(translationStorage, chapterId, sceneId);
      const existingSegments = existingRadar?.segments ?? [];
      const otherSegments = existingSegments.filter(s => s.segmentId !== segment.segment_id);

      const newSegRadar: CritiqueSegmentRadar = {
        segmentId: segment.segment_id,
        radar: {
          semantic: data.scores.semantic,
          sentiment: data.scores.sentiment,
          rhythm: data.scores.rhythm,
          phonetic: data.scores.phonetics,
          cultural: data.scores.cultural,
          weighted: data.overall,
        },
        critiqueNotes: data.issues?.map((iss: any) =>
          `[${iss.axis}/${iss.severity}] ${iss.suggestion}`
        ) ?? [],
        literary: literaryText,
      };

      await writeCritiqueRadar(
        translationStorage,
        chapterId,
        sceneId,
        [...otherSegments, newSegRadar],
      );

      const verdictLabel = data.verdict === "good"
        ? (isRu ? "Хорошо" : "Good")
        : data.verdict === "acceptable"
          ? (isRu ? "Допустимо" : "Acceptable")
          : (isRu ? "Требует доработки" : "Needs revision");

      toast.success(`${isRu ? "Оценка" : "Critique"}: ${data.overall}/100 — ${verdictLabel}`);
      return data;
    } catch (err: any) {
      console.error("[useSegmentCritique] error:", err);
      toast.error(isRu ? "Ошибка оценки" : "Critique failed");
      return null;
    } finally {
      setCritiquing(false);
    }
  }, [translationStorage, model, userApiKeys, sourceLang, targetLang, isRu]);

  return { critiqueSegment, critiquing };
}
