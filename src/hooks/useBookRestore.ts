/**
 * useBookRestore — restores books from OPFS or server.
 * restoreFromLocal: reads from OPFS ProjectStorage.
 * openSavedBook: local-only — tries OPFS first; deploys from server via Wipe-and-Deploy.
 * ensurePdfLoaded: lazy-loads PDF proxy from local project.
 *
 * Heavy lifting delegated to:
 *   - src/lib/localProjectResolver.ts (storage resolution)
 *   - src/lib/serverDeploy.ts (Wipe-and-Deploy pipeline)
 */

import type { SyncProgressCallback } from "@/components/SyncProgressDialog";

import { useState, useCallback } from "react";
import { clearChapterTextsCache } from "@/lib/chapterTextsCache";
import { toast } from "sonner";
import { t } from "@/pages/parser/i18n";
import type { Scene, TocChapter, Step, ChapterStatus, BookRecord } from "@/pages/parser/types";
import { normalizeLevels, ACTIVE_BOOK_KEY } from "@/pages/parser/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import { syncStructureToLocal, readStructureFromLocal } from "@/lib/localSync";
import { normalizeTocRanges, sanitizeChapterResultsForStructure } from "@/lib/tocStructure";
import { detectFileFormat, getSourcePath, findSourceBlob, type FileFormat } from "@/lib/fileFormatUtils";
import { wipeProjectBrowserState } from "@/lib/projectCleanup";
import {
  resolveLocalStorageForBook,
  ensureWritableLocalStorage,
} from "@/lib/localProjectResolver";
import { deployFromServer } from "@/lib/serverDeploy";

interface UseBookRestoreParams {
  userId: string | undefined;
  isRu: boolean;
  storageBackend: "fs-access" | "opfs" | "none";
  projectStorage?: ProjectStorage | null;
  createProject?: (title: string, bookId: string, userId: string, language: "ru" | "en") => Promise<ProjectStorage>;
  openProjectByName?: (projectName: string) => Promise<ProjectStorage | null>;
  books: BookRecord[];
  fileName: string;
  bookId: string | null;
  localProjectNamesByBookId: Map<string, string[]>;
  setStep: (s: Step) => void;
  setFileName: (s: string) => void;
  setBookId: (id: string | null) => void;
  setTocEntries: React.Dispatch<React.SetStateAction<TocChapter[]>>;
  setChapterIdMap: React.Dispatch<React.SetStateAction<Map<number, string>>>;
  setPartIdMap: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  setChapterResults: React.Dispatch<React.SetStateAction<Map<number, { scenes: Scene[]; status: ChapterStatus }>>>;
  setPdfRef: React.Dispatch<React.SetStateAction<any>>;
  setTotalPages: React.Dispatch<React.SetStateAction<number>>;
  setErrorMsg: React.Dispatch<React.SetStateAction<string>>;
  bumpProgressVersion?: () => void;
}

