/**
 * useSegmentLiteraryEdit — calls translate-literary for a single segment
 * and persists the result + writes radar-literary in the lang subfolder.
 */

import { useState, useCallback } from "react";
import type { Segment } from "@/components/studio/storyboard/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { LocalStoryboardData } from "@/lib/storyboardSync";
import { paths } from "@/lib/projectPaths";
import { invokeWithFallback } from "@/lib/invokeWithFallback";
import { computeProgrammaticAxes, computeSemanticScore } from "@/lib/qualityRadar";
import { invalidateRadarCache } from "@/lib/radarCache";
import {
  writeStageRadar,
  readStageRadar,
  type StageSegmentRadar,
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

export function useSegmentLiteraryEdit(opts: Opts) {
  const { storage, model, userApiKeys, sourceLang, targetLang, isRu } = opts;
  const [editing, setEditing] = useState(false);

  const editSegment = useCallback(async (
    segment: Segment,
    sceneId: string,
    chapterId: string,
    originalText: string,
  ) => {
    if (!storage) return null;

    const sbPath = paths.translationStoryboard(sceneId, targetLang, chapterId);
    const sbData = await storage.readJSON<LocalStoryboardData>(sbPath);
    const transSeg = sbData?.segments?.find(s => s.segment_id === segment.segment_id);
    const literalText = (transSeg as any)?._literal
      || transSeg?.phrases?.map(p => p.text).filter(Boolean).join(" ")
      || "";

    if (!literalText) {
      toast.error(isRu ? "Сначала выполните подстрочный перевод" : "Translate first");
      return null;
    }

    setEditing(true);
    try {
      const { data, error } = await invokeWithFallback<{
        text: string;
        notes: string[];
        usedModel: string;
      }>({
        functionName: "translate-literary",
        body: {
          original: originalText,
          literal: literalText,
          type: segment.segment_type,
          speaker: segment.speaker ?? undefined,
          sourceLang,
          targetLang,
          model,
        },
        userApiKeys,
        isRu,
      });

      if (error || !data?.text) {
        toast.error(isRu
          ? `Ошибка арт-правки: ${error?.message || "нет данных"}`
          : `Art edit error: ${error?.message || "no data"}`);
        return null;
      }

      // Update translation storyboard
      if (sbData?.segments) {
        const updated: LocalStoryboardData = {
          ...sbData,
          updatedAt: new Date().toISOString(),
          segments: sbData.segments.map(seg => {
            if (seg.segment_id !== segment.segment_id) return seg;
            return {
              ...seg,
              _literary: data.text,
              phrases: seg.phrases.map((ph, pi) => {
                if (pi === 0) return { ...ph, text: data.text };
                return { ...ph, text: "" };
              }),
            };
          }),
        };
        await storage.writeJSON(sbPath, updated);
      }

      // Compute 5R
      const prog = computeProgrammaticAxes(originalText, data.text, sourceLang as "ru" | "en", targetLang as "ru" | "en");
      const [semantic, critique] = await Promise.all([
        computeSemanticScore(originalText, data.text, userApiKeys),
        invokeWithFallback<{
          scores: { semantic: number; sentiment: number; rhythm: number; phonetics: number; cultural: number };
        }>({
          functionName: "critique-translation",
          body: {
            original: originalText,
            translation: data.text,
            type: segment.segment_type,
            speaker: segment.speaker ?? undefined,
            sourceLang, targetLang,
            embeddingDeltas: { rhythm: prog.rhythm, phonetic: prog.phonetic },
            model,
          },
          userApiKeys,
          isRu,
        }),
      ]);

      const normCritiqueAxis = (value?: number) => Math.max(0, Math.min(1, (value ?? 0) / 100));
      const critiqueScores = critique.data?.scores;

      const existingRadar = await readStageRadar(storage, chapterId, sceneId, "literary", targetLang);
      const otherSegments = (existingRadar?.segments ?? []).filter(s => s.segmentId !== segment.segment_id);

      if (critique.error || !critiqueScores) {
        const fallbackRadar: StageSegmentRadar = {
          segmentId: segment.segment_id,
          radar: { semantic: semantic ?? 0, sentiment: 0, rhythm: prog.rhythm, phonetic: prog.phonetic, cultural: 0, weighted: 0 },
          critiqueNotes: data.notes,
          literary: data.text,
        };
        await writeStageRadar(storage, chapterId, sceneId, "literary", [...otherSegments, fallbackRadar], targetLang);
        invalidateRadarCache(sceneId, segment.segment_id);
        toast.warning(isRu ? "Арт-правка сохранена, 5R частичный" : "Art edit saved, 5R partial");
        return { text: data.text, notes: data.notes };
      }

      const newSegRadar: StageSegmentRadar = {
        segmentId: segment.segment_id,
        radar: {
          semantic: normCritiqueAxis(critiqueScores.semantic),
          sentiment: normCritiqueAxis(critiqueScores.sentiment),
          rhythm: prog.rhythm,
          phonetic: prog.phonetic,
          cultural: normCritiqueAxis(critiqueScores.cultural),
          weighted: 0,
        },
        critiqueNotes: data.notes,
        literary: data.text,
      };

      await writeStageRadar(storage, chapterId, sceneId, "literary", [...otherSegments, newSegRadar], targetLang);
      invalidateRadarCache(sceneId, segment.segment_id);

      toast.success(isRu ? "Арт-правка выполнена" : "Art edit complete");
      return { text: data.text, notes: data.notes };
    } catch (err: any) {
      console.error("[useSegmentLiteraryEdit] error:", err);
      toast.error(isRu ? "Ошибка арт-правки" : "Art edit failed");
      return null;
    } finally {
      setEditing(false);
    }
  }, [storage, model, userApiKeys, sourceLang, targetLang, isRu]);

  return { editSegment, editing };
}
