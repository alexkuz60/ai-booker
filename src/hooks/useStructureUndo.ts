import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TocChapter, Scene, ChapterStatus } from "@/pages/parser/types";

export interface StructureSnapshot {
  tocEntries: TocChapter[];
  chapterIdMap: Map<number, string>;
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  selectedIndices: Set<number>;
}

const MAX_DEPTH = 20;

function cloneSnapshot(s: StructureSnapshot): StructureSnapshot {
  return {
    tocEntries: s.tocEntries.map(e => ({ ...e })),
    chapterIdMap: new Map(s.chapterIdMap),
    chapterResults: new Map(
      Array.from(s.chapterResults.entries()).map(([k, v]) => [
        k,
        { scenes: v.scenes.map(sc => ({ ...sc })), status: v.status },
      ])
    ),
    selectedIndices: new Set(s.selectedIndices),
  };
}

/**
 * Reconcile DB state after undo/redo by comparing old and restored snapshots.
 * Re-inserts deleted chapters+scenes, deletes extra ones, updates changed fields.
 */
async function reconcileDb(
  bookId: string,
  oldSnap: StructureSnapshot,
  newSnap: StructureSnapshot
) {
  const oldIds = new Set(oldSnap.chapterIdMap.values());
  const newIds = new Set(newSnap.chapterIdMap.values());

  // Chapters to delete (in old but not in new)
  for (const id of oldIds) {
    if (!newIds.has(id)) {
      await supabase.from("book_scenes").delete().eq("chapter_id", id);
      await supabase.from("book_chapters").delete().eq("id", id);
    }
  }

  // Chapters to re-insert (in new but not in old)
  for (const [idx, id] of newSnap.chapterIdMap.entries()) {
    if (!oldIds.has(id)) {
      const entry = newSnap.tocEntries[idx];
      if (!entry) continue;
      await supabase.from("book_chapters").upsert({
        id,
        book_id: bookId,
        title: entry.title,
        level: entry.level,
        start_page: entry.startPage,
        end_page: entry.endPage,
        chapter_number: idx + 1,
      });
      // Re-insert scenes
      const result = newSnap.chapterResults.get(idx);
      if (result?.scenes?.length) {
        const sceneRows = result.scenes.map((sc) => ({
          ...(sc.id ? { id: sc.id } : {}),
          chapter_id: id,
          scene_number: sc.scene_number,
          title: sc.title,
          content: sc.content || "",
          scene_type: sc.scene_type,
          mood: sc.mood,
          bpm: sc.bpm,
        }));
        await supabase.from("book_scenes").upsert(sceneRows);
      }
    }
  }

  // Update fields for chapters that exist in both
  for (const [idx, id] of newSnap.chapterIdMap.entries()) {
    if (oldIds.has(id)) {
      const entry = newSnap.tocEntries[idx];
      if (!entry) continue;
      await supabase.from("book_chapters").update({
        title: entry.title,
        level: entry.level,
        start_page: entry.startPage,
        end_page: entry.endPage,
        chapter_number: idx + 1,
      }).eq("id", id);
    }
  }
}

export function useStructureUndo(bookId: string | null) {
  const [undoStack, setUndoStack] = useState<StructureSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<StructureSnapshot[]>([]);
  const reconciling = useRef(false);

  // Reset stacks when book changes
  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, [bookId]);

  const pushSnapshot = useCallback((snapshot: StructureSnapshot) => {
    setUndoStack(prev => [...prev.slice(-(MAX_DEPTH - 1)), cloneSnapshot(snapshot)]);
    setRedoStack([]);
  }, []);

  const undo = useCallback(
    (
      current: StructureSnapshot,
      restore: (s: StructureSnapshot) => void
    ) => {
      if (undoStack.length === 0 || reconciling.current) return;
      const prev = undoStack[undoStack.length - 1];
      setUndoStack(s => s.slice(0, -1));
      setRedoStack(s => [...s, cloneSnapshot(current)]);
      restore(cloneSnapshot(prev));

      // Reconcile DB in background
      if (bookId) {
        reconciling.current = true;
        reconcileDb(bookId, current, prev).finally(() => {
          reconciling.current = false;
        });
      }
    },
    [undoStack, bookId]
  );

  const redo = useCallback(
    (
      current: StructureSnapshot,
      restore: (s: StructureSnapshot) => void
    ) => {
      if (redoStack.length === 0 || reconciling.current) return;
      const next = redoStack[redoStack.length - 1];
      setRedoStack(s => s.slice(0, -1));
      setUndoStack(s => [...s, cloneSnapshot(current)]);
      restore(cloneSnapshot(next));

      if (bookId) {
        reconciling.current = true;
        reconcileDb(bookId, current, next).finally(() => {
          reconciling.current = false;
        });
      }
    },
    [redoStack, bookId]
  );

  return {
    pushSnapshot,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    resetStacks: useCallback(() => { setUndoStack([]); setRedoStack([]); }, []),
  };
}
