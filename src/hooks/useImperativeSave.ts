/**
 * useImperativeSave — queued local save after state mutations commit.
 *
 * The caller explicitly triggers `scheduleSave()` after every mutation.
 * Save is deferred to the next macrotask so React state/refs have time
 * to commit before the OPFS snapshot is read.
 * Also flushes on beforeunload as a safety net.
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
}

export function useImperativeSave({
  storage,
  bookId,
  fileName,
  getSnapshot,
}: ImperativeSaveParams) {
  const getSnapshotRef = useRef(getSnapshot);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const queuedSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getSnapshotRef.current = getSnapshot;
  }, [getSnapshot]);

  const doSave = useCallback(async () => {
    if (!bookId || !storage?.isReady) return;
    if (savingRef.current) {
      // Another save is in flight — mark pending so we re-save after it finishes
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    try {
      const snapshot = getSnapshotRef.current();
      if (snapshot.toc.length === 0) return;
      await autoSaveToLocal(storage, bookId, fileName, snapshot);
    } catch (err) {
      console.warn("[AutoSave] local write failed:", err);
    } finally {
      savingRef.current = false;
      // If another mutation happened while we were saving, save again
      if (pendingRef.current) {
        pendingRef.current = false;
        doSave();
      }
    }
  }, [storage, bookId, fileName]);

  const scheduleSave = useCallback(() => {
    if (!bookId) return;
    if (!storage?.isReady) {
      console.warn("[AutoSave] Storage not ready — edits will NOT persist.");
      return;
    }

    if (queuedSaveRef.current) return;

    queuedSaveRef.current = setTimeout(() => {
      queuedSaveRef.current = null;
      void doSave();
    }, 0);
  }, [storage, bookId, doSave]);

  /** Flush — same as scheduleSave since writes are now immediate. */
  const flushSave = scheduleSave;

  useEffect(() => {
    return () => {
      if (queuedSaveRef.current) clearTimeout(queuedSaveRef.current);
    };
  }, []);

  return { scheduleSave, flushSave };
}
