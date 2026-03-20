/**
 * useFileUpload — handles PDF/DOCX file selection and TOC extraction.
 * Writes ONLY to local OPFS — NO database writes.
 * IDs are generated locally via crypto.randomUUID().
 */

import { setChapterTextsCache, setDocxHtmlCache, clearChapterTextsCache, getChapterTextFromCache } from "@/lib/chapterTextsCache";

import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  extractOutline, extractTocFromText, flattenTocWithRanges,
  mergeOutlineWithTextToc, type TocEntry,
} from "@/lib/pdf-extract";
import { extractFromDocx } from "@/lib/docx-extract";
import { extractFromFb2 } from "@/lib/fb2-extract";
import { t } from "@/pages/parser/i18n";
import type { Scene, TocChapter, Step, ChapterStatus } from "@/pages/parser/types";
import { classifySection, normalizeLevels, ACTIVE_BOOK_KEY } from "@/pages/parser/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import { syncStructureToLocal } from "@/lib/localSync";
import { isFolderNode, normalizeTocRanges, sanitizeChapterResultsForStructure } from "@/lib/tocStructure";
import { stripFileExtension } from "@/lib/fileFormatUtils";

/** Map flat TOC entries to TocChapter[] with part assignment */
export function mapFlatToChapters(
  flat: { title: string; level: number; startPage: number; endPage: number; children: any[] }[],
): TocChapter[] {
  const mapped: TocChapter[] = [];
  let currentPart = "";
  for (let i = 0; i < flat.length; i++) {
    const entry = flat[i];
    const sectionType = classifySection(entry.title);
    const hasNested = entry.children.length > 0 || (i + 1 < flat.length && flat[i + 1].level > entry.level);
    if (entry.level === 0 && sectionType === "content" && hasNested) {
      currentPart = entry.title;
    }
    mapped.push({
      title: entry.title,
      startPage: entry.startPage,
      endPage: entry.endPage,
      level: entry.level,
      partTitle: entry.level > 0 ? (currentPart || undefined) : undefined,
      sectionType,
    });
  }
  return mapped;
}

interface UseFileUploadParams {
  userId: string | undefined;
  isRu: boolean;
  storageBackend: "fs-access" | "opfs" | "none";
  projectStorage?: ProjectStorage | null;
  createProject?: (title: string, bookId: string, userId: string, language: "ru" | "en") => Promise<ProjectStorage>;
  bookId: string | null;
  /** User-provided project name (from the UI input) */
  pendingProjectName?: string | null;
  setStep: (s: Step) => void;
  setFileName: (s: string) => void;
  setBookId: (id: string | null) => void;
  setTocEntries: React.Dispatch<React.SetStateAction<TocChapter[]>>;
  setChapterIdMap: React.Dispatch<React.SetStateAction<Map<number, string>>>;
  setPartIdMap: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  setChapterResults: React.Dispatch<React.SetStateAction<Map<number, { scenes: Scene[]; status: ChapterStatus }>>>;
  setPdfRef: React.Dispatch<React.SetStateAction<any>>;
  setTotalPages: React.Dispatch<React.SetStateAction<number>>;
  setFile: React.Dispatch<React.SetStateAction<File | null>>;
  setErrorMsg: React.Dispatch<React.SetStateAction<string>>;
}

