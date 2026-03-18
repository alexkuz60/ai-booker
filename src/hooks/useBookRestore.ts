/**
 * useBookRestore — restores books from OPFS or server.
 * restoreFromLocal: reads from OPFS ProjectStorage.
 * openSavedBook: local-first, falls back to server for "New Workstation Flow".
 * ensurePdfLoaded: lazy-loads PDF proxy from local or server.
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  flattenTocWithRanges, type TocEntry,
} from "@/lib/pdf-extract";
import { t } from "@/pages/parser/i18n";
import type { Scene, TocChapter, Step, ChapterStatus, BookRecord } from "@/pages/parser/types";
import { classifySection, normalizeLevels, ACTIVE_BOOK_KEY } from "@/pages/parser/types";
import { OPFSStorage, type ProjectStorage } from "@/lib/projectStorage";
import { syncStructureToLocal, readStructureFromLocal } from "@/lib/localSync";
import { isFolderNode, normalizeTocRanges, sanitizeChapterResultsForStructure } from "@/lib/tocStructure";
import { detectFileFormat, getSourcePath, stripFileExtension, type FileFormat } from "@/lib/fileFormatUtils";
import { mapFlatToChapters } from "@/hooks/useFileUpload";

interface UseBookRestoreParams {
  userId: string | undefined;
  isRu: boolean;
  storageBackend: "fs-access" | "opfs" | "none";
  projectStorage?: ProjectStorage | null;
  createProject?: (title: string, bookId: string, userId: string, language: "ru" | "en") => Promise<ProjectStorage>;
  /** For ensurePdfLoaded fallback */
  books: BookRecord[];
  fileName: string;
  bookId: string | null;
  /** Map of bookId → OPFS project names (from useLibrary) */
  localProjectNamesByBookId: Map<string, string[]>;
  // State setters from orchestrator
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
}

