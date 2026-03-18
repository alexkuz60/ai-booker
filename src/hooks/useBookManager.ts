/**
 * useBookManager — thin orchestrator that holds shared state
 * and wires together the specialized sub-hooks:
 * - useLibrary (book listing)
 * - useFileUpload (PDF/DOCX extraction)
 * - useBookRestore (local/server restore)
 * - useServerSync (cross-device timestamp check)
 *
 * NO business logic lives here — only state + wiring.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { t } from "@/pages/parser/i18n";
import type { Scene, TocChapter, Step, ChapterStatus, BookRecord } from "@/pages/parser/types";
import { ACTIVE_BOOK_KEY } from "@/pages/parser/types";
import { OPFSStorage, type ProjectStorage } from "@/lib/projectStorage";

// ── Heartbeat: detect stale sessionStorage after PC restart ──
const HEARTBEAT_KEY = "parser_heartbeat";
const HEARTBEAT_STALE_MS = 5 * 60 * 1000; // 5 minutes

function isSessionStale(): boolean {
  const raw = localStorage.getItem(HEARTBEAT_KEY);
  if (!raw) return true; // no heartbeat → treat as stale
  const elapsed = Date.now() - Number(raw);
  return elapsed > HEARTBEAT_STALE_MS;
}

function writeHeartbeat() {
  localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
}

import { useLibrary } from "@/hooks/useLibrary";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useBookRestore } from "@/hooks/useBookRestore";
import { useServerSync } from "@/hooks/useServerSync";

interface UseBookManagerParams {
  userId: string | undefined;
  isRu: boolean;
  projectStorage?: ProjectStorage | null;
  projectStorageInitialized?: boolean;
  storageBackend?: "fs-access" | "opfs" | "none";
  createProject?: (title: string, bookId: string, userId: string, language: "ru" | "en") => Promise<ProjectStorage>;
  pendingProjectName?: string | null;
}

export function useBookManager({
  userId, isRu, projectStorage, projectStorageInitialized = false,
  storageBackend = "none", createProject, pendingProjectName,
}: UseBookManagerParams) {
  // ── Shared state ──────────────────────────────────────────
  const [step, setStep] = useState<Step>(() => {
    const savedBookId = sessionStorage.getItem(ACTIVE_BOOK_KEY);
    if (!savedBookId) return "library";
    // If heartbeat is stale (PC restart), clear session and go to library
    if (isSessionStale()) {
      console.info("[Heartbeat] Session stale after restart, clearing ACTIVE_BOOK_KEY");
      sessionStorage.removeItem(ACTIVE_BOOK_KEY);
      return "library";
    }
    return "extracting_toc";
  });
  const [fileName, setFileName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [bookId, setBookId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const [partIdMap, setPartIdMap] = useState<Map<string, string>>(new Map());
  const [chapterIdMap, setChapterIdMap] = useState<Map<number, string>>(new Map());
  const [tocEntries, setTocEntries] = useState<TocChapter[]>([]);
  const [chapterResults, setChapterResults] = useState<Map<number, { scenes: Scene[]; status: ChapterStatus }>>(new Map());

  // pdfRef/totalPages are managed by useBookRestore but also set by useFileUpload
  const [pdfRefState, setPdfRef] = useState<any>(null);
  const [totalPagesState, setTotalPages] = useState(0);

  // ── Heartbeat: write on step changes + beforeunload ──────
  useEffect(() => {
    if (step !== "library") writeHeartbeat();
  }, [step]);

  useEffect(() => {
    const onUnload = () => writeHeartbeat();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  // ── Sub-hooks ─────────────────────────────────────────────
  const library = useLibrary({ userId, storageBackend, projectStorage, step });

  const upload = useFileUpload({
    userId, isRu, storageBackend, projectStorage, createProject, bookId, pendingProjectName,
    setStep, setFileName, setBookId, setTocEntries, setChapterIdMap,
    setPartIdMap, setChapterResults, setPdfRef, setTotalPages, setFile, setErrorMsg,
  });

  const restore = useBookRestore({
    userId, isRu, storageBackend, projectStorage, createProject,
    books: library.books, fileName, bookId,
    setStep, setFileName, setBookId, setTocEntries, setChapterIdMap,
    setPartIdMap, setChapterResults, setPdfRef, setTotalPages, setErrorMsg,
  });

  // openSavedBook ref for useServerSync (breaks circular dependency)
  const openSavedBookRef = useRef<(book: BookRecord, options?: { skipTimestampCheck?: boolean }) => Promise<void>>();

  const serverSync = useServerSync({
    projectStorage, storageBackend,
    localProjectNamesByBookId: library.localProjectNamesByBookId,
    loadBookFromServerById: library.loadBookFromServerById,
    openSavedBookRef,
  });

  // ── Wrap openSavedBook to inject sync dependencies ─────────
  const openSavedBook = useCallback(async (book: BookRecord, options?: { skipTimestampCheck?: boolean }) => {
    await restore.openSavedBook(book, options, serverSync.checkServerNewer, serverSync.setServerNewerBookId);
  }, [restore.openSavedBook, serverSync.checkServerNewer, serverSync.setServerNewerBookId]);

  // Keep ref in sync
  openSavedBookRef.current = openSavedBook;

  // Use pdfRef/totalPages from restore hook (it manages lazy loading)
  const pdfRef = restore.pdfRef ?? pdfRefState;
  const totalPages = restore.totalPages || totalPagesState;

  // ── Auto-restore active book on mount ──────────────────────
  const [restoredOnce, setRestoredOnce] = useState(false);

  useEffect(() => {
    if (restoredOnce || !userId) return;
    const savedBookId = sessionStorage.getItem(ACTIVE_BOOK_KEY);

    if (!savedBookId) {
      if (step === "extracting_toc") setStep("library");
      setRestoredOnce(true);
      return;
    }

    if (storageBackend === "opfs" && !projectStorageInitialized) return;

    setRestoredOnce(true);

    restore.restoreFromLocal(savedBookId).then(async (restored) => {
      const shouldSync = serverSync.shouldRunServerSyncCheck(savedBookId);

      if (restored) {
        if (shouldSync) {
          const isNewer = await serverSync.checkServerNewer(savedBookId);
          serverSync.markServerSyncChecked(savedBookId);
          if (isNewer) serverSync.setServerNewerBookId(savedBookId);
        }
        return;
      }

      if (!shouldSync) {
        setStep("library");
        return;
      }

      const isServerNewerForThisBrowser = await serverSync.checkServerNewer(savedBookId, { allowMissingLocalTimestamp: true });
      serverSync.markServerSyncChecked(savedBookId);
      if (!isServerNewerForThisBrowser) {
        setStep("library");
        return;
      }

      const book = await library.loadBookFromServerById(savedBookId);
      if (book) {
        await openSavedBook(book, { skipTimestampCheck: true });
      } else {
        sessionStorage.removeItem(ACTIVE_BOOK_KEY);
        setStep("library");
      }
    });
  }, [
    userId, restoredOnce,
    restore.restoreFromLocal, serverSync.checkServerNewer,
    storageBackend, projectStorageInitialized,
    serverSync.shouldRunServerSyncCheck, serverSync.markServerSyncChecked,
    library.loadBookFromServerById, step, openSavedBook,
  ]);

  // ── Delete book ───────────────────────────────────────────
  const deleteBook = useCallback(async (delBookId: string) => {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(delBookId);

    try {
      const localProjects = library.localProjectNamesByBookId.get(delBookId) || [];
      if (storageBackend === "opfs" && localProjects.length > 0) {
        await Promise.all(localProjects.map((projectName) => OPFSStorage.deleteProject(projectName)));
      }

      // Also delete from server if it exists there
      if (isUuid) {
        const { error } = await supabase.from("books").delete().eq("id", delBookId);
        if (error) throw error;
      }

      if (bookId === delBookId) {
        sessionStorage.removeItem(ACTIVE_BOOK_KEY);
        setStep("library");
        setBookId(null);
      }

      await library.loadLibrary();
      toast.success(t("bookDeleted", isRu));
    } catch (err) {
      console.error("Failed to delete book:", err);
      toast.error(t("bookDeleteFailed", isRu));
    }
  }, [isRu, storageBackend, library.localProjectNamesByBookId, bookId, library.loadLibrary]);

  // ── Clear all local projects ──────────────────────────────
  const clearAllProjects = useCallback(async () => {
    try {
      if (storageBackend === "opfs") {
        const allProjects = await OPFSStorage.listProjects();
        await Promise.all(allProjects.map((name) => OPFSStorage.deleteProject(name)));
      }
      sessionStorage.removeItem(ACTIVE_BOOK_KEY);
      sessionStorage.removeItem("docx_chapter_texts");
      sessionStorage.removeItem("docx_html");
      setStep("library");
      setBookId(null);
      await library.loadLibrary();
      toast.success(isRu ? "Все проекты удалены" : "All projects cleared");
    } catch (err) {
      console.error("Failed to clear projects:", err);
      toast.error(isRu ? "Не удалось очистить" : "Failed to clear");
    }
  }, [storageBackend, isRu, library.loadLibrary]);

  // ── Reload book ───────────────────────────────────────────
  const reloadBook = useCallback(async () => {
    if (!bookId) return;
    try {
      // Clear DOCX session data
      sessionStorage.removeItem("docx_chapter_texts");
      sessionStorage.removeItem("docx_html");

      // Clean up local OPFS structure only (keep project.json and source/)
      if (storageBackend === "opfs") {
        const projectNames = library.localProjectNamesByBookId.get(bookId);
        if (projectNames?.length) {
          for (const name of projectNames) {
            try {
              const store = await OPFSStorage.openOrCreate(name);
              const structFiles = await store.listDir("structure").catch(() => []);
              for (const f of structFiles) await store.delete(`structure/${f}`).catch(() => {});
              const sceneFiles = await store.listDir("scenes").catch(() => []);
              for (const f of sceneFiles) await store.delete(`scenes/${f}`).catch(() => {});
            } catch {}
          }
        }
      } else if (projectStorage?.isReady) {
        try {
          await projectStorage.writeJSON("structure/toc.json", []);
          await projectStorage.writeJSON("structure/characters.json", []);
        } catch {}
      }

      // Reset state but keep bookId for re-association
      setPartIdMap(new Map());
      setChapterIdMap(new Map());
      setTocEntries([]);
      setPdfRef(null);
      setFile(null);
      setChapterResults(new Map());
      setStep("upload");
      toast.info(isRu ? "Выберите новый файл для перезагрузки книги" : "Select a new file to reload the book");
    } catch (err) {
      console.error("Failed to reload book:", err);
      toast.error(isRu ? "Не удалось очистить данные книги" : "Failed to clear book data");
    }
  }, [bookId, isRu, storageBackend, library.localProjectNamesByBookId, projectStorage]);

  // ── Reset ─────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setStep("library");
    sessionStorage.removeItem(ACTIVE_BOOK_KEY);
    setFileName("");
    setErrorMsg("");
    setBookId(null);
    setPartIdMap(new Map());
    setChapterIdMap(new Map());
    setTocEntries([]);
    setPdfRef(null);
    setFile(null);
    setChapterResults(new Map());
  }, []);

  // ── Return combined API (same interface as before) ─────────
  return {
    // State
    step, setStep,
    books: library.books,
    loadingLibrary: library.loadingLibrary,
    fileName, errorMsg, bookId,
    uploadProgress: upload.uploadProgress,
    partIdMap, chapterIdMap, setChapterIdMap,
    tocEntries, setTocEntries,
    pdfRef, totalPages,
    file,
    chapterResults, setChapterResults,
    fileInputRef: upload.fileInputRef,
    // Actions
    openSavedBook,
    deleteBook,
    clearAllProjects,
    handleFileSelect: upload.handleFileSelect,
    handleReset,
    reloadBook,
    ensurePdfLoaded: restore.ensurePdfLoaded,
    reloadLibrary: library.loadLibrary,
    renameBook: library.renameBook,
    // Server books
    serverBooks: library.serverBooks,
    loadingServerBooks: library.loadingServerBooks,
    // Sync-check
    serverNewerBookId: serverSync.serverNewerBookId,
    dismissServerNewer: serverSync.dismissServerNewer,
    acceptServerVersion: serverSync.acceptServerVersion,
  };
}