export function useBookRestore({
  userId, isRu, storageBackend, projectStorage, createProject, openProjectByName,
  books, fileName, bookId, localProjectNamesByBookId,
  setStep, setFileName, setBookId, setTocEntries, setChapterIdMap,
  setPartIdMap, setChapterResults, setPdfRef, setTotalPages, setErrorMsg,
  bumpProgressVersion,
}: UseBookRestoreParams) {
  const [pdfRef, setPdfRefLocal] = useState<any>(null);
  const [totalPages, setTotalPagesLocal] = useState(0);

  const updatePdfRef = useCallback((ref: any) => {
    setPdfRefLocal(ref);
    setPdfRef(ref);
  }, [setPdfRef]);

  const updateTotalPages = useCallback((pages: number) => {
    setTotalPagesLocal(pages);
    setTotalPages(pages);
  }, [setTotalPages]);

  const clearTransientBookState = useCallback(() => {
    updatePdfRef(null);
    updateTotalPages(0);
    clearChapterTextsCache();
  }, [updatePdfRef, updateTotalPages]);

  // ── Resolver opts (shared between callbacks) ──────────────
  const resolverOpts = useCallback(() => ({
    storageBackend,
    localProjectNamesByBookId,
    projectStorage,
    openProjectByName,
    createProject,
    userId,
    isRu,
  }), [storageBackend, localProjectNamesByBookId, projectStorage, openProjectByName, createProject, userId, isRu]);

  // ── Restore from local OPFS ───────────────────────────────

  const restoreFromLocal = useCallback(async (savedBookId: string): Promise<boolean> => {
    clearTransientBookState();

    const storage = await resolveLocalStorageForBook(savedBookId, resolverOpts(), { activate: true });
    if (!storage?.isReady) return false;

    try {
      const local = await readStructureFromLocal(storage);
      if (!local?.structure || local.structure.bookId !== savedBookId) return false;

      const { structure, chapterIdMap: localChIdMap, chapterResults: localResults } = local;
      const normalizedToc = normalizeTocRanges(normalizeLevels(structure.toc));
      const sanitizedLocalResults = sanitizeChapterResultsForStructure(normalizedToc, localResults);

      setBookId(savedBookId);
      setFileName(structure.fileName);
      setTocEntries(normalizedToc);
      setChapterIdMap(localChIdMap);
      setChapterResults(sanitizedLocalResults);

      const newPartIdMap = new Map<string, string>();
      for (const p of structure.parts) newPartIdMap.set(p.title, p.id);
      setPartIdMap(newPartIdMap);

      sessionStorage.setItem(ACTIVE_BOOK_KEY, savedBookId);
      setStep("workspace");

      await syncStructureToLocal(storage, {
        bookId: savedBookId,
        title: structure.title,
        fileName: structure.fileName,
        toc: normalizedToc,
        parts: structure.parts,
        chapterIdMap: localChIdMap,
        chapterResults: sanitizedLocalResults,
      });

      const localMeta = await storage.readJSON<Record<string, unknown>>("project.json");
      const localFormat: FileFormat = (localMeta?.fileFormat as FileFormat) || detectFileFormat(structure.fileName);

      if (localFormat === "pdf") {
        const sourcePath = getSourcePath(localFormat);
        storage.readBlob(sourcePath).then(async (pdfBlob) => {
          if (!pdfBlob) return;
          try {
            const arrayBuffer = await pdfBlob.arrayBuffer();
            const { getDocument } = await import("pdfjs-dist");
            const pdf = await getDocument({ data: arrayBuffer }).promise;
            updatePdfRef(pdf);
            updateTotalPages(pdf.numPages);
          } catch (pdfErr) {
            console.warn("[LocalRestore] Failed to parse local PDF:", pdfErr);
          }
        });
      }

      toast.success(isRu ? `Книга «${structure.title}» загружена` : `Book "${structure.title}" loaded`);
      return true;
    } catch (err) {
      console.warn("[LocalRestore] Failed:", err);
      return false;
    }
  }, [clearTransientBookState, resolverOpts, isRu, setBookId, setFileName, setTocEntries, setChapterIdMap, setChapterResults, setPartIdMap, setStep, updatePdfRef, updateTotalPages]);

  // ── Open saved book (local → server fallback via Wipe-and-Deploy) ──

  const openSavedBook = useCallback(async (
    book: BookRecord,
    options?: { skipTimestampCheck?: boolean; downloadImpulses?: boolean; downloadAtmosphere?: boolean; downloadSfx?: boolean },
    checkServerNewer?: (bookId: string) => Promise<boolean>,
    setServerNewerBookId?: (bookId: string | null) => void,
    onProgress?: SyncProgressCallback,
  ) => {
    const report = onProgress || (() => {});
    if (!userId) return;

    // Try local restore first (unless explicitly skipped)
    if (!options?.skipTimestampCheck) {
      const canTryLocal = !!(await resolveLocalStorageForBook(book.id, resolverOpts()));
      if (canTryLocal) {
        const restored = await restoreFromLocal(book.id);
        if (restored) {
          if (checkServerNewer && setServerNewerBookId) {
            const isNewer = await checkServerNewer(book.id);
            if (isNewer) setServerNewerBookId(book.id);
          }
          return;
        }
        console.warn(`[OpenBook] Local copy found for ${book.id} but restore failed, falling through to server deploy`);
      } else {
        console.log(`[OpenBook] No local copy for ${book.id}, deploying from server`);
      }
    }

    // ── Preserve source file from existing OPFS before wipe ──
    let preservedSourceBlob: Blob | null = null;
    const existingProjects = localProjectNamesByBookId.get(book.id) || [];
    if (existingProjects.length > 0) {
      try {
        const { OPFSStorage } = await import("@/lib/projectStorage");
        const oldStore = await OPFSStorage.openOrCreate(existingProjects[0]);
        if (oldStore.isReady) {
          const found = await findSourceBlob(oldStore);
          if (found) {
            preservedSourceBlob = found.blob;
            console.log(`[OpenBook] Preserved source file (${found.format}) before wipe`);
          }
        }
      } catch (err) {
        console.warn("[OpenBook] Failed to preserve source file:", err);
      }
    }

    // ── Wipe-and-Deploy ─────────────────────────────────────
    report("wipe", "running");
    await wipeProjectBrowserState(book.id, existingProjects);
    clearTransientBookState();
    setStep("extracting_toc");
    setFileName(book.file_name);
    setBookId(book.id);
    sessionStorage.setItem(ACTIVE_BOOK_KEY, book.id);
    report("wipe", "done");

    try {
      const opts = resolverOpts();
      const targetStorage = await ensureWritableLocalStorage(
        book.id,
        book.title || book.file_name,
        book.file_name,
        opts,
      );

      if (!targetStorage?.isReady) {
        throw new Error(isRu ? "Не удалось создать локальный проект" : "Failed to create local project");
      }

      const result = await deployFromServer({
        book,
        storage: targetStorage,
        isRu,
        report,
        downloadImpulses: options?.downloadImpulses ?? false,
        downloadAtmosphere: options?.downloadAtmosphere ?? false,
        downloadSfx: options?.downloadSfx ?? false,
        preservedSourceBlob,
        userId,
      });

      // Apply results to React state
      updatePdfRef(result.pdfProxy);
      updateTotalPages(result.totalPages);
      setTocEntries(result.toc);
      setChapterIdMap(result.chapterIdMap);
      setPartIdMap(result.partIdMap);
      setChapterResults(result.chapterResults);
      setStep("workspace");

      const bookFormat = detectFileFormat(book.file_name);
      const formatLabel = bookFormat.toUpperCase();
      const sourceStatus = result.sourceFilePreserved
        ? ` (${isRu ? `${formatLabel} сохранён` : `${formatLabel} preserved`})`
        : ` (${isRu ? `${formatLabel} не найден, только просмотр` : `${formatLabel} not found, view only`})`;
      toast.success(`${t("bookLoaded", isRu)}: «${book.title}»${sourceStatus}`);
    } catch (err: any) {
      console.error("Failed to open book:", err);
      setErrorMsg(err.message || "Unknown error");
      setStep("error");
    }
  }, [
    userId, isRu, resolverOpts, restoreFromLocal,
    clearTransientBookState, localProjectNamesByBookId,
    updatePdfRef, updateTotalPages,
    setStep, setFileName, setBookId, setTocEntries,
    setChapterIdMap, setPartIdMap, setChapterResults, setErrorMsg,
  ]);

  // ── Lazy PDF loader ───────────────────────────────────────

  const ensurePdfLoaded = useCallback(async (): Promise<any> => {
    if (pdfRef) return pdfRef;
    if (!bookId) return null;

    const storage = await resolveLocalStorageForBook(bookId, resolverOpts());

    let format: FileFormat = "pdf";
    if (storage?.isReady) {
      try {
        const meta = await storage.readJSON<Record<string, unknown>>("project.json");
        if (meta?.fileFormat) format = meta.fileFormat as FileFormat;
      } catch {}
    }
    if (format === "pdf" && fileName) {
      const detected = detectFileFormat(fileName);
      if (detected !== "pdf") format = detected;
    }

    // Only PDF format needs a proxy loader; DOCX and FB2 don't use pdfjs
    if (format !== "pdf") return null;

    const loadPdf = async (arrayBuffer: ArrayBuffer) => {
      const { getDocument } = await import("pdfjs-dist");
      const pdf = await getDocument({ data: arrayBuffer }).promise;
      updatePdfRef(pdf);
      updateTotalPages(pdf.numPages);
      return pdf;
    };

    if (storage?.isReady) {
      try {
        const localBlob = await storage.readBlob(getSourcePath("pdf"));
        if (localBlob) return await loadPdf(await localBlob.arrayBuffer());
      } catch (err) {
        console.warn("[EnsurePDF] Local read failed:", err);
      }
    }

    // К3: No server fallback
    console.warn("[EnsurePDF] PDF not found in local project.");
    return null;
  }, [pdfRef, bookId, resolverOpts, fileName, updatePdfRef, updateTotalPages]);

  return {
    pdfRef,
    totalPages,
    restoreFromLocal,
    openSavedBook,
    ensurePdfLoaded,
  };
}
