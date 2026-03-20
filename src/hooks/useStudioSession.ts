import { useState, useEffect, useCallback, useRef } from "react";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { readStructureFromLocal } from "@/lib/localSync";
import { loadStudioChapter, saveStudioChapter, type StudioChapter } from "@/lib/studioChapter";

/**
 * Persisted studio session state — saved to user_settings (cloud) for cross-session restore.
 * К4: only pointers (IDs, titles, indices, tab name) — NEVER text content.
 */
interface StudioSessionState {
  bookId: string | null;
  chapterId: string | null;
  bookTitle: string;
  chapterTitle: string;
  selectedSceneIdx: number | null;
  activeTab: string;
}

const EMPTY_STATE: StudioSessionState = {
  bookId: null,
  chapterId: null,
  bookTitle: "",
  chapterTitle: "",
  selectedSceneIdx: null,
  activeTab: "storyboard",
};

/**
 * Restore chapter pointer from OPFS project storage.
 * К3: NEVER fetches text content — only structural metadata + IDs.
 */
async function restoreChapterFromLocal(params: {
  storageAvailable: ReturnType<typeof useProjectStorageContext>["storage"];
  bookId: string | null;
  chapterId: string | null;
  chapterTitle: string;
  bookTitle: string;
}): Promise<StudioChapter | null> {
  const { storageAvailable, bookId, chapterId, chapterTitle, bookTitle } = params;
  if (!storageAvailable) return null;

  const restored = await readStructureFromLocal(storageAvailable);
  if (!restored?.structure) return null;

  if (bookId && restored.structure.bookId !== bookId) return null;

  const chapterIndexById = chapterId
    ? [...restored.chapterIdMap.entries()].find(([, id]) => id === chapterId)?.[0] ?? null
    : null;

  const chapterIndexByTitle = chapterTitle
    ? restored.structure.toc.findIndex((entry, idx) => entry.title === chapterTitle && restored.chapterResults.has(idx))
    : -1;

  const chapterIndex = chapterIndexById ?? (chapterIndexByTitle >= 0 ? chapterIndexByTitle : null);
  if (chapterIndex === null) return null;

  const chapterScenes = restored.chapterResults.get(chapterIndex);
  const resolvedChapterId = restored.chapterIdMap.get(chapterIndex) ?? chapterId ?? undefined;
  const tocEntry = restored.structure.toc[chapterIndex];

  if (!chapterScenes || !resolvedChapterId || !tocEntry) return null;

  return {
    chapterId: resolvedChapterId,
    chapterTitle: tocEntry.title,
    bookTitle: restored.structure.title || bookTitle,
    bookId: restored.structure.bookId || bookId || undefined,
    // К4: scenes carry only structural metadata — content is read from OPFS on demand.
    scenes: chapterScenes.scenes.map((scene) => ({
      id: scene.id,
      scene_number: scene.scene_number,
      title: scene.title,
      scene_type: scene.scene_type || "mixed",
      mood: scene.mood || "",
      bpm: scene.bpm || 120,
    })),
  };
}

/** Apply scene index + tab from saved state to session, guarded by scene count. */
function applySavedUiState(
  chapter: StudioChapter,
  savedIdx: number | null,
  savedTab: string | null,
  setSelectedSceneIdx: (v: number | null) => void,
  setActiveTab: (v: string) => void,
) {
  if (savedIdx !== null && savedIdx >= 0 && savedIdx < chapter.scenes.length) {
    setSelectedSceneIdx(savedIdx);
    sessionStorage.setItem("studio_selected_scene_idx", String(savedIdx));
  }
  if (savedTab) {
    setActiveTab(savedTab);
    sessionStorage.setItem("studio_active_tab", savedTab);
  }
}

/**
 * Manages Studio session: loads from sessionStorage first, falls back to OPFS + cloud settings.
 * К3+К4: only pointers travel through sessionStorage/cloud — text is always read from OPFS.
 */
export function useStudioSession() {
  const { value: cloudState, update: saveCloudState, loaded: cloudLoaded } =
    useCloudSettings<StudioSessionState>("studio_session", EMPTY_STATE);
  const { storage } = useProjectStorageContext();

  const [chapter, setChapter] = useState<StudioChapter | null>(() => loadStudioChapter());
  const [selectedSceneIdx, setSelectedSceneIdx] = useState<number | null>(() => {
    const saved = sessionStorage.getItem("studio_selected_scene_idx");
    return saved !== null ? Number(saved) : null;
  });
  const [activeTab, setActiveTab] = useState(() =>
    sessionStorage.getItem("studio_active_tab") || "storyboard"
  );
  const [restored, setRestored] = useState(false);
  const restoredRef = useRef(false);

  // ── One-time restore on mount ─────────────────────────────
  useEffect(() => {
    if (restoredRef.current || !cloudLoaded) return;
    restoredRef.current = true;

    const sessionChapter = loadStudioChapter();
    const savedIdx = selectedSceneIdx ?? cloudState.selectedSceneIdx;
    const savedTab = sessionStorage.getItem("studio_active_tab") || cloudState.activeTab;

    // Fast path: session already has chapter pointer
    if (sessionChapter) {
      setChapter(sessionChapter);
      applySavedUiState(sessionChapter, savedIdx, savedTab, setSelectedSceneIdx, setActiveTab);
      setRestored(true);
      return;
    }

    // Resolve chapter pointer from cloud state
    const resolvedChapterTitle = cloudState.chapterTitle;
    if (!resolvedChapterTitle) {
      setRestored(true);
      return;
    }

    // Slow path: restore from OPFS
    (async () => {
      try {
        const restoredChapter = await restoreChapterFromLocal({
          storageAvailable: storage,
          bookId: cloudState.bookId,
          chapterId: cloudState.chapterId,
          chapterTitle: resolvedChapterTitle,
          bookTitle: cloudState.bookTitle,
        });

        if (restoredChapter) {
          setChapter(restoredChapter);
          saveStudioChapter(restoredChapter);
          applySavedUiState(restoredChapter, savedIdx, savedTab, setSelectedSceneIdx, setActiveTab);
        }
      } catch (err) {
        console.error("[useStudioSession] Failed to restore:", err);
      } finally {
        setRestored(true);
      }
    })();
  }, [cloudLoaded, storage]);

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

  // ── Debounced cloud persistence ───────────────────────────
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistToCloud = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const currentChapter = loadStudioChapter();
      if (!currentChapter) return;

      saveCloudState({
        bookId: currentChapter.bookId || null,
        chapterId: currentChapter.chapterId || null,
        bookTitle: currentChapter.bookTitle,
        chapterTitle: currentChapter.chapterTitle,
        selectedSceneIdx,
        activeTab,
      });
    }, 500);
  }, [selectedSceneIdx, activeTab, saveCloudState]);

  useEffect(() => {
    if (!restored) return;
    persistToCloud();
  }, [chapter?.chapterTitle, selectedSceneIdx, activeTab, restored]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

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
