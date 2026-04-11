import { useState, useEffect, useCallback, useRef } from "react";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { readStructureFromLocal } from "@/lib/localSync";
import { loadStudioChapter, saveStudioChapter, type StudioChapter } from "@/lib/studioChapter";

/**
 * Manages Studio session: loads from sessionStorage first, falls back to OPFS.
 * К3+К4: only pointers travel through sessionStorage — text is always read from OPFS.
 * NO cloud settings — Local-Only contract. Cloud sync only via explicit "Push to Server".
 */
export function useStudioSession() {
  const { storage } = useProjectStorageContext();

  const [chapter, setChapter] = useState<StudioChapter | null>(() => loadStudioChapter());
  const [selectedSceneIdx, setSelectedSceneIdx] = useState<number | null>(() => {
    const saved = sessionStorage.getItem("studio_selected_scene_idx");
    return saved !== null ? Number(saved) : null;
  });
  const [activeTab, setActiveTab] = useState(() =>
    sessionStorage.getItem("studio_active_tab") || "storyboard"
  );

  // If sessionStorage already has a chapter, skip loading (avoids HMR flash)
  const hasSessionChapter = !!loadStudioChapter();
  const [restored, setRestored] = useState(hasSessionChapter);
  const restoredRef = useRef(hasSessionChapter);

  // ── One-time restore on mount ─────────────────────────────
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const sessionChapter = loadStudioChapter();

    // Fast path: sessionStorage has chapter pointer (page refresh in same tab)
    if (sessionChapter) {
      setChapter(sessionChapter);
      const savedIdx = sessionStorage.getItem("studio_selected_scene_idx");
      if (savedIdx !== null) setSelectedSceneIdx(Number(savedIdx));
      const savedTab = sessionStorage.getItem("studio_active_tab");
      if (savedTab) setActiveTab(savedTab);
      setRestored(true);
      return;
    }

    // Slow path: new tab — try to restore from OPFS (last active project)
    (async () => {
      try {
        if (!storage) {
          setRestored(true);
          return;
        }

        const restored = await readStructureFromLocal(storage);
        if (!restored?.structure) {
          setRestored(true);
          return;
        }

        // Pick the first chapter with analysis results as a sensible default
        const firstAnalyzedIdx = [...restored.chapterResults.keys()].sort((a, b) => a - b)[0];
        if (firstAnalyzedIdx === undefined) {
          setRestored(true);
          return;
        }

        const chapterScenes = restored.chapterResults.get(firstAnalyzedIdx);
        const resolvedChapterId = restored.chapterIdMap.get(firstAnalyzedIdx);
        const tocEntry = restored.structure.toc[firstAnalyzedIdx];

        if (!chapterScenes || !resolvedChapterId || !tocEntry) {
          setRestored(true);
          return;
        }

        const restoredChapter: StudioChapter = {
          chapterId: resolvedChapterId,
          chapterTitle: tocEntry.title,
          bookTitle: restored.structure.title || "",
          bookId: restored.structure.bookId || undefined,
          scenes: chapterScenes.scenes.map((scene) => ({
            id: scene.id,
            scene_number: scene.scene_number,
            title: scene.title,
            scene_type: scene.scene_type || "mixed",
            mood: scene.mood || "",
            bpm: scene.bpm || 120,
          })),
        };

        setChapter(restoredChapter);
        saveStudioChapter(restoredChapter);
      } catch (err) {
        console.error("[useStudioSession] Failed to restore from OPFS:", err);
      } finally {
        setRestored(true);
      }
    })();
  }, [storage]);

  // ── Sync chapter pointer to sessionStorage ────────────────
  useEffect(() => {
    if (!chapter) return;
    saveStudioChapter(chapter);
  }, [chapter]);

  // ── Sync scene index to sessionStorage ────────────────────
  useEffect(() => {
    if (selectedSceneIdx !== null) {
      sessionStorage.setItem("studio_selected_scene_idx", String(selectedSceneIdx));
    } else {
      sessionStorage.removeItem("studio_selected_scene_idx");
    }
  }, [selectedSceneIdx]);

  return {
    chapter,
    setChapter,
    selectedSceneIdx,
    setSelectedSceneIdx,
    activeTab,
    setActiveTab,
    restored,
  };
}