export function useBookRestore({
  userId, isRu, storageBackend, projectStorage, createProject,
  books, fileName, bookId, localProjectNamesByBookId,
  setStep, setFileName, setBookId, setTocEntries, setChapterIdMap,
  setPartIdMap, setChapterResults, setPdfRef, setTotalPages, setErrorMsg,
}: UseBookRestoreParams) {
  const [pdfRef, setPdfRefLocal] = useState<any>(null);
  const [totalPages, setTotalPagesLocal] = useState(0);

  // Sync local + parent state for pdfRef and totalPages
  const updatePdfRef = useCallback((ref: any) => {
    setPdfRefLocal(ref);
    setPdfRef(ref);
  }, [setPdfRef]);

  const updateTotalPages = useCallback((pages: number) => {
    setTotalPagesLocal(pages);
    setTotalPages(pages);
  }, [setTotalPages]);

  // ─── Restore from local ProjectStorage ─────────────────────
  const restoreFromLocal = useCallback(async (savedBookId: string): Promise<boolean> => {
    // ── Find the correct OPFS project for this bookId ──
    let storage: ProjectStorage | null | undefined = null;

    if (storageBackend === "opfs") {
      const projectNames = localProjectNamesByBookId.get(savedBookId);
      if (projectNames?.length) {
        try {
          storage = await OPFSStorage.openOrCreate(projectNames[0]);
          console.debug("[LocalRestore] Opened OPFS project for book:", projectNames[0], savedBookId);
        } catch (err) {
          console.warn("[LocalRestore] Failed to open OPFS project:", projectNames[0], err);
        }
      }
    }

    // Fallback to current projectStorage if OPFS lookup didn't work
    if (!storage?.isReady) {
      storage = projectStorage;
    }

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
      for (const p of structure.parts) {
        newPartIdMap.set(p.title, p.id);
      }
      setPartIdMap(newPartIdMap);

      sessionStorage.setItem(ACTIVE_BOOK_KEY, savedBookId);
      setStep("workspace");

      // Normalize legacy local data immediately
      void syncStructureToLocal(projectStorage, {
        bookId: savedBookId,
        title: structure.title,
        fileName: structure.fileName,
        toc: normalizedToc,
        parts: structure.parts,
        chapterIdMap: localChIdMap,
        chapterResults: sanitizedLocalResults,
      });

      // Restore source file (async, non-blocking)
      const localMeta = await projectStorage.readJSON<Record<string, unknown>>("project.json");
      const localFormat: FileFormat = (localMeta?.fileFormat as FileFormat) || detectFileFormat(structure.fileName);

      if (localFormat === "pdf") {
        const sourcePath = getSourcePath(localFormat);
        projectStorage.readBlob(sourcePath).then(async (pdfBlob) => {
          if (!pdfBlob) {
            console.log("[LocalRestore] No local PDF found, will download on demand");
            return;
          }
          try {
            const arrayBuffer = await pdfBlob.arrayBuffer();
            const { getDocument } = await import("pdfjs-dist");
            const pdf = await getDocument({ data: arrayBuffer }).promise;
            updatePdfRef(pdf);
            updateTotalPages(pdf.numPages);
            console.log(`[LocalRestore] PDF restored locally: ${pdf.numPages} pages`);
          } catch (pdfErr) {
            console.warn("[LocalRestore] Failed to parse local PDF:", pdfErr);
          }
        });
      } else {
        console.log("[LocalRestore] DOCX book — skipping PDF proxy restore");
      }

      console.log(`[LocalRestore] Restored from local: ${structure.toc.length} chapters, ${localResults.size} results`);
      toast.success(
        isRu
          ? `Книга «${structure.title}» восстановлена из локального проекта`
          : `Book "${structure.title}" restored from local project`
      );
      return true;
    } catch (err) {
      console.warn("[LocalRestore] Failed:", err);
      return false;
    }
  }, [projectStorage, isRu, setBookId, setFileName, setTocEntries, setChapterIdMap, setChapterResults, setPartIdMap, setStep, updatePdfRef, updateTotalPages]);

  // ─── Open saved book (local-first + server fallback) ────────
  const openSavedBook = useCallback(async (
    book: BookRecord,
    options?: { skipTimestampCheck?: boolean },
    checkServerNewer?: (bookId: string) => Promise<boolean>,
    setServerNewerBookId?: (bookId: string | null) => void,
  ) => {
    if (!userId) return;

    if (projectStorage?.isReady) {
      const restored = await restoreFromLocal(book.id);
      if (restored) {
        if (!options?.skipTimestampCheck && checkServerNewer && setServerNewerBookId) {
          const isNewer = await checkServerNewer(book.id);
          if (isNewer) setServerNewerBookId(book.id);
        }
        return;
      }
    }

    setStep("extracting_toc");
    setFileName(book.file_name);
    setBookId(book.id);
    sessionStorage.setItem(ACTIVE_BOOK_KEY, book.id);

    try {
      const [partsRes, chaptersRes, pdfBlob] = await Promise.all([
        supabase.from('book_parts').select('id, part_number, title').eq('book_id', book.id).order('part_number'),
        supabase.from('book_chapters').select('id, chapter_number, title, scene_type, mood, bpm, part_id, level, start_page, end_page').eq('book_id', book.id).order('chapter_number'),
        book.file_path
          ? supabase.storage.from('book-uploads').download(book.file_path).then(r => r.data)
          : Promise.resolve(null),
      ]);

      const parts = partsRes.data || [];
      const chapters = chaptersRes.data || [];

      if (chapters.length === 0) {
        toast.info(t("noChaptersFound", isRu));
        setStep("upload");
        return;
      }

      const bookFormat = detectFileFormat(book.file_name);
      const isBookDocx = bookFormat === "docx";

      let restoredPdf: any = null;
      let restoredTotalPages = 0;
      let tocFromPdf: { startPage: number; endPage: number; level: number }[] = [];

      if (!isBookDocx && pdfBlob) {
        try {
          const arrayBuffer = await pdfBlob.arrayBuffer();
          const { getDocument } = await import('pdfjs-dist');
          const pdf = await getDocument({ data: arrayBuffer }).promise;
          restoredPdf = pdf;
          restoredTotalPages = pdf.numPages;

          const rawOutline = await pdf.getOutline();
          if (rawOutline && rawOutline.length > 0) {
            const flat = flattenTocWithRanges(
              await (async function parseItems(items: any[], level: number): Promise<TocEntry[]> {
                const entries: TocEntry[] = [];
                for (const item of items) {
                  let pageNumber = 1;
                  try {
                    if (item.dest) {
                      const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
                      if (dest && dest[0]) {
                        const pageIndex = await pdf.getPageIndex(dest[0]);
                        pageNumber = pageIndex + 1;
                      }
                    }
                  } catch { /* fallback */ }
                  const children = item.items?.length ? await parseItems(item.items, level + 1) : [];
                  entries.push({ title: item.title || 'Untitled', pageNumber, level, children });
                }
                return entries;
              })(rawOutline, 0),
              pdf.numPages
            );

            tocFromPdf = chapters.map((ch, i) => {
              const byTitle = flat.find(f => f.title === ch.title);
              if (byTitle) return { startPage: byTitle.startPage, endPage: byTitle.endPage, level: byTitle.level };
              if (i < flat.length) return { startPage: flat[i].startPage, endPage: flat[i].endPage, level: flat[i].level };
              return { startPage: 0, endPage: 0, level: 0 };
            });
          }
        } catch (pdfErr) {
          console.warn("Could not restore PDF for analysis:", pdfErr);
        }
      } else if (!isBookDocx && book.file_path && !pdfBlob) {
        toast.warning(
          isRu
            ? "PDF-файл не найден на сервере. Анализ будет недоступен до повторной загрузки."
            : "PDF file not found on server. Analysis unavailable until re-upload."
        );
      } else if (isBookDocx) {
        console.log("[OpenBook] DOCX book — no PDF proxy needed");
      }

      updatePdfRef(restoredPdf);
      updateTotalPages(restoredTotalPages);

      const partById = new Map<string, string>();
      const newPartIdMap = new Map<string, string>();
      for (const p of parts) {
        partById.set(p.id, p.title);
        newPartIdMap.set(p.title, p.id);
      }
      setPartIdMap(newPartIdMap);

      const hasParts = parts.length > 0;
      const savedToc: TocChapter[] = chapters.map((ch, i) => {
        const pdfInfo = tocFromPdf[i];
        const dbLevel = ch.level;
        const dbStartPage = (ch as any).start_page || 0;
        const dbEndPage = (ch as any).end_page || 0;
        return {
          title: ch.title,
          startPage: dbStartPage || pdfInfo?.startPage || 0,
          endPage: dbEndPage || pdfInfo?.endPage || 0,
          level: dbLevel != null ? dbLevel : (pdfInfo?.level ?? (hasParts && ch.part_id ? 1 : 0)),
          partTitle: ch.part_id ? partById.get(ch.part_id) : undefined,
          sectionType: classifySection(ch.title),
        };
      });
      const normalizedSavedToc = normalizeLevels(savedToc);
      const normalizedRangedToc = normalizeTocRanges(
        normalizedSavedToc,
        restoredTotalPages > 0 ? restoredTotalPages : undefined,
      );
      setTocEntries(normalizedRangedToc);

      const newChapterIdMap = new Map<number, string>();
      chapters.forEach((ch, i) => newChapterIdMap.set(i, ch.id));
      setChapterIdMap(newChapterIdMap);

      const allChapterIds = chapters.map(c => c.id);
      const { data: allScenes } = await supabase
        .from('book_scenes')
        .select('id, chapter_id, scene_number, title, content, scene_type, mood, bpm')
        .in('chapter_id', allChapterIds)
        .order('scene_number');

      const scenesByChapter = new Map<string, Scene[]>();
      for (const s of (allScenes || [])) {
        const list = scenesByChapter.get(s.chapter_id) || [];
        list.push({
          id: s.id, scene_number: s.scene_number, title: s.title,
          content: s.content || undefined,
          content_preview: (s.content || '').slice(0, 200) || undefined,
          scene_type: s.scene_type || "mixed", mood: s.mood || "neutral", bpm: s.bpm || 120,
          char_count: (s.content || '').length,
        });
        scenesByChapter.set(s.chapter_id, list);
      }

      const normalizedToc = normalizedRangedToc;
      const initRawMap = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
      chapters.forEach((ch, i) => {
        const scenes = isFolderNode(normalizedToc, i) ? [] : (scenesByChapter.get(ch.id) || []);
        initRawMap.set(i, { scenes, status: scenes.length > 0 ? "done" : "pending" });
      });
      const initMap = sanitizeChapterResultsForStructure(normalizedToc, initRawMap);
      setChapterResults(initMap);
      setStep("workspace");

      // ── Sync server data to local OPFS ──
      let targetStorage = projectStorage?.isReady ? projectStorage : null;
      if (!targetStorage && storageBackend === "opfs" && createProject && userId) {
        try {
          const projectTitle = book.title || stripFileExtension(book.file_name);
          const lang = isRu ? "ru" as const : "en" as const;
          targetStorage = await createProject(projectTitle, book.id, userId, lang);
          console.log("[OpenBook] Auto-created OPFS project for server book:", projectTitle);
        } catch (err) {
          console.warn("[OpenBook] Failed to auto-create OPFS project:", err);
        }
      }

      if (targetStorage) {
        syncStructureToLocal(targetStorage, {
          bookId: book.id,
          title: book.title || stripFileExtension(book.file_name),
          fileName: book.file_name,
          toc: normalizedToc,
          parts: parts.map(p => ({ id: p.id, title: p.title, partNumber: p.part_number })),
          chapterIdMap: newChapterIdMap,
          chapterResults: initMap,
        });

        if (pdfBlob && targetStorage) {
          const sourcePath = getSourcePath(bookFormat);
          targetStorage.writeBlob(sourcePath, pdfBlob).catch(err =>
            console.warn("[OpenBook] Failed to save source file to local project:", err)
          );
        }

        if (targetStorage && isBookDocx) {
          try {
            const projMeta = await targetStorage.readJSON<Record<string, unknown>>("project.json");
            if (projMeta) {
              projMeta.fileFormat = "docx";
              await targetStorage.writeJSON("project.json", projMeta);
            }
          } catch {}
        }
      }

      const pdfStatus = restoredPdf
        ? ` (${t("pdfRestored", isRu)})`
        : ` (${t("pdfNotFound", isRu)})`;
      toast.success(`${t("bookLoaded", isRu)}: «${book.title}»` + pdfStatus);
    } catch (err: any) {
      console.error("Failed to open book:", err);
      setErrorMsg(err.message || "Unknown error");
      setStep("error");
    }
  }, [userId, isRu, projectStorage, storageBackend, createProject, restoreFromLocal, updatePdfRef, updateTotalPages,
      setStep, setFileName, setBookId, setTocEntries, setChapterIdMap, setPartIdMap, setChapterResults, setErrorMsg]);

  // ─── Ensure PDF is loaded (local-first, then server) ────────
  const ensurePdfLoaded = useCallback(async (): Promise<any> => {
    if (pdfRef) return pdfRef;
    if (!bookId) return null;

    let format: FileFormat = "pdf";
    if (projectStorage?.isReady) {
      try {
        const meta = await projectStorage.readJSON<Record<string, unknown>>("project.json");
        if (meta?.fileFormat === "docx") format = "docx";
      } catch {}
    }
    if (format === "pdf" && fileName && detectFileFormat(fileName) === "docx") {
      format = "docx";
    }

    if (format === "docx") {
      console.log("[EnsureSource] DOCX book — PDF proxy not needed");
      return null;
    }

    const loadPdf = async (arrayBuffer: ArrayBuffer) => {
      const { getDocument } = await import("pdfjs-dist");
      const pdf = await getDocument({ data: arrayBuffer }).promise;
      updatePdfRef(pdf);
      updateTotalPages(pdf.numPages);
      return pdf;
    };

    // 1. Try local project first
    if (projectStorage?.isReady) {
      try {
        const localBlob = await projectStorage.readBlob(getSourcePath("pdf"));
        if (localBlob) {
          console.log("[EnsurePDF] Loading from local project");
          return await loadPdf(await localBlob.arrayBuffer());
        }
      } catch (err) {
        console.warn("[EnsurePDF] Local read failed:", err);
      }
    }

    // 2. Fallback: query file_path from DB
    let filePath: string | null = null;
    const bookInState = books.find(b => b.id === bookId);
    if (bookInState?.file_path) {
      filePath = bookInState.file_path;
    } else {
      try {
        const { data } = await supabase
          .from("books")
          .select("file_path")
          .eq("id", bookId)
          .maybeSingle();
        filePath = data?.file_path || null;
      } catch (err) {
        console.warn("[EnsurePDF] DB lookup failed:", err);
      }
    }

    if (!filePath) {
      console.warn("[EnsurePDF] No file_path found for book", bookId);
      return null;
    }

    try {
      console.log("[EnsurePDF] Downloading from server");
      const { data: blob } = await supabase.storage.from('book-uploads').download(filePath);
      if (!blob) return null;
      const pdf = await loadPdf(await blob.arrayBuffer());

      // Cache locally for next time
      if (projectStorage?.isReady) {
        projectStorage.writeBlob(getSourcePath("pdf"), blob).catch(() => {});
      }
      return pdf;
    } catch (err) {
      console.warn("[EnsurePDF] Server download failed:", err);
      return null;
    }
  }, [pdfRef, bookId, books, projectStorage, fileName, updatePdfRef, updateTotalPages]);

  return {
    pdfRef,
    totalPages,
    restoreFromLocal,
    openSavedBook,
    ensurePdfLoaded,
  };
}
