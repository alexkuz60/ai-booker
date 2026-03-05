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
  const selectedResult = selectedIdx !== null ? chapterResults.get(selectedIdx) : null;

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
    const allScenes = [...result.scenes];
    for (let i = idx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      const childResult = chapterResults.get(i);
      if (childResult) allScenes.push(...childResult.scenes);
    }
    saveStudioChapter({ chapterTitle: entry.title, bookTitle: fileName.replace('.pdf', ''), scenes: allScenes });
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
    selectedEntry, selectedResult,
    contentEntries, supplementaryEntries,
    analyzedCount, totalScenes,
    isChapterFullyDone, sendToStudio,
    partGroups, partlessIndices,
  };
}
