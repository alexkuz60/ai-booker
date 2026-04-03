/**
 * useSegmentCritique — calls critique-translation for a single segment
 * and persists the result + writes radar-critique in the lang subfolder.
 */

import { useState, useCallback } from "react";
import type { Segment } from "@/components/studio/storyboard/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { LocalStoryboardData } from "@/lib/storyboardSync";
import { paths } from "@/lib/projectPaths";
import { invokeWithFallback } from "@/lib/invokeWithFallback";
import { computeProgrammaticAxes } from "@/lib/qualityRadar";
import { invalidateRadarCache } from "@/lib/radarCache";
import {
  readCritiqueRadar,
  writeCritiqueRadar,
  type CritiqueSegmentRadar,
} from "@/lib/radarStages";
import { toast } from "sonner";

interface Opts {
  storage: ProjectStorage | null;
  model: string;
  userApiKeys: Record<string, string>;
  sourceLang: string;
  targetLang: string;
  isRu: boolean;
}

export function useSegmentCritique(opts: Opts) {
  const { storage, model, userApiKeys, sourceLang, targetLang, isRu } = opts;
  const [critiquing, setCritiquing] = useState(false);

  const critiqueSegment = useCallback(async (
    segment: Segment,
    sceneId: string,
    chapterId: string,
    originalText: string,
  ) => {
    if (!storage) return null;

    const sbPath = paths.translationStoryboard(sceneId, targetLang, chapterId);
    const sbData = await storage.readJSON<LocalStoryboardData>(sbPath);
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
      const prog = computeProgrammaticAxes(originalText, literaryText, sourceLang as "ru" | "en", targetLang as "ru" | "en");

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
          sourceLang, targetLang,
          embeddingDeltas: { rhythm: prog.rhythm, phonetic: prog.phonetic },
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

      const existingRadar = await readCritiqueRadar(storage, chapterId, sceneId, targetLang);
      const otherSegments = (existingRadar?.segments ?? []).filter(s => s.segmentId !== segment.segment_id);
      const norm = (v: number) => Math.max(0, Math.min(1, (v ?? 0) / 100));

      const newSegRadar: CritiqueSegmentRadar = {
        segmentId: segment.segment_id,
        radar: {
          semantic: norm(data.scores.semantic),
          sentiment: norm(data.scores.sentiment),
          rhythm: prog.rhythm,
          phonetic: prog.phonetic,
          cultural: norm(data.scores.cultural),
          weighted: norm(data.overall),
        },
        critiqueNotes: data.issues?.map((iss: any) => `[${iss.axis}/${iss.severity}] ${iss.suggestion}`) ?? [],
        literary: literaryText,
      };

      await writeCritiqueRadar(storage, chapterId, sceneId, [...otherSegments, newSegRadar], targetLang);
      invalidateRadarCache(sceneId, segment.segment_id);

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
  }, [storage, model, userApiKeys, sourceLang, targetLang, isRu]);

  return { critiqueSegment, critiquing };
}
