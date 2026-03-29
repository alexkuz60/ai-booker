/**
 * useSegmentLiteraryEdit — calls translate-literary for a single segment
 * and persists the result + writes radar-literary.json.
 */

import { useState, useCallback } from "react";
import type { Segment } from "@/components/studio/storyboard/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { LocalStoryboardData } from "@/lib/storyboardSync";
import { invokeWithFallback } from "@/lib/invokeWithFallback";
import { computeProgrammaticAxes, computeSemanticScore } from "@/lib/qualityRadar";
import { invalidateRadarCache } from "@/components/translation/QualityMonitorPanel";
import {
  writeStageRadar,
  readStageRadar,
  type StageSegmentRadar,
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

export function useSegmentLiteraryEdit(opts: Opts) {
  const { translationStorage, model, userApiKeys, sourceLang, targetLang, isRu } = opts;
  const [editing, setEditing] = useState(false);

  const editSegment = useCallback(async (
    segment: Segment,
    sceneId: string,
    chapterId: string,
    originalText: string,
  ) => {
    if (!translationStorage) return null;

    // Read current storyboard to get the literal translation
    const sbPath = `chapters/${chapterId}/scenes/${sceneId}/storyboard.json`;
    const sbData = await translationStorage.readJSON<LocalStoryboardData>(sbPath);
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

      // Update storyboard with literary text
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
        await translationStorage.writeJSON(sbPath, updated);
      }

      // Compute full 5R for literary stage so the overlay is a real pentagon
      const prog = computeProgrammaticAxes(
        originalText,
        data.text,
        sourceLang as "ru" | "en",
        targetLang as "ru" | "en",
      );
      const [semantic, critique] = await Promise.all([
        computeSemanticScore(originalText, data.text, userApiKeys),
        invokeWithFallback<{
          scores: {
            semantic: number;
            sentiment: number;
            rhythm: number;
            phonetics: number;
            cultural: number;
          };
        }>({
          functionName: "critique-translation",
          body: {
            original: originalText,
            translation: data.text,
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
        }),
      ]);

      const normCritiqueAxis = (value?: number) => Math.max(0, Math.min(1, (value ?? 0) / 100));
      const critiqueScores = critique.data?.scores;

      // Read existing literary radar to merge / clean stale segment data
      const existingRadar = await readStageRadar(translationStorage, chapterId, sceneId, "literary");
      const existingSegments = existingRadar?.segments ?? [];
      const otherSegments = existingSegments.filter(s => s.segmentId !== segment.segment_id);

      if (critique.error || !critiqueScores) {
        await writeStageRadar(
          translationStorage,
          chapterId,
          sceneId,
          "literary",
          otherSegments,
        );
        invalidateRadarCache(sceneId, segment.segment_id);
        toast.error(isRu
          ? "Арт-правка сохранена, но 5R не рассчитан"
          : "Art edit saved, but 5R was not computed");
        return { text: data.text, notes: data.notes };
      }

      const newSegRadar: StageSegmentRadar = {
        segmentId: segment.segment_id,
        radar: {
          semantic: normCritiqueAxis(critiqueScores.semantic),
          sentiment: normCritiqueAxis(critiqueScores?.sentiment),
          rhythm: prog.rhythm,
          phonetic: prog.phonetic,
          cultural: normCritiqueAxis(critiqueScores?.cultural),
          weighted: 0,
        },
        critiqueNotes: data.notes,
        literary: data.text,
      };

      await writeStageRadar(
        translationStorage,
        chapterId,
        sceneId,
        "literary",
        [...otherSegments, newSegRadar],
      );

      // Invalidate monitor caches so it re-reads from OPFS
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
  }, [translationStorage, model, userApiKeys, sourceLang, targetLang, isRu]);

  return { editSegment, editing };
}
