/**
 * useImperativeSave — debounced imperative local save.
 *
 * Instead of comparing fingerprints reactively, the caller explicitly
 * triggers `scheduleSave()` after every mutation.  Multiple rapid calls
 * within the debounce window (default 400 ms) are coalesced into one write.
 *
 * Usage:
 *   const { scheduleSave } = useImperativeSave({ storage, bookId, ... });
 *   // after any mutation:
 *   scheduleSave();
 */

import { useCallback, useEffect, useRef } from "react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { TocChapter, Scene, ChapterStatus } from "@/pages/parser/types";
import { autoSaveToLocal } from "@/hooks/useSaveBookToProject";

export interface ImperativeSaveParams {
  storage: ProjectStorage | null;
  bookId: string | null;
  fileName: string;
  /** Live refs to current state — read at save time, not at schedule time */
  getSnapshot: () => {
    toc: TocChapter[];
    parts: Array<{ id: string; title: string; partNumber: number }>;
    chapterIdMap: Map<number, string>;
    chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  };
  debounceMs?: number;
}

export function useImperativeSave({
  storage,
  bookId,
  fileName,
  getSnapshot,
  debounceMs = 400,
}: ImperativeSaveParams) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback(() => {
    if (!storage?.isReady || !bookId) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const snapshot = getSnapshot();
      if (snapshot.toc.length === 0) return;
      autoSaveToLocal(storage, bookId, fileName, snapshot).catch((err) =>
        console.warn("[AutoSave] local write failed:", err),
      );
    }, debounceMs);
  }, [storage, bookId, fileName, getSnapshot, debounceMs]);

  /** Flush pending save immediately (e.g. before page unload). */
  const flushSave = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!storage?.isReady || !bookId) return;
    const snapshot = getSnapshot();
    if (snapshot.toc.length === 0) return;
    autoSaveToLocal(storage, bookId, fileName, snapshot).catch((err) =>
      console.warn("[AutoSave] flush failed:", err),
    );
  }, [storage, bookId, fileName, getSnapshot]);

  return { scheduleSave, flushSave };
}
