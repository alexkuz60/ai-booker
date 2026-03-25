/**
 * useTocMutations — all TOC / scene editing operations.
 * Extracted from Parser.tsx. All mutations are LOCAL-ONLY (OPFS via scheduleSave).
 * NO database writes — server sync is manual via "Push to Server" button.
 */

import { useState, useCallback } from "react";
import type { Scene, ChapterStatus, TocChapter } from "@/pages/parser/types";

interface UseTocMutationsParams {
  tocEntries: TocChapter[];
  setTocEntries: React.Dispatch<React.SetStateAction<TocChapter[]>>;
  chapterIdMap: Map<number, string>;
  setChapterIdMap: React.Dispatch<React.SetStateAction<Map<number, string>>>;
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  setChapterResults: React.Dispatch<React.SetStateAction<Map<number, { scenes: Scene[]; status: ChapterStatus }>>>;
  partIdMap: Map<string, string>;
  selectedIdx: number | null;
  setSelectedIndices: React.Dispatch<React.SetStateAction<Set<number>>>;
  scheduleSave: () => void;
}

export function useTocMutations({
  tocEntries, setTocEntries,
  chapterIdMap, setChapterIdMap,
  chapterResults, setChapterResults,
  selectedIdx,
  setSelectedIndices,
  scheduleSave,
}: UseTocMutationsParams) {
  const [pendingDelete, setPendingDelete] = useState<{ indices: number[]; toDelete: Set<number> } | null>(null);

  const changeLevel = useCallback((indices: number[], delta: number) => {
    setTocEntries(prev => {
      const next = prev.map(e => ({ ...e }));
      for (const idx of indices) {
        const entry = next[idx];
        const newLevel = entry.level + delta;
        if (newLevel < 0) continue;

        const affected = [idx];
        for (let i = idx + 1; i < next.length; i++) {
          if (next[i].level <= entry.level) break;
          if (next[i].sectionType !== entry.sectionType) break;
          affected.push(i);
        }

        next[idx].level = newLevel;
        for (const ci of affected.slice(1)) {
          next[ci].level += delta;
          if (next[ci].level < 0) next[ci].level = 0;
        }
      }
      return next;
    });
    scheduleSave();
  }, [setTocEntries, scheduleSave]);

  const renameEntry = useCallback((idx: number, newTitle: string) => {
    setTocEntries(prev => prev.map((e, i) => i === idx ? { ...e, title: newTitle } : e));
    scheduleSave();
  }, [setTocEntries, scheduleSave]);

  const changeStartPage = useCallback((idx: number, newPage: number) => {
    setTocEntries(prev => {
      const next = prev.map((e, i) => i === idx ? { ...e, startPage: newPage } : e);

      // Keep previous chapter boundary contiguous
      if (idx > 0) {
        const prevEnd = Math.max(next[idx - 1].startPage, newPage - 1);
        next[idx - 1] = { ...next[idx - 1], endPage: prevEnd };
      }

      // Guard against invalid range
      if (next[idx].endPage < newPage) {
        next[idx] = { ...next[idx], endPage: newPage };
      }

      return next;
    });
    scheduleSave();
  }, [setTocEntries, scheduleSave]);

  const renamePart = useCallback((oldTitle: string, newTitle: string) => {
    setTocEntries(prev => prev.map(e => e.partTitle === oldTitle ? { ...e, partTitle: newTitle } : e));
    scheduleSave();
  }, [setTocEntries, scheduleSave]);

  const deleteEntry = useCallback((indices: number[]) => {
    const toDelete = new Set<number>();
    for (const idx of indices) {
      toDelete.add(idx);
      const entry = tocEntries[idx];
      for (let i = idx + 1; i < tocEntries.length; i++) {
        if (tocEntries[i].level <= entry.level) break;
        if (tocEntries[i].sectionType !== entry.sectionType) break;
        toDelete.add(i);
      }
    }
    setPendingDelete({ indices, toDelete });
  }, [tocEntries]);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    const { toDelete } = pendingDelete;

    // Remove from state
    const newEntries = tocEntries.filter((_, i) => !toDelete.has(i));
    setTocEntries(newEntries);

    // Rebuild chapterIdMap
    const newMap = new Map<number, string>();
    let newIdx = 0;
    for (let i = 0; i < tocEntries.length; i++) {
      if (toDelete.has(i)) continue;
      const oldId = chapterIdMap.get(i);
      if (oldId) newMap.set(newIdx, oldId);
      newIdx++;
    }
    setChapterIdMap(newMap);

    // Clear selection
    setSelectedIndices(prev => {
      const next = new Set(prev);
      for (const di of toDelete) next.delete(di);
      return next.size > 0 ? next : new Set<number>();
    });

    // Rebuild chapterResults
    const newResults = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
    newIdx = 0;
    for (let i = 0; i < tocEntries.length; i++) {
      if (toDelete.has(i)) continue;
      const oldResult = chapterResults.get(i);
      if (oldResult) newResults.set(newIdx, oldResult);
      newIdx++;
    }
    setChapterResults(newResults);

    setPendingDelete(null);
    scheduleSave();
  }, [pendingDelete, tocEntries, chapterIdMap, chapterResults, setTocEntries, setChapterIdMap, setChapterResults, setSelectedIndices, scheduleSave]);

  const mergeEntries = useCallback((indices: number[]) => {
    if (indices.length < 2) return;
    const sorted = [...indices].sort((a, b) => a - b);
    const firstIdx = sorted[0];
    const lastIdx = sorted[sorted.length - 1];
    const first = tocEntries[firstIdx];
    const last = tocEntries[lastIdx];

    const mergedEntry: TocChapter = {
      ...first,
      endPage: Math.max(first.endPage, last.endPage),
    };

    // Merge scenes from all selected
    const mergedScenes: Scene[] = [];
    for (const idx of sorted) {
      const result = chapterResults.get(idx);
      if (result?.scenes) mergedScenes.push(...result.scenes);
    }
    mergedScenes.forEach((sc, i) => { sc.scene_number = i + 1; });

    const toRemove = new Set(sorted.slice(1));

    const newEntries = tocEntries.map((e, i) => i === firstIdx ? mergedEntry : e).filter((_, i) => !toRemove.has(i));
    setTocEntries(newEntries);

    const newChapterMap = new Map<number, string>();
    const newResults = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
    let newIdx = 0;
    for (let i = 0; i < tocEntries.length; i++) {
      if (toRemove.has(i)) continue;
      const oldId = chapterIdMap.get(i);
      if (oldId) newChapterMap.set(newIdx, oldId);
      if (i === firstIdx) {
        newResults.set(newIdx, { scenes: mergedScenes, status: mergedScenes.length > 0 ? "done" : "pending" });
      } else {
        const oldResult = chapterResults.get(i);
        if (oldResult) newResults.set(newIdx, oldResult);
      }
      newIdx++;
    }
    setChapterIdMap(newChapterMap);
    setChapterResults(newResults);

    setSelectedIndices(new Set([firstIdx]));
    scheduleSave();
  }, [tocEntries, chapterIdMap, chapterResults, setTocEntries, setChapterIdMap, setChapterResults, setSelectedIndices, scheduleSave]);

  /**
   * CONTRACT K3: Scene edits on parent nodes MUST be distributed back to child chapters.
   * CONTRACT K4: selectedResult is an AGGREGATE — never write it wholesale to a single index.
   */
  const handleScenesUpdate = useCallback((updatedScenes: Scene[], _label?: string) => {
    if (selectedIdx === null) return;

    const entry = tocEntries[selectedIdx];

    // Collect child indices
    const childIndices: number[] = [];
    for (let i = selectedIdx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      childIndices.push(i);
    }

    // No children — simple case
    if (childIndices.length === 0) {
      setChapterResults(prev => {
        const next = new Map(prev);
        const existing = next.get(selectedIdx);
        if (existing) {
          next.set(selectedIdx, { ...existing, scenes: updatedScenes });
        }
        return next;
      });
      scheduleSave();
      return;
    }

    // Parent with children: distribute scenes back using scene IDs to match ownership
    const indices = [selectedIdx, ...childIndices];
    setChapterResults(prev => {
      const next = new Map(prev);

      // Build a set of scene IDs belonging to each child chapter
      const chapterSceneIds = new Map<number, Set<string>>();
      for (const idx of indices) {
        const existing = prev.get(idx);
        if (!existing) continue;
        const ids = new Set<string>();
        for (const sc of existing.scenes) {
          if (sc.id) ids.add(sc.id);
        }
        chapterSceneIds.set(idx, ids);
      }

      // Distribute updated scenes by matching IDs to their original chapter
      const distributed = new Map<number, Scene[]>();
      for (const idx of indices) distributed.set(idx, []);

      for (const sc of updatedScenes) {
        let assigned = false;
        if (sc.id) {
          for (const idx of indices) {
            if (chapterSceneIds.get(idx)?.has(sc.id)) {
              distributed.get(idx)!.push(sc);
              assigned = true;
              break;
            }
          }
        }
        // New scenes (from split) or scenes without id — assign to last chapter with scenes
        if (!assigned) {
          // Find which chapter the previous scene belongs to, or append to first chapter
          const lastIdx = indices[indices.length - 1];
          distributed.get(lastIdx)!.push(sc);
        }
      }

      for (const idx of indices) {
        const existing = prev.get(idx);
        if (!existing) continue;
        const scenes = distributed.get(idx) || [];
        const renumbered = scenes.map((sc, i) => ({ ...sc, scene_number: i + 1 }));
        next.set(idx, { ...existing, scenes: renumbered });
      }

      return next;
    });
    scheduleSave();
  }, [selectedIdx, tocEntries, setChapterResults, scheduleSave]);

  return {
    changeLevel,
    renameEntry,
    changeStartPage,
    renamePart,
    deleteEntry,
    confirmDelete,
    mergeEntries,
    handleScenesUpdate,
    pendingDelete,
    setPendingDelete,
  };
}