export function useFileUpload({
  userId, isRu, storageBackend, projectStorage, createProject, bookId, pendingProjectName,
  setStep, setFileName, setBookId, setTocEntries, setChapterIdMap,
  setPartIdMap, setChapterResults, setPdfRef, setTotalPages, setFile, setErrorMsg,
}: UseFileUploadParams) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<{ step: number; totalSteps: number; message: string } | null>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!userId || !f) return;

    const ext = f.name.toLowerCase().split('.').pop() || '';
    const isDocx = ext === 'docx' || ext === 'doc';
    const isPdf = ext === 'pdf';
    const isFb2 = ext === 'fb2';

    if (!isPdf && !isDocx && !isFb2) {
      toast.error(t("onlySupported", isRu));
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error(t("maxSize", isRu));
      return;
    }

    // К4: Clear stale runtime data from previous uploads to prevent cross-book contamination
    clearChapterTextsCache();
    sessionStorage.removeItem(ACTIVE_BOOK_KEY);

    setBookId(null);
    setPdfRef(null);
    setTotalPages(0);
    setTocEntries([]);
    setChapterIdMap(new Map());
    setPartIdMap(new Map());
    setChapterResults(new Map());
    setFileName(f.name);
    setFile(f);
    setStep("extracting_toc");
    setErrorMsg("");
    const totalSteps = 4;
    const progress = (step: number, msgRu: string, msgEn: string) =>
      setUploadProgress({ step, totalSteps, message: isRu ? msgRu : msgEn });
    progress(1, "Извлечение структуры документа...", "Extracting document structure...");

    try {
      let chapters: TocChapter[] = [];
      let localTotalPages = 1;

      if (isDocx || isFb2) {
        // Unified path for DOCX and FB2 — both return the same shape
        const extractResult = isDocx
          ? await extractFromDocx(f)
          : await extractFromFb2(f);

        setPdfRef(null);
        localTotalPages = extractResult.totalPages;
        setTotalPages(localTotalPages);

        if (extractResult.outline.length > 0) {
          const flat = flattenTocWithRanges(extractResult.outline, localTotalPages);
          chapters = mapFlatToChapters(flat);
          const formatLabel = isFb2 ? "FB2" : "DOCX";
          toast.success(`${formatLabel} TOC: ${chapters.length} ${t("items", isRu)}`);
        } else {
          toast.info(t("docxNoToc", isRu));
          chapters = [{
            title: stripFileExtension(f.name),
            startPage: 1,
            endPage: localTotalPages,
            level: 0,
            sectionType: "content",
          }];
        }

        // К4: store in memory only, never in sessionStorage
        setChapterTextsCache(extractResult.chapterTexts);
        setDocxHtmlCache(extractResult.html);
      } else {
        const { outline, pdf } = await extractOutline(f);
        setPdfRef(pdf);
        localTotalPages = pdf.numPages;
        setTotalPages(localTotalPages);

        if (outline.length > 0) {
          const textToc = await extractTocFromText(pdf);
          const merged = mergeOutlineWithTextToc(outline, textToc);
          const flat = flattenTocWithRanges(merged, localTotalPages);
          chapters = mapFlatToChapters(flat);
          const extra = merged.length - outline.length;
          if (extra > 0) {
            toast.success(
              isRu
                ? `Оглавление: ${chapters.length} записей (${extra} найдено в тексте)`
                : `TOC: ${chapters.length} entries (${extra} found in text)`
            );
          } else {
            toast.success(`${t("tocFound", isRu)}: ${chapters.length} ${t("items", isRu)}`);
          }
        } else {
          const textToc = await extractTocFromText(pdf);
          if (textToc.length > 0) {
            const flat = flattenTocWithRanges(textToc, localTotalPages);
            chapters = mapFlatToChapters(flat);
            toast.success(`${isRu ? "Найдены заголовки глав в тексте" : "Chapter headings found in text"}: ${chapters.length} ${t("items", isRu)}`);
          } else {
            toast.info(t("tocNotFound", isRu));
            chapters = [{
              title: stripFileExtension(f.name),
              startPage: 1,
              endPage: localTotalPages,
              level: 0,
              sectionType: "content",
            }];
          }
        }
      }

      chapters = normalizeTocRanges(normalizeLevels(chapters), localTotalPages);
      setTocEntries(chapters);
      progress(2, "Создание структуры...", "Creating structure...");

      // ── Generate all IDs locally — NO database writes ──
      const isReload = !!bookId;
      const resolvedBookId = isReload ? bookId! : crypto.randomUUID();
      setBookId(resolvedBookId);
      sessionStorage.setItem(ACTIVE_BOOK_KEY, resolvedBookId);

      const uniqueParts = [...new Set(chapters.map(c => c.partTitle).filter(Boolean))] as string[];
      const newPartIdMap = new Map<string, string>();
      for (const title of uniqueParts) {
        newPartIdMap.set(title, crypto.randomUUID());
      }
      setPartIdMap(newPartIdMap);

      const newChapterIdMap = new Map<number, string>();
      for (let i = 0; i < chapters.length; i++) {
        newChapterIdMap.set(i, crypto.randomUUID());
      }
      setChapterIdMap(newChapterIdMap);

      // ── Init chapter results ──
      const initRawMap = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
      chapters.forEach((_, i) => initRawMap.set(i, { scenes: [], status: "pending" }));

      // Mark folder-nodes as done immediately
      chapters.forEach((_, i) => {
        if (isFolderNode(chapters, i)) {
          initRawMap.set(i, { scenes: [], status: "done" });
        }
      });

      // For DOCX/FB2: pre-mark chapters with no/minimal content as done
      if (isDocx || isFb2) {
        // К4: read from in-memory cache, not sessionStorage
        for (let i = 0; i < chapters.length; i++) {
          const html = getChapterTextFromCache(i) || "";
          const plain = html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
          if (plain.length < 50) {
            initRawMap.set(i, { scenes: [], status: "done" });
          }
        }
      }

      const initMap = sanitizeChapterResultsForStructure(chapters, initRawMap);
      setChapterResults(initMap);

      // ── Save to OPFS only (non-fatal — upload succeeds even if storage fails) ──
      progress(3, "Сохранение в локальное хранилище...", "Saving to local storage...");
      try {
        let targetStorage: ProjectStorage | null = isReload ? (projectStorage ?? null) : null;

        // Auto-create OPFS project if no storage is open yet
        if (!targetStorage && createProject && (storageBackend === "opfs" || storageBackend === "fs-access")) {
          try {
            targetStorage = await createProject(
              pendingProjectName || stripFileExtension(f.name),
              resolvedBookId,
              userId,
              isRu ? "ru" : "en",
            );
          } catch (storageErr) {
            console.warn("[Upload] Failed to auto-create local project:", storageErr);
          }
        }

        if (targetStorage && resolvedBookId) {
          const partsArr = uniqueParts.map((title, i) => ({
            id: newPartIdMap.get(title) || "",
            title,
            partNumber: i + 1,
          }));

          const existingMeta = await targetStorage.readJSON<Record<string, unknown>>("project.json").catch(() => null);
          await targetStorage.writeJSON("project.json", {
            version: Number(existingMeta?.version) || 1,
            bookId: resolvedBookId,
            title: pendingProjectName || stripFileExtension(f.name),
            userId,
            createdAt: typeof existingMeta?.createdAt === "string" ? existingMeta.createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            language: (existingMeta?.language === "en" ? "en" : (isRu ? "ru" : "en")),
            fileFormat: isFb2 ? "fb2" : (isDocx ? "docx" : "pdf"),
          });

          await syncStructureToLocal(targetStorage, {
            bookId: resolvedBookId,
            title: pendingProjectName || stripFileExtension(f.name),
            fileName: f.name,
            toc: chapters,
            parts: partsArr,
            chapterIdMap: newChapterIdMap,
            chapterResults: initMap,
          });

          const localSourceName = isFb2 ? "source/book.fb2" : (isDocx ? "source/book.docx" : "source/book.pdf");
          await targetStorage.writeBlob(localSourceName, f).catch(() => {});
        }
      } catch (storageErr) {
        console.warn("[Upload] Local storage save failed (non-fatal):", storageErr);
      }

      progress(4, "Готово!", "Done!");
      setStep("workspace");
      setUploadProgress(null);
    } catch (err: any) {
      console.error("Parser error:", err);
      const msg = err.message || "Unknown error";
      let userErr: string;
      if (/402|payment|credits/i.test(msg)) userErr = t("errPayment", isRu);
      else if (/429|rate.?limit/i.test(msg)) userErr = t("errRateLimit", isRu);
      else if (/timeout|timed?\s?out/i.test(msg)) userErr = t("errTimeout", isRu);
      else if (/api.?key/i.test(msg)) userErr = t("errNoApiKey", isRu);
      else if (/fetch|network/i.test(msg)) userErr = t("errNetwork", isRu);
      else userErr = msg;
      setErrorMsg(userErr);
      setStep("error");
      setUploadProgress(null);
      toast.error(userErr, { duration: Infinity });
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [userId, isRu, projectStorage, storageBackend, createProject, bookId, pendingProjectName,
      setStep, setFileName, setBookId, setTocEntries, setChapterIdMap,
      setPartIdMap, setChapterResults, setPdfRef, setTotalPages, setFile, setErrorMsg]);

  return { handleFileSelect, fileInputRef, uploadProgress };
}
