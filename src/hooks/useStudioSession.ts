import { useState, useEffect, useCallback, useRef } from "react";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import { supabase } from "@/integrations/supabase/client";
import { loadStudioChapter, saveStudioChapter, type StudioChapter } from "@/lib/studioChapter";

/**
 * Persisted studio session state — saved to user_settings (cloud) for cross-session restore.
 */
interface StudioSessionState {
  bookId: string | null;
  bookTitle: string;
  chapterTitle: string;
  selectedSceneIdx: number | null;
  activeTab: string;
}

const EMPTY_STATE: StudioSessionState = {
  bookId: null,
  bookTitle: "",
  chapterTitle: "",
  selectedSceneIdx: null,
  activeTab: "storyboard",
};

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

    // If we already have a chapter from sessionStorage — no need to restore
    if (chapter) {
      setRestored(true);
      return;
    }

    // No sessionStorage chapter — try to restore from cloud
    const { bookId, chapterTitle, bookTitle, selectedSceneIdx: savedIdx, activeTab: savedTab } = cloudState;
    if (!chapterTitle) {
      setRestored(true);
      return;
    }

    // Restore chapter from DB
    (async () => {
      try {
        // Find chapter by title
        const query = supabase
          .from("book_chapters")
          .select("id, title, book_id")
          .ilike("title", chapterTitle);

        // If we have bookId, narrow down
        const { data: dbChapters } = bookId
          ? await query.eq("book_id", bookId)
          : await query;

        if (!dbChapters?.length) {
          setRestored(true);
          return;
        }

        const chapterRow = dbChapters[0];
        const resolvedBookId = chapterRow.book_id;

        // Load scenes for this chapter
        const chapterIds = dbChapters.map(c => c.id);
        const { data: dbScenes } = await supabase
          .from("book_scenes")
          .select("id, scene_number, title, scene_type, mood, bpm, content")
          .in("chapter_id", chapterIds)
          .order("scene_number");

        if (!dbScenes?.length) {
          setRestored(true);
          return;
        }

        // Resolve book title if needed
        let resolvedBookTitle = bookTitle;
        if (!resolvedBookTitle && resolvedBookId) {
          const { data: bookRow } = await supabase
            .from("books")
            .select("title")
            .eq("id", resolvedBookId)
            .maybeSingle();
          resolvedBookTitle = bookRow?.title || "";
        }

        const restoredChapter: StudioChapter = {
          chapterTitle: chapterRow.title,
          bookTitle: resolvedBookTitle,
          bookId: resolvedBookId,
          scenes: dbScenes.map(s => ({
            id: s.id,
            scene_number: s.scene_number,
            title: s.title,
            scene_type: s.scene_type || "mixed",
            mood: s.mood || "",
            bpm: s.bpm || 120,
            content: s.content || undefined,
            content_preview: s.content?.slice(0, 200) || undefined,
          })),
        };

        // Save to sessionStorage for fast access
        saveStudioChapter(restoredChapter);
        setChapter(restoredChapter);

        if (savedIdx !== null && savedIdx >= 0 && savedIdx < dbScenes.length) {
          setSelectedSceneIdx(savedIdx);
          sessionStorage.setItem("studio_selected_scene_idx", String(savedIdx));
        }

        if (savedTab) {
          setActiveTab(savedTab);
          sessionStorage.setItem("studio_active_tab", savedTab);
        }
      } catch (err) {
        console.error("[useStudioSession] Failed to restore:", err);
      } finally {
        setRestored(true);
      }
    })();
  }, [cloudLoaded]);

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
