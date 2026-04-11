/**
 * useStoryboardSegmentOps — segment merge/delete/split/type/speaker operations.
 * Extracted from StoryboardPanel.tsx for modularity.
 */

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Segment, CharacterOption } from "@/components/studio/storyboard/types";
import type { StoryboardSnapshot } from "@/hooks/useStoryboardPersistence";
import type { LocalTypeMappingEntry } from "@/lib/storyboardSync";
import { SEGMENT_CONFIG } from "@/components/studio/storyboard/constants";
import type { ProjectStorage } from "@/lib/projectStorage";

interface UseStoryboardSegmentOpsParams {
  sceneId: string | null;
  segments: Segment[];
  setSegments: (segs: Segment[]) => void;
  characters: CharacterOption[];
  isRu: boolean;
  storage: ProjectStorage | null;
  mergeChecked: Set<string>;
  setMergeChecked: (ids: Set<string>) => void;
  audioStatus: Map<string, { status: string; durationMs: number }>;
  setAudioStatus: (m: Map<string, { status: string; durationMs: number }>) => void;
  audioStatusRef: React.MutableRefObject<Map<string, { status: string; durationMs: number }>>;
  contentDirty: boolean;
  setContentDirty: (d: boolean) => void;
  typeMappingsRef: React.MutableRefObject<LocalTypeMappingEntry[]>;
  persistNow: (snap: StoryboardSnapshot) => Promise<void>;
  persist: (snap: StoryboardSnapshot) => void;
  buildSnapshot: (segs?: Segment[], audio?: Map<string, { status: string; durationMs: number }>, speaker?: string | null) => StoryboardSnapshot;
  syncTypeMappings: (segs: Segment[]) => void;
  setStaleAudioSegIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  onSegmented?: (sceneId: string) => void;
}

