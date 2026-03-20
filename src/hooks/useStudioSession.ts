import { useState, useEffect, useCallback, useRef } from "react";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import { supabase } from "@/integrations/supabase/client";
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

async function restoreChapterFromDb(params: {
  bookId: string | null;
  chapterId: string | null;
  chapterTitle: string;
  bookTitle: string;
}): Promise<StudioChapter | null> {
  const { bookId, chapterId, chapterTitle, bookTitle } = params;

  let chapterIds: string[] = [];
  let chapterRow: { id: string; title: string; book_id: string } | null = null;

  if (chapterId) {
    let idQuery = supabase
      .from("book_chapters")
      .select("id, title, book_id")
      .eq("id", chapterId);

    if (bookId) {
      idQuery = idQuery.eq("book_id", bookId);
    }

    const { data: chapterById, error: chapterByIdError } = await idQuery.maybeSingle();
    if (chapterByIdError) return null;
    if (chapterById) {
      chapterRow = chapterById;
      chapterIds = [chapterById.id];
    }
  }

  if (!chapterRow) {
    let fallbackQuery = supabase
      .from("book_chapters")
      .select("id, title, book_id")
      .eq("title", chapterTitle)
      .order("chapter_number", { ascending: true })
      .limit(1);

    if (bookId) {
      fallbackQuery = fallbackQuery.eq("book_id", bookId);
    }

    const { data: fallbackChapter, error: fallbackError } = await fallbackQuery.maybeSingle();
    if (fallbackError || !fallbackChapter) return null;
    chapterRow = fallbackChapter;
    chapterIds = [fallbackChapter.id];
  }

  const resolvedBookId = chapterRow.book_id;

  const { data: dbScenes, error: sceneError } = await supabase
    .from("book_scenes")
    .select("id, scene_number, title, scene_type, mood, bpm, content")
    .in("chapter_id", chapterIds)
    .order("scene_number");

  if (sceneError || !dbScenes?.length) return null;

  let resolvedBookTitle = bookTitle;
  if (!resolvedBookTitle && resolvedBookId) {
    const { data: bookRow } = await supabase
      .from("books")
      .select("title")
      .eq("id", resolvedBookId)
      .maybeSingle();
    resolvedBookTitle = bookRow?.title || "";
  }

  return {
    chapterId: chapterRow.id,
    chapterTitle: chapterRow.title,
    bookTitle: resolvedBookTitle,
    bookId: resolvedBookId,
    scenes: dbScenes.map((scene) => ({
      id: scene.id,
      scene_number: scene.scene_number,
      title: scene.title,
      scene_type: scene.scene_type || "mixed",
      mood: scene.mood || "",
      bpm: scene.bpm || 120,
      content: scene.content || undefined,
      content_preview: scene.content?.slice(0, 200) || undefined,
    })),
  };
}

/**
 * Manages Studio session: loads from sessionStorage first, falls back to cloud settings.
 * Persists state changes to cloud with debounce.
 * Returns { chapter, restored } — `restored` is true once initial load is complete.
 */
export function useStudioSession() {
  const { value: cloudState, update: saveCloudState, loaded: cloudLoaded } =
    useCloudSettings<StudioSessionState>("studio_session", EMPTY_STATE);

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

  // ── Restore from cloud if sessionStorage is empty ─────────
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

    if (!resolvedChapterTitle) {
      setRestored(true);
      return;
    }

    (async () => {
      try {
        const restoredChapter = await restoreChapterFromDb({
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
  }, [cloudLoaded]);

  useEffect(() => {
    if (!chapter) return;
    saveStudioChapter(chapter);
  }, [chapter]);

  // ── Persist scene index to sessionStorage ─────────────────
  useEffect(() => {
    if (selectedSceneIdx !== null) {
      sessionStorage.setItem("studio_selected_scene_idx", String(selectedSceneIdx));
    } else {
      sessionStorage.removeItem("studio_selected_scene_idx");
    }
  }, [selectedSceneIdx]);

  // ── Save state to cloud on changes (debounced via useCloudSettings) ──
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

  // Cleanup
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
