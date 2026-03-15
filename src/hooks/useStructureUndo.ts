import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TocChapter, Scene, ChapterStatus } from "@/pages/parser/types";

export interface StructureSnapshot {
  tocEntries: TocChapter[];
  chapterIdMap: Map<number, string>;
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  selectedIndices: Set<number>;
}

export interface LabeledSnapshot {
  label: string;
  snapshot: StructureSnapshot;
  timestamp: number;
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
 * Reconcile DB state after undo/redo.
 */
async function reconcileDb(
  bookId: string,
  oldSnap: StructureSnapshot,
  newSnap: StructureSnapshot
) {
  const oldIds = new Set(oldSnap.chapterIdMap.values());
  const newIds = new Set(newSnap.chapterIdMap.values());

  for (const id of oldIds) {
    if (!newIds.has(id)) {
      await supabase.from("book_scenes").delete().eq("chapter_id", id);
      await supabase.from("book_chapters").delete().eq("id", id);
    }
  }

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
  const [undoStack, setUndoStack] = useState<LabeledSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<LabeledSnapshot[]>([]);
  const reconciling = useRef(false);

  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, [bookId]);

  const pushSnapshot = useCallback((snapshot: StructureSnapshot, label: string = "Изменение") => {
    setUndoStack(prev => [
      ...prev.slice(-(MAX_DEPTH - 1)),
      { label, snapshot: cloneSnapshot(snapshot), timestamp: Date.now() },
    ]);
    setRedoStack([]);
  }, []);

  /** Undo a single step */
  const undo = useCallback(
    (
      current: StructureSnapshot,
      restore: (s: StructureSnapshot) => void
    ) => {
      if (undoStack.length === 0 || reconciling.current) return;
      const entry = undoStack[undoStack.length - 1];
      setUndoStack(s => s.slice(0, -1));
      setRedoStack(s => [...s, { label: entry.label, snapshot: cloneSnapshot(current), timestamp: Date.now() }]);
      restore(cloneSnapshot(entry.snapshot));

      if (bookId) {
        reconciling.current = true;
        reconcileDb(bookId, current, entry.snapshot).finally(() => {
          reconciling.current = false;
        });
      }
    },
    [undoStack, bookId]
  );

  /** Redo a single step */
  const redo = useCallback(
    (
      current: StructureSnapshot,
      restore: (s: StructureSnapshot) => void
    ) => {
      if (redoStack.length === 0 || reconciling.current) return;
      const entry = redoStack[redoStack.length - 1];
      setRedoStack(s => s.slice(0, -1));
      setUndoStack(s => [...s, { label: entry.label, snapshot: cloneSnapshot(current), timestamp: Date.now() }]);
      restore(cloneSnapshot(entry.snapshot));

      if (bookId) {
        reconciling.current = true;
        reconcileDb(bookId, current, entry.snapshot).finally(() => {
          reconciling.current = false;
        });
      }
    },
    [redoStack, bookId]
  );

  /** Batch undo: jump back to undoStack[targetIndex] */
  const undoTo = useCallback(
    (
      targetIndex: number,
      current: StructureSnapshot,
      restore: (s: StructureSnapshot) => void
    ) => {
      if (targetIndex < 0 || targetIndex >= undoStack.length || reconciling.current) return;
      // Items from targetIndex+1..end go to redo (in reverse order)
      const movingToRedo = undoStack.slice(targetIndex + 1).reverse();
      const target = undoStack[targetIndex];
      const remaining = undoStack.slice(0, targetIndex);

      // Current state becomes top of redo
      const currentEntry: LabeledSnapshot = {
        label: movingToRedo.length > 0 ? movingToRedo[movingToRedo.length - 1].label : target.label,
        snapshot: cloneSnapshot(current),
        timestamp: Date.now(),
      };

      setUndoStack(remaining);
      setRedoStack(s => [...s, ...movingToRedo.map(e => ({ ...e, snapshot: cloneSnapshot(e.snapshot) })), currentEntry]);
      restore(cloneSnapshot(target.snapshot));

      if (bookId) {
        reconciling.current = true;
        reconcileDb(bookId, current, target.snapshot).finally(() => {
          reconciling.current = false;
        });
      }
    },
    [undoStack, bookId]
  );

  /** Batch redo: jump forward to redoStack[targetIndex] */
  const redoTo = useCallback(
    (
      targetIndex: number,
      current: StructureSnapshot,
      restore: (s: StructureSnapshot) => void
    ) => {
      if (targetIndex < 0 || targetIndex >= redoStack.length || reconciling.current) return;
      // Items from targetIndex+1..end go to undo (in reverse order)
      const movingToUndo = redoStack.slice(targetIndex + 1).reverse();
      const target = redoStack[targetIndex];
      const remaining = redoStack.slice(0, targetIndex);

      const currentEntry: LabeledSnapshot = {
        label: movingToUndo.length > 0 ? movingToUndo[movingToUndo.length - 1].label : target.label,
        snapshot: cloneSnapshot(current),
        timestamp: Date.now(),
      };

      setRedoStack(remaining);
      setUndoStack(s => [...s, currentEntry, ...movingToUndo.map(e => ({ ...e, snapshot: cloneSnapshot(e.snapshot) }))]);
      restore(cloneSnapshot(target.snapshot));

      if (bookId) {
        reconciling.current = true;
        reconcileDb(bookId, current, target.snapshot).finally(() => {
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
    undoTo,
    redoTo,
    undoStack,
    redoStack,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    resetStacks: useCallback(() => { setUndoStack([]); setRedoStack([]); }, []),
  };
}
