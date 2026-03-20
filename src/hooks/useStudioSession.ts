import { useState, useEffect, useCallback, useRef } from "react";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { readStructureFromLocal } from "@/lib/localSync";
import { loadStudioChapter, saveStudioChapter, type StudioChapter } from "@/lib/studioChapter";

/**
 * Persisted studio session state — saved to user_settings (cloud) for cross-session restore.
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

  if (bookId && restored.structure.bookId !== bookId) {
    return null;
  }

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

  if (!chapterScenes || !resolvedChapterId || !tocEntry) {
    return null;
  }

  return {
    chapterId: resolvedChapterId,
    chapterTitle: tocEntry.title,
    bookTitle: restored.structure.title || bookTitle,
    bookId: restored.structure.bookId || bookId || undefined,
    scenes: chapterScenes.scenes.map((scene) => ({
      id: scene.id,
      scene_number: scene.scene_number,
      title: scene.title,
      scene_type: scene.scene_type || "mixed",
      mood: scene.mood || "",
      bpm: scene.bpm || 120,
      content: scene.content,
      content_preview: scene.content_preview,
    })),
  };
}

/**
 * Manages Studio session: loads from sessionStorage first, falls back to local project + cloud settings.
 * Persists state changes to cloud with debounce.
 * Returns { chapter, restored } — `restored` is true once initial load is complete.
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

  useEffect(() => {
    if (restoredRef.current || !cloudLoaded) return;
    restoredRef.current = true;

    const sessionChapter = loadStudioChapter();
    const sourceChapter = sessionChapter ?? chapter;
    const resolvedBookId = sourceChapter?.bookId ?? cloudState.bookId;
    const resolvedChapterId = sourceChapter?.chapterId ?? cloudState.chapterId;
    const resolvedChapterTitle = sourceChapter?.chapterTitle || cloudState.chapterTitle;
    const resolvedBookTitle = sourceChapter?.bookTitle || cloudState.bookTitle;
    const savedIdx = selectedSceneIdx ?? cloudState.selectedSceneIdx;
    const savedTab = sessionStorage.getItem("studio_active_tab") || cloudState.activeTab;

    if (sessionChapter) {
      setChapter(sessionChapter);

      if (savedIdx !== null && savedIdx >= 0 && savedIdx < sessionChapter.scenes.length) {
        setSelectedSceneIdx(savedIdx);
        sessionStorage.setItem("studio_selected_scene_idx", String(savedIdx));
      }

      if (savedTab) {
        setActiveTab(savedTab);
        sessionStorage.setItem("studio_active_tab", savedTab);
      }

      setRestored(true);
      return;
    }

    if (!resolvedChapterTitle) {
      setRestored(true);
      return;
    }

    (async () => {
      try {
        const restoredChapter = await restoreChapterFromLocal({
          storageAvailable: storage,
          bookId: resolvedBookId,
          chapterId: resolvedChapterId,
          chapterTitle: resolvedChapterTitle,
          bookTitle: resolvedBookTitle,
        });

        if (restoredChapter) {
          setChapter(restoredChapter);
          saveStudioChapter(restoredChapter);

          if (savedIdx !== null && savedIdx >= 0 && savedIdx < restoredChapter.scenes.length) {
            setSelectedSceneIdx(savedIdx);
            sessionStorage.setItem("studio_selected_scene_idx", String(savedIdx));
          }

          if (savedTab) {
            setActiveTab(savedTab);
            sessionStorage.setItem("studio_active_tab", savedTab);
          }
          return;
        }

        if (sourceChapter) {
          setChapter(sourceChapter);
          if (savedIdx !== null && savedIdx >= 0 && savedIdx < sourceChapter.scenes.length) {
            setSelectedSceneIdx(savedIdx);
            sessionStorage.setItem("studio_selected_scene_idx", String(savedIdx));
          }
          if (savedTab) {
            setActiveTab(savedTab);
            sessionStorage.setItem("studio_active_tab", savedTab);
          }
        }
      } catch (err) {
        console.error("[useStudioSession] Failed to restore:", err);
        if (sourceChapter) {
          setChapter(sourceChapter);
        }
      } finally {
        setRestored(true);
      }
    })();
  }, [cloudLoaded, storage]);

  useEffect(() => {
    if (!chapter) return;
    saveStudioChapter(chapter);
  }, [chapter]);

  useEffect(() => {
    if (selectedSceneIdx !== null) {
      sessionStorage.setItem("studio_selected_scene_idx", String(selectedSceneIdx));
    } else {
      sessionStorage.removeItem("studio_selected_scene_idx");
    }
  }, [selectedSceneIdx]);

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