export function useStoryboardSegmentOps({
  sceneId, segments, setSegments, characters, isRu, storage,
  mergeChecked, setMergeChecked,
  audioStatus, setAudioStatus, audioStatusRef,
  contentDirty, setContentDirty,
  typeMappingsRef, persistNow, persist, buildSnapshot, syncTypeMappings,
  setStaleAudioSegIds, onSegmented,
}: UseStoryboardSegmentOpsParams) {
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Find consecutive groups of checked segments (≥2 adjacent)
  const mergeGroups = useMemo(() => {
    if (mergeChecked.size < 2) return [];
    const checkedNums = new Set(
      segments.filter(s => mergeChecked.has(s.segment_id)).map(s => s.segment_number),
    );
    const groups: Segment[][] = [];
    let current: Segment[] = [];
    for (const seg of segments) {
      if (checkedNums.has(seg.segment_number)) {
        current.push(seg);
      } else {
        if (current.length >= 2) groups.push(current);
        current = [];
      }
    }
    if (current.length >= 2) groups.push(current);
    return groups;
  }, [mergeChecked, segments]);

  const canMerge = mergeGroups.length > 0;

  const clearDirtyFlag = useCallback(async () => {
    if (contentDirty && storage && sceneId) {
      setContentDirty(false);
      import("@/lib/sceneIndex").then(m => m.unmarkSceneDirty(storage, sceneId));
      supabase.from("book_scenes").update({ content_dirty: false }).eq("id", sceneId);
    }
  }, [contentDirty, storage, sceneId, setContentDirty]);

  const handleMergeSegments = useCallback(async () => {
    if (!sceneId || mergeGroups.length === 0) return;
    setMerging(true);
    try {
      let updated = [...segments];
      const allMergedIds = new Set<string>();
      const keeperIds = new Set<string>();

      for (const group of mergeGroups) {
        const [keeper, ...toMerge] = group;
        const mergeIds = new Set(toMerge.map(s => s.segment_id));
        for (const id of mergeIds) allMergedIds.add(id);
        keeperIds.add(keeper.segment_id);

        let allPhrases = [...keeper.phrases];
        for (const seg of toMerge) {
          for (let pi = 0; pi < seg.phrases.length; pi++) {
            const ph = seg.phrases[pi];
            const startsNewSentence = /^[A-ZА-ЯЁ«"—–\-\[]/.test(ph.text.trimStart());
            if (pi === 0 && !startsNewSentence && allPhrases.length > 0) {
              const prev = allPhrases[allPhrases.length - 1];
              const separator = prev.text.endsWith(" ") ? "" : " ";
              allPhrases[allPhrases.length - 1] = { ...prev, text: prev.text + separator + ph.text };
            } else {
              allPhrases.push(ph);
            }
          }
        }
        allPhrases = allPhrases.map((ph, i) => ({ ...ph, phrase_number: i + 1 }));

        updated = updated
          .map(s => s.segment_id === keeper.segment_id ? { ...s, phrases: allPhrases } : s)
          .filter(s => !mergeIds.has(s.segment_id));
      }

      updated = updated.map((s, i) => ({ ...s, segment_number: i + 1 }));

      const newAudioStatus = new Map(audioStatusRef.current);
      for (const id of allMergedIds) newAudioStatus.delete(id);
      for (const id of keeperIds) newAudioStatus.delete(id);
      setAudioStatus(newAudioStatus);

      setStaleAudioSegIds(prev => {
        const next = new Set(prev);
        for (const id of keeperIds) next.add(id);
        return next;
      });

      setSegments(updated);
      setMergeChecked(new Set());
      await persistNow(buildSnapshot(updated, newAudioStatus));
      await clearDirtyFlag();
      toast.success(isRu ? "Блоки объединены" : "Segments merged");
      onSegmented?.(sceneId);
    } catch (err: any) {
      console.error("Merge failed:", err);
      toast.error(isRu ? "Ошибка объединения" : "Merge failed");
    }
    setMerging(false);
  }, [sceneId, mergeGroups, segments, isRu, persistNow, buildSnapshot, onSegmented, clearDirtyFlag, audioStatusRef, setAudioStatus, setStaleAudioSegIds, setSegments, setMergeChecked]);

  const handleDeleteSegments = useCallback(async () => {
    if (!sceneId || mergeChecked.size === 0) return;
    const toDelete = segments.filter(s => mergeChecked.has(s.segment_id));
    if (toDelete.length === 0) return;
    if (toDelete.length === segments.length) {
      toast.error(isRu ? "Нельзя удалить все блоки сцены" : "Cannot delete all segments");
      return;
    }
    setDeleting(true);
    try {
      const deleteIds = new Set(toDelete.map(s => s.segment_id));
      const updated = segments
        .filter(s => !deleteIds.has(s.segment_id))
        .map((s, i) => ({ ...s, segment_number: i + 1 }));

      setSegments(updated);
      setMergeChecked(new Set());
      await persistNow(buildSnapshot(updated));
      await clearDirtyFlag();
      toast.success(isRu ? `Удалено ${toDelete.length} блок(ов)` : `Deleted ${toDelete.length} segment(s)`);
      onSegmented?.(sceneId);
    } catch (err: any) {
      console.error("Delete segments failed:", err);
      toast.error(isRu ? "Ошибка удаления" : "Delete failed");
    }
    setDeleting(false);
  }, [sceneId, mergeChecked, segments, isRu, persistNow, buildSnapshot, onSegmented, clearDirtyFlag, setSegments, setMergeChecked]);

  const handleSplitAtPhrase = useCallback(async (phraseId: string, textBefore: string, textAfter: string) => {
    if (!sceneId) return;
    const segIdx = segments.findIndex(s => s.phrases.some(p => p.phrase_id === phraseId));
    if (segIdx < 0) return;
    const seg = segments[segIdx];
    const phraseIdx = seg.phrases.findIndex(p => p.phrase_id === phraseId);
    if (phraseIdx < 0) return;

    try {
      const keeperPhrases = seg.phrases.slice(0, phraseIdx + 1).map((ph, i) => ({
        ...ph, text: i === phraseIdx ? textBefore : ph.text, phrase_number: i + 1,
      }));

      const newSegId = crypto.randomUUID();
      const newPhrases = [
        { phrase_id: crypto.randomUUID(), phrase_number: 1, text: textAfter },
        ...seg.phrases.slice(phraseIdx + 1).map((ph, i) => ({ ...ph, phrase_number: i + 2 })),
      ];

      const newSeg: Segment = {
        segment_id: newSegId,
        segment_number: seg.segment_number + 1,
        segment_type: seg.segment_type,
        speaker: seg.speaker,
        phrases: newPhrases,
        split_silence_ms: 1000,
      };

      const updated = [
        ...segments.slice(0, segIdx),
        { ...seg, phrases: keeperPhrases },
        newSeg,
        ...segments.slice(segIdx + 1),
      ].map((s, i) => ({ ...s, segment_number: i + 1 }));

      setSegments(updated);
      await persistNow(buildSnapshot(updated));
      await clearDirtyFlag();
      toast.success(isRu ? "Блок разделён" : "Segment split");
      onSegmented?.(sceneId);
    } catch (err: any) {
      console.error("Split failed:", err);
      toast.error(isRu ? "Ошибка разделения" : "Split failed");
    }
  }, [sceneId, segments, isRu, persistNow, buildSnapshot, onSegmented, clearDirtyFlag, setSegments]);

  const handleSplitSilenceChange = useCallback((segmentId: string, ms: number) => {
    const updated = segments.map(s =>
      s.segment_id === segmentId ? { ...s, split_silence_ms: ms } : s,
    );
    setSegments(updated);
    persist(buildSnapshot(updated));
    onSegmented?.(sceneId!);
  }, [sceneId, segments, persist, buildSnapshot, onSegmented, setSegments]);

  const updateSegmentType = useCallback(async (segmentId: string, newType: string) => {
    const targetSeg = segments.find(s => s.segment_id === segmentId);
    if (!targetSeg) return;

    const bulkChecked = mergeChecked.size > 1 && mergeChecked.has(segmentId);
    const affectedIds: string[] = bulkChecked
      ? segments.filter(s => mergeChecked.has(s.segment_id)).map(s => s.segment_id)
      : [segmentId];

    const SYSTEM_TYPE_SPEAKER: Record<string, string> = {
      narrator: "Рассказчик", epigraph: "Рассказчик", lyric: "Рассказчик", footnote: "Комментатор",
    };
    const systemSpeaker = SYSTEM_TYPE_SPEAKER[newType] ?? null;
    const SYSTEM_SPEAKERS = new Set(Object.values(SYSTEM_TYPE_SPEAKER));

    const updatedSegments = segments.map(seg => {
      if (!affectedIds.includes(seg.segment_id)) return seg;
      const updated: typeof seg = { ...seg, segment_type: newType };
      if (systemSpeaker) {
        updated.speaker = systemSpeaker;
      } else if (SYSTEM_SPEAKERS.has(seg.speaker ?? "")) {
        updated.speaker = null;
      }
      return updated;
    });
    setSegments(updatedSegments);

    if (affectedIds.length > 1) {
      const newLabel = isRu ? SEGMENT_CONFIG[newType]?.label_ru : SEGMENT_CONFIG[newType]?.label_en;
      toast.success(
        isRu
          ? `Тип изменён: ${newLabel} (${affectedIds.length} фрагм.)`
          : `Type changed: ${newLabel} (${affectedIds.length} seg.)`,
      );
    }

    syncTypeMappings(updatedSegments);
    persist(buildSnapshot(updatedSegments));
    onSegmented?.(sceneId!);
    if (bulkChecked) setMergeChecked(new Set());
  }, [isRu, segments, sceneId, mergeChecked, syncTypeMappings, persist, buildSnapshot, onSegmented, setMergeChecked, setSegments]);

  const updateSpeaker = useCallback(async (segmentId: string, newSpeaker: string | null) => {
    const targetSeg = segments.find(s => s.segment_id === segmentId);
    if (!targetSeg) return;

    const bulkChecked = mergeChecked.size > 1 && mergeChecked.has(segmentId);
    const affectedIds: string[] = bulkChecked
      ? segments.filter(s => mergeChecked.has(s.segment_id)).map(s => s.segment_id)
      : [segmentId];

    const updatedSegments = segments.map(seg =>
      affectedIds.includes(seg.segment_id) ? { ...seg, speaker: newSpeaker } : seg,
    );
    setSegments(updatedSegments);
    syncTypeMappings(updatedSegments);
    persist(buildSnapshot(updatedSegments));

    if (affectedIds.length > 1) {
      const typeLabel = isRu
        ? SEGMENT_CONFIG[targetSeg.segment_type]?.label_ru
        : SEGMENT_CONFIG[targetSeg.segment_type]?.label_en;
      toast.success(
        isRu
          ? `«${typeLabel}» → ${newSpeaker || "?"} (${affectedIds.length} фрагм.)`
          : `"${typeLabel}" → ${newSpeaker || "?"} (${affectedIds.length} seg.)`,
      );
    }

    // Sync characters: upsert new speaker into index + scene map
    if (storage && sceneId) {
      try {
        const { readCharacterIndex, upsertSpeakersFromSegments } = await import("@/lib/localCharacters");
        const currentIndex = await readCharacterIndex(storage);
        const updatedIndex = await upsertSpeakersFromSegments(
          storage, sceneId, updatedSegments, currentIndex,
          typeMappingsRef.current.map(m => ({ segmentType: m.segmentType, characterId: m.characterId })),
        );
        // Return updated characters so parent can setState
        return updatedIndex.map(c => ({
          id: c.id,
          name: c.name,
          color: c.color ?? undefined,
          voiceConfig: (c.voice_config || {}) as Record<string, unknown>,
        }));
      } catch (err) {
        console.warn("[SegmentOps] Character sync after speaker update failed:", err);
      }
    }

    onSegmented?.(sceneId!);
    if (bulkChecked) setMergeChecked(new Set());
    return undefined;
  }, [isRu, segments, sceneId, storage, syncTypeMappings, persist, buildSnapshot, onSegmented, mergeChecked, setMergeChecked, typeMappingsRef, setSegments]);

  return {
    merging,
    deleting,
    mergeGroups,
    canMerge,
    handleMergeSegments,
    handleDeleteSegments,
    handleSplitAtPhrase,
    handleSplitSilenceChange,
    updateSegmentType,
    updateSpeaker,
  };
}
