import { useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { saveStudioChapter } from "@/lib/studioChapter";
import type { Scene, TocChapter, ChapterStatus } from "@/pages/parser/types";

interface UseParserHelpersParams {
  tocEntries: TocChapter[];
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  selectedIdx: number | null;
  fileName: string;
}

export function useParserHelpers({
  tocEntries, chapterResults, selectedIdx, fileName,
}: UseParserHelpersParams) {
  const navigate = useNavigate();

  const selectedEntry = selectedIdx !== null ? tocEntries[selectedIdx] : null;

  // Count direct children of selected entry
  const selectedChildCount = useMemo(() => {
    if (selectedIdx === null) return 0;
    const entry = tocEntries[selectedIdx];
    let count = 0;
    for (let i = selectedIdx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      if (tocEntries[i].level === entry.level + 1) count++;
    }
    return count;
  }, [selectedIdx, tocEntries]);

  // Aggregate scenes from selected entry + all its children
  const selectedResult = useMemo(() => {
    if (selectedIdx === null) return null;
    const entry = tocEntries[selectedIdx];
    const ownResult = chapterResults.get(selectedIdx);

    // Collect child indices
    const childIndices: number[] = [];
    for (let i = selectedIdx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      childIndices.push(i);
    }

    // If no children, return own result directly
    if (childIndices.length === 0) return ownResult ?? null;

    // Aggregate scenes from self + children
    const allScenes: Scene[] = [];
    let worstStatus: ChapterStatus = "done";

    const indices = [selectedIdx, ...childIndices];
    for (const idx of indices) {
      const r = chapterResults.get(idx);
      if (!r) { worstStatus = "pending"; continue; }
      if (r.status === "analyzing") worstStatus = "analyzing";
      else if (r.status === "error" && worstStatus !== "analyzing") worstStatus = "error";
      else if (r.status === "pending" && worstStatus === "done") worstStatus = "pending";
      allScenes.push(...r.scenes);
    }

    // Renumber scenes sequentially across all children
    const numberedScenes = allScenes.map((s, i) => ({ ...s, scene_number: i + 1 }));
    return { scenes: numberedScenes, status: worstStatus };
  }, [selectedIdx, tocEntries, chapterResults]);

  const contentEntries = useMemo(() => tocEntries.filter(e => e.sectionType === "content"), [tocEntries]);
  const supplementaryEntries = useMemo(() => tocEntries.filter(e => e.sectionType !== "content"), [tocEntries]);

  const analyzedCount = useMemo(
    () => Array.from(chapterResults.values()).filter(r => r.status === "done").length,
    [chapterResults],
  );
  const totalScenes = useMemo(
    () => Array.from(chapterResults.values()).reduce((a, r) => a + r.scenes.length, 0),
    [chapterResults],
  );

  const isChapterFullyDone = useCallback((idx: number): boolean => {
    const entry = tocEntries[idx];
    const result = chapterResults.get(idx);
    if (!result || result.status !== "done" || result.scenes.length === 0) return false;
    for (let i = idx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      const childResult = chapterResults.get(i);
      if (!childResult || childResult.status !== "done" || childResult.scenes.length === 0) return false;
    }
    return true;
  }, [tocEntries, chapterResults]);

  const sendToStudio = useCallback((idx: number) => {
    const entry = tocEntries[idx];
    const result = chapterResults.get(idx);
    if (!result) return;

    // Collect scenes for this item + its children
    const allScenes = [...result.scenes];
    for (let i = idx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      const childResult = chapterResults.get(i);
      if (childResult) allScenes.push(...childResult.scenes);
    }

    // Determine if this is a child of a parent chapter → part splitting
    let chapterTitle = entry.title;
    let parentIdx: number | null = null;
    for (let j = idx - 1; j >= 0; j--) {
      if (tocEntries[j].sectionType !== entry.sectionType) continue;
      if (tocEntries[j].level < entry.level) {
        parentIdx = j;
        break;
      }
    }

    if (parentIdx !== null) {
      const parent = tocEntries[parentIdx];
      // Count which part this is among parent's direct children
      let partNumber = 0;
      for (let i = parentIdx + 1; i < tocEntries.length; i++) {
        if (tocEntries[i].level <= parent.level) break;
        if (tocEntries[i].sectionType !== parent.sectionType) break;
        if (tocEntries[i].level === entry.level) {
          partNumber++;
          if (i === idx) break;
        }
      }
      chapterTitle = `${parent.title} (Часть ${partNumber})`;
    }

    saveStudioChapter({ chapterTitle, bookTitle: fileName.replace('.pdf', ''), scenes: allScenes });
    navigate("/studio");
  }, [tocEntries, chapterResults, fileName, navigate]);

  // Part grouping
  const { partGroups, partlessIndices } = useMemo(() => {
    const groups: { title: string; indices: number[] }[] = [];
    const nopart: number[] = [];
    const pMap = new Map<string, number[]>();
    const childOf = new Set<number>();

    tocEntries.forEach((entry, idx) => {
      if (entry.sectionType !== "content") return;
      for (let i = idx + 1; i < tocEntries.length; i++) {
        if (tocEntries[i].level <= entry.level) break;
        if (tocEntries[i].sectionType !== entry.sectionType) break;
        childOf.add(i);
      }
    });

    tocEntries.forEach((entry, idx) => {
      if (entry.sectionType !== "content") return;
      const key = entry.partTitle || "";
      if (key) {
        if (!pMap.has(key)) {
          pMap.set(key, []);
          groups.push({ title: key, indices: pMap.get(key)! });
        }
        if (!childOf.has(idx)) pMap.get(key)!.push(idx);
      } else {
        if (!childOf.has(idx)) nopart.push(idx);
      }
    });

    return { partGroups: groups, partlessIndices: nopart };
  }, [tocEntries]);

  return {
    selectedEntry, selectedResult, selectedChildCount,
    contentEntries, supplementaryEntries,
    analyzedCount, totalScenes,
    isChapterFullyDone, sendToStudio,
    partGroups, partlessIndices,
  };
}
