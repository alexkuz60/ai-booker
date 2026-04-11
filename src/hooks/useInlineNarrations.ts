/**
 * useInlineNarrations — detection and management of inline narrations.
 * Extracted from StoryboardPanel.tsx for modularity.
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { invokeWithFallback } from "@/lib/invokeWithFallback";
import type { Segment, CharacterOption } from "@/components/studio/storyboard/types";
import type { StoryboardSnapshot } from "@/hooks/useStoryboardPersistence";
import type { LocalTypeMappingEntry } from "@/lib/storyboardSync";

interface UseInlineNarrationsParams {
  sceneId: string | null;
  segments: Segment[];
  setSegments: (segs: Segment[]) => void;
  characters: CharacterOption[];
  isRu: boolean;
  persist: (snap: StoryboardSnapshot) => void;
  persistNow: (snap: StoryboardSnapshot) => Promise<void>;
  buildSnapshot: (segs?: Segment[], audio?: Map<string, { status: string; durationMs: number }>, speaker?: string | null) => StoryboardSnapshot;
  getModelForRole: (role: string) => string;
  userApiKeys: Record<string, string>;
  typeMappingsRef: React.MutableRefObject<LocalTypeMappingEntry[]>;
  staleAudioSegIds: Set<string>;
  setStaleAudioSegIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setMergeChecked: (ids: Set<string>) => void;
  onSegmented?: (sceneId: string) => void;
}

export function useInlineNarrations({
  sceneId, segments, setSegments, characters, isRu,
  persist, persistNow, buildSnapshot,
  getModelForRole, userApiKeys,
  typeMappingsRef, staleAudioSegIds, setStaleAudioSegIds, setMergeChecked,
  onSegmented,
}: UseInlineNarrationsParams) {
  const [detecting, setDetecting] = useState(false);
  const [cleaningMetadata, setCleaningMetadata] = useState(false);
  const [inlineNarrationSpeaker, setInlineNarrationSpeakerState] = useState<string | null>(null);

  const dialogueCount = segments.filter(s => s.segment_type === "dialogue").length;

  const runDetectNarrations = useCallback(async () => {
    if (!sceneId || dialogueCount === 0) return;
    setDetecting(true);
    try {
      const dialogueSegments = segments
        .filter(s => s.segment_type === "dialogue" || s.segment_type === "monologue")
        .filter(s => !s.inline_narrations?.length)
        .map(s => ({
          segment_id: s.segment_id,
          speaker: s.speaker,
          text: s.phrases.map(p => p.text).join(" "),
        }));

      if (dialogueSegments.length === 0) {
        toast.info(isRu ? "Все диалоги уже проверены" : "All dialogues already checked");
        setDetecting(false);
        return;
      }

      const { data, error } = await invokeWithFallback({
        functionName: "detect-inline-narrations",
        body: {
          scene_id: sceneId,
          language: isRu ? "ru" : "en",
          model: getModelForRole("screenwriter"),
          segments: dialogueSegments,
        },
        userApiKeys, isRu,
      });
      if (error) throw error;
      const det = data as {
        detected: number;
        segments_updated: number;
        results: Array<{
          segment_id: string;
          inline_narrations: Array<{ text: string; insert_after: string }>;
          clean_text: string;
        }>;
      };
      if (det.detected > 0 && det.results?.length) {
        const resultMap = new Map(det.results.map(r => [r.segment_id, r]));
        const updated = segments.map(seg => {
          const result = resultMap.get(seg.segment_id);
          if (!result) return seg;
          return { ...seg, inline_narrations: result.inline_narrations };
        });
        setSegments(updated);
        persist(buildSnapshot(updated));
        toast.success(
          isRu
            ? `Найдено ${det.detected} вставок в ${det.segments_updated} фрагментах`
            : `Found ${det.detected} insertions in ${det.segments_updated} segments`,
        );
      } else {
        toast.info(isRu ? "Вставок не найдено" : "No insertions found");
      }
    } catch (err: any) {
      console.error("Detection failed:", err);
      toast.error(isRu ? "Ошибка поиска вставок" : "Detection failed");
    }
    setDetecting(false);
    setMergeChecked(new Set());
  }, [sceneId, segments, dialogueCount, isRu, persist, buildSnapshot, getModelForRole, userApiKeys, setMergeChecked, setSegments]);

  const cleanStaleInlineAudio = useCallback(async () => {
    if (!sceneId || staleAudioSegIds.size === 0) return;
    setCleaningMetadata(true);
    try {
      const updated = segments.map(s => {
        if (!staleAudioSegIds.has(s.segment_id)) return s;
        return { ...s, inline_narrations: undefined };
      });
      setSegments(updated);
      setStaleAudioSegIds(new Set());
      await persistNow(buildSnapshot(updated));
      onSegmented?.(sceneId);
      toast.success(
        isRu
          ? `Очищено ${staleAudioSegIds.size} устаревших аудио-вставок`
          : `Cleared ${staleAudioSegIds.size} stale audio metadata entries`,
      );
    } catch (err) {
      console.error("Cleanup failed:", err);
      toast.error(isRu ? "Ошибка очистки" : "Cleanup failed");
    }
    setCleaningMetadata(false);
    setMergeChecked(new Set());
  }, [sceneId, staleAudioSegIds, segments, isRu, onSegmented, persistNow, buildSnapshot, setMergeChecked, setSegments, setStaleAudioSegIds]);

  const removeInlineNarration = useCallback((segmentId: string, narrationIdx: number) => {
    if (!sceneId) return;
    const updated = segments.map(s => {
      if (s.segment_id !== segmentId || !s.inline_narrations) return s;
      const remaining = s.inline_narrations.filter((_, i) => i !== narrationIdx);
      return { ...s, inline_narrations: remaining.length > 0 ? remaining : undefined };
    });
    setSegments(updated);
    persist(buildSnapshot(updated));
    onSegmented?.(sceneId);
    toast.success(isRu ? "Вставка удалена" : "Narration removed");
  }, [sceneId, segments, isRu, persist, buildSnapshot, onSegmented, setSegments]);

  const updateInlineNarrationSpeaker = useCallback((newSpeaker: string | null) => {
    if (!sceneId) return;
    setInlineNarrationSpeakerState(newSpeaker);

    const charRecord = newSpeaker ? characters.find(c => c.name === newSpeaker) : null;
    if (charRecord) {
      typeMappingsRef.current = [
        ...typeMappingsRef.current.filter(m => m.segmentType !== "inline_narration"),
        { segmentType: "inline_narration", characterId: charRecord.id, characterName: charRecord.name },
      ];
      toast.success(isRu ? `Голос вставок → ${newSpeaker}` : `Narration voice → ${newSpeaker}`);
    } else {
      typeMappingsRef.current = typeMappingsRef.current.filter(m => m.segmentType !== "inline_narration");
      toast.success(isRu ? "Голос вставок сброшен" : "Narration voice reset");
    }
    persist(buildSnapshot(undefined, undefined, newSpeaker));
  }, [sceneId, characters, isRu, persist, buildSnapshot, typeMappingsRef]);

  return {
    detecting,
    cleaningMetadata,
    dialogueCount,
    inlineNarrationSpeaker,
    setInlineNarrationSpeaker: setInlineNarrationSpeakerState,
    runDetectNarrations,
    cleanStaleInlineAudio,
    removeInlineNarration,
    updateInlineNarrationSpeaker,
  };
}
