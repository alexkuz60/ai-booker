/**
 * Hook that bridges StoryboardPanel ↔ OPFS storyboard storage.
 *
 * Responsibilities:
 * - Load storyboard data from OPFS when sceneId changes
 * - Persist segments/typeMappings/audioStatus to OPFS after mutations
 * - Provide `pushToDb()` for explicit "before-TTS" sync
 */

import { useCallback, useEffect, useRef } from "react";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { supabase } from "@/integrations/supabase/client";
import {
  saveStoryboardToLocal,
  readStoryboardFromLocal,
  deleteStoryboardFromLocal,
  listStoryboardedScenes,
  type LocalStoryboardData,
  type LocalTypeMappingEntry,
} from "@/lib/storyboardSync";
import type { Segment } from "@/components/studio/storyboard/types";
import type { Json } from "@/integrations/supabase/types";

export interface StoryboardSnapshot {
  segments: Segment[];
  typeMappings: LocalTypeMappingEntry[];
  audioStatus: Map<string, { status: string; durationMs: number }>;
  inlineNarrationSpeaker: string | null;
}

export function useStoryboardPersistence(sceneId: string | null, chapterId?: string | null) {
  const { storage } = useProjectStorageContext();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSnapshotRef = useRef<StoryboardSnapshot | null>(null);

  /**
   * Read storyboard from OPFS. Returns null if not found.
   */
  const loadFromLocal = useCallback(async (sid: string): Promise<LocalStoryboardData | null> => {
    if (!storage) return null;
    return readStoryboardFromLocal(storage, sid, chapterId ?? undefined);
  }, [storage, chapterId]);

  /**
   * Persist current storyboard state to OPFS (debounced 200ms).
   */
  const persist = useCallback((snapshot: StoryboardSnapshot) => {
    if (!storage || !sceneId) return;
    latestSnapshotRef.current = snapshot;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const latest = latestSnapshotRef.current;
      if (!latest) return;
      void saveStoryboardToLocal(storage, sceneId, latest, chapterId ?? undefined);
    }, 200);
  }, [storage, sceneId, chapterId]);

  /**
   * Persist immediately (no debounce) — use after AI analysis or merge/split.
   */
  const persistNow = useCallback(async (snapshot: StoryboardSnapshot) => {
    if (!storage || !sceneId) {
      console.warn(`[StoryboardPersist] persistNow skipped: storage=${!!storage} sceneId=${sceneId}`);
      return;
    }
    latestSnapshotRef.current = snapshot;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    console.debug(`[StoryboardPersist] persistNow → sceneId=${sceneId}, chapterId=${chapterId}, segments=${snapshot.segments.length}`);
    await saveStoryboardToLocal(storage, sceneId, snapshot, chapterId ?? undefined);
  }, [storage, sceneId, chapterId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const latest = latestSnapshotRef.current;
      if (storage && sceneId && latest) {
        void saveStoryboardToLocal(storage, sceneId, latest, chapterId ?? undefined);
      }
    };
  }, [storage, sceneId, chapterId]);

  /**
   * Delete storyboard file — use before re-analysis.
   */
  const clearLocal = useCallback(async () => {
    if (!storage || !sceneId) {
      console.warn(`[StoryboardPersist] clearLocal skipped: storage=${!!storage} sceneId=${sceneId}`);
      return;
    }
    console.debug(`[StoryboardPersist] clearLocal → sceneId=${sceneId}`);
    await deleteStoryboardFromLocal(storage, sceneId, chapterId ?? undefined);
  }, [storage, sceneId, chapterId]);

  /**
   * Push OPFS storyboard data → Supabase DB (delete-then-insert).
   * Call before TTS synthesis or from "Save to Server".
   */
  const pushToDb = useCallback(async (sid: string, snapshot?: StoryboardSnapshot): Promise<void> => {
    const data = snapshot
      ? snapshot
      : storage
        ? await readStoryboardFromLocal(storage, sid, chapterId ?? undefined)
        : null;
    if (!data || data.segments.length === 0) return;

    const segments = data.segments;
    const typeMappings = "typeMappings" in data ? data.typeMappings : (data as LocalStoryboardData).typeMappings;

    // 1. Delete existing segments (cascade deletes phrases)
    const { count: deletedSegCount } = await supabase
      .from("scene_segments")
      .delete({ count: "exact" })
      .eq("scene_id", sid);
    console.log(`[pushToDb] Deleted ${deletedSegCount ?? "?"} segments for scene ${sid}`);

    // 2. Insert segments
    const segInserts = segments.map((s) => ({
      id: s.segment_id,
      scene_id: sid,
      segment_number: s.segment_number,
      segment_type: s.segment_type as any,
      speaker: s.speaker || null,
      metadata: {
        ...(s.inline_narrations ? { inline_narrations: s.inline_narrations } : {}),
        ...(s.split_silence_ms != null ? { split_silence_ms: s.split_silence_ms } : {}),
      } as Json,
    }));

    const { error: segErr } = await supabase.from("scene_segments").insert(segInserts);
    if (segErr) {
      console.error("[pushToDb] segment insert error:", segErr);
      throw segErr;
    }
    console.log(`[pushToDb] Inserted ${segInserts.length} segments for scene ${sid}`);

    // 3. Insert phrases
    const phraseInserts: Array<{
      id: string;
      segment_id: string;
      phrase_number: number;
      text: string;
      metadata: Json;
    }> = [];
    for (const seg of segments) {
      for (const ph of seg.phrases) {
        phraseInserts.push({
          id: ph.phrase_id,
          segment_id: seg.segment_id,
          phrase_number: ph.phrase_number,
          text: ph.text,
          metadata: (ph.annotations ? { annotations: ph.annotations } : {}) as Json,
        });
      }
    }

    if (phraseInserts.length > 0) {
      // Batch in chunks of 500
      for (let i = 0; i < phraseInserts.length; i += 500) {
        const chunk = phraseInserts.slice(i, i + 500);
        const { error: phErr } = await supabase.from("segment_phrases").insert(chunk);
        if (phErr) {
          console.error("[pushToDb] phrase insert error:", phErr);
          throw phErr;
        }
      }
    }

    // 4. Replace type mappings
    await supabase.from("scene_type_mappings").delete().eq("scene_id", sid);
    if (typeMappings && typeMappings.length > 0) {
      const mapInserts = typeMappings.map((m) => ({
        scene_id: sid,
        segment_type: m.segmentType,
        character_id: m.characterId,
      }));
      const { error: mapErr } = await supabase.from("scene_type_mappings").insert(mapInserts);
      if (mapErr) console.warn("[pushToDb] type mappings insert:", mapErr);
    }

    console.debug(`[pushToDb] Synced scene ${sid}: ${segments.length} segments, ${phraseInserts.length} phrases`);
  }, [storage, chapterId]);

  /**
   * Push ALL storyboarded scenes from OPFS → DB.
   * Used by "Save to Server" button.
   */
  const pushAllToDb = useCallback(async (): Promise<number> => {
    if (!storage) return 0;
    const sceneIds = await listStoryboardedScenes(storage);
    let pushed = 0;
    for (const sid of sceneIds) {
      try {
        await pushToDb(sid);
        pushed++;
      } catch (err) {
        console.warn(`[pushAllToDb] Failed for scene ${sid}:`, err);
      }
    }
    return pushed;
  }, [storage, pushToDb]);

  return {
    loadFromLocal,
    persist,
    persistNow,
    clearLocal,
    pushToDb,
    pushAllToDb,
    hasStorage: !!storage,
  };
}
