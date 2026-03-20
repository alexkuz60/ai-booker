/**
 * Hook that bridges StoryboardPanel ↔ OPFS storyboard storage.
 *
 * Responsibilities:
 * - Load storyboard data from OPFS when sceneId changes
 * - Persist segments/typeMappings/audioStatus to OPFS after mutations
 * - Provide `pushToDb()` for explicit "before-TTS" sync
 */

import { useCallback, useRef } from "react";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import {
  saveStoryboardToLocal,
  readStoryboardFromLocal,
  deleteStoryboardFromLocal,
  type LocalStoryboardData,
  type LocalTypeMappingEntry,
} from "@/lib/storyboardSync";
import type { Segment } from "@/components/studio/storyboard/types";

export interface StoryboardSnapshot {
  segments: Segment[];
  typeMappings: LocalTypeMappingEntry[];
  audioStatus: Map<string, { status: string; durationMs: number }>;
  inlineNarrationSpeaker: string | null;
}

export function useStoryboardPersistence(sceneId: string | null) {
  const { storage } = useProjectStorageContext();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Read storyboard from OPFS. Returns null if not found.
   */
  const loadFromLocal = useCallback(async (sid: string): Promise<LocalStoryboardData | null> => {
    if (!storage) return null;
    return readStoryboardFromLocal(storage, sid);
  }, [storage]);

  /**
   * Persist current storyboard state to OPFS (debounced 200ms).
   */
  const persist = useCallback((snapshot: StoryboardSnapshot) => {
    if (!storage || !sceneId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveStoryboardToLocal(storage, sceneId, snapshot);
    }, 200);
  }, [storage, sceneId]);

  /**
   * Persist immediately (no debounce) — use after AI analysis or merge/split.
   */
  const persistNow = useCallback(async (snapshot: StoryboardSnapshot) => {
    if (!storage || !sceneId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await saveStoryboardToLocal(storage, sceneId, snapshot);
  }, [storage, sceneId]);

  /**
   * Delete storyboard file — use before re-analysis.
   */
  const clearLocal = useCallback(async () => {
    if (!storage || !sceneId) return;
    await deleteStoryboardFromLocal(storage, sceneId);
  }, [storage, sceneId]);

  return {
    loadFromLocal,
    persist,
    persistNow,
    clearLocal,
    hasStorage: !!storage,
  };
}
