import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  extractOutline, extractTocFromText, flattenTocWithRanges, mergeOutlineWithTextToc, type TocEntry
} from "@/lib/pdf-extract";
import { extractFromDocx } from "@/lib/docx-extract";
import { t } from "@/pages/parser/i18n";
import type {
  Scene, TocChapter, Step, ChapterStatus, BookRecord,
} from "@/pages/parser/types";
import { classifySection, normalizeLevels, ACTIVE_BOOK_KEY } from "@/pages/parser/types";
import { OPFSStorage, type ProjectStorage } from "@/lib/projectStorage";
import { syncStructureToLocal, readStructureFromLocal, readCharactersFromLocal, type LocalBookStructure } from "@/lib/localSync";
import { isFolderNode, normalizeTocRanges, sanitizeChapterResultsForStructure } from "@/lib/tocStructure";


interface UseBookManagerParams {
  userId: string | undefined;
  isRu: boolean;
  /** Optional local project storage for dual-write */
  projectStorage?: ProjectStorage | null;
  /** Whether project storage bootstrap finished (important for OPFS startup flow) */
  projectStorageInitialized?: boolean;
  /** Storage backend type — needed to know if we should wait for storage init */
  storageBackend?: "fs-access" | "opfs" | "none";
  /** Create a new local project (for auto-creating OPFS from server data) */
  createProject?: (title: string, bookId: string, userId: string, language: "ru" | "en") => Promise<import("@/lib/projectStorage").ProjectStorage>;
}

const BROWSER_ID_KEY = "booker_browser_id";
const SERVER_SYNC_PREFIX = "booker_server_sync_checked";

function getOrCreateBrowserId(): string {
  try {
    const existing = localStorage.getItem(BROWSER_ID_KEY);
    if (existing) return existing;
    const nextId = crypto?.randomUUID?.() || `browser_${Date.now()}`;
    localStorage.setItem(BROWSER_ID_KEY, nextId);
    return nextId;
  } catch {
    return "browser_fallback";
  }
}

function getSyncCheckKey(bookId: string): string {
  return `${SERVER_SYNC_PREFIX}:${bookId}`;
}

export function useBookManager({ userId, isRu, projectStorage, projectStorageInitialized = false, storageBackend = "none", createProject }: UseBookManagerParams) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(() =>
    sessionStorage.getItem(ACTIVE_BOOK_KEY) ? "extracting_toc" : "library"
  );
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [fileName, setFileName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [bookId, setBookId] = useState<string | null>(null);

  const [partIdMap, setPartIdMap] = useState<Map<string, string>>(new Map());
  const [chapterIdMap, setChapterIdMap] = useState<Map<number, string>>(new Map());

  const [tocEntries, setTocEntries] = useState<TocChapter[]>([]);
  const [pdfRef, setPdfRef] = useState<any>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [file, setFile] = useState<File | null>(null);

  const [chapterResults, setChapterResults] = useState<Map<number, { scenes: Scene[]; status: ChapterStatus }>>(new Map());
  const [localProjectNamesByBookId, setLocalProjectNamesByBookId] = useState<Map<string, string[]>>(new Map());

  type LocalLibraryCandidate = {
    record: BookRecord;
    projectName: string;
    dedupeKey: string;
  };

  // ─── Library: Local-first list — reads ONLY project.json (B9 fix) ──────────
  const mapLocalStructureToBook = useCallback(async (storage: ProjectStorage): Promise<LocalLibraryCandidate | null> => {
    const meta = await storage.readJSON<{
      bookId?: string;
      title?: string;
      createdAt?: string;
      updatedAt?: string;
      language?: string;
      fileFormat?: string;
    }>("project.json");

    if (!meta || !meta.bookId) return null;

    const resolvedId = meta.bookId;
    const resolvedTitle = meta.title || storage.projectName;
    const resolvedFileName = `${resolvedTitle}.${meta.fileFormat === "docx" ? "docx" : "pdf"}`;
    const resolvedCreatedAt = meta.updatedAt || meta.createdAt || new Date(0).toISOString();
    const dedupeKey = `book:${resolvedId}`;

    return {
      record: {
        id: resolvedId,
        title: resolvedTitle,
        file_name: resolvedFileName,
        file_path: null,
        status: "local",
        created_at: resolvedCreatedAt,
        chapter_count: 0, // not reading toc.json for library list
        scene_count: 0,
      },
      projectName: storage.projectName,
      dedupeKey,
    };
  }, []);

  const loadLocalLibrary = useCallback(async (): Promise<BookRecord[]> => {
    const getTs = (value: string) => {
      const ts = new Date(value).getTime();
      return Number.isFinite(ts) ? ts : 0;
    };

    if (storageBackend === "opfs") {
      const projectNames = await OPFSStorage.listProjects();
      const candidatesRaw = await Promise.all(projectNames.map(async (projectName) => {
        const store = await OPFSStorage.openOrCreate(projectName);
        return mapLocalStructureToBook(store);
      }));
      const candidates = candidatesRaw.filter((v): v is LocalLibraryCandidate => !!v);

      const byDedupeKey = new Map<string, LocalLibraryCandidate>();
      const projectsByDedupeKey = new Map<string, string[]>();

      for (const candidate of candidates) {
        const existingProjects = projectsByDedupeKey.get(candidate.dedupeKey) || [];
        existingProjects.push(candidate.projectName);
        projectsByDedupeKey.set(candidate.dedupeKey, existingProjects);

        const existing = byDedupeKey.get(candidate.dedupeKey);
        if (!existing || getTs(candidate.record.created_at) > getTs(existing.record.created_at)) {
          byDedupeKey.set(candidate.dedupeKey, candidate);
        }
      }

      const localIndex = new Map<string, string[]>();
      const dedupedBooks = Array.from(byDedupeKey.values()).map((candidate) => {
        localIndex.set(candidate.record.id, projectsByDedupeKey.get(candidate.dedupeKey) || [candidate.projectName]);
        return candidate.record;
      });

      setLocalProjectNamesByBookId(localIndex);
      return dedupedBooks.sort((a, b) => getTs(b.created_at) - getTs(a.created_at));
    }

    if (projectStorage?.isReady) {
      const current = await mapLocalStructureToBook(projectStorage);
      if (current) {
        setLocalProjectNamesByBookId(new Map([[current.record.id, [current.projectName]]]));
        return [current.record];
      }
    }

    setLocalProjectNamesByBookId(new Map());
    return [];
  }, [storageBackend, projectStorage, mapLocalStructureToBook]);

  const loadLibraryFromServer = useCallback(async (): Promise<BookRecord[]> => {
    if (!userId) return [];

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const rpcPromise = supabase.rpc("get_user_books_with_counts");
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Library RPC timeout")), 12000);
      });

      const { data, error } = await Promise.race([rpcPromise, timeoutPromise]) as {
        data: any[] | null;
        error: unknown;
      };

      if (error) throw error;
      return (data || []).map((b: any) => ({
        id: b.id,
        title: b.title,
        file_name: b.file_name,
        file_path: b.file_path,
        status: b.status,
        created_at: b.created_at,
        chapter_count: Number(b.chapter_count) || 0,
        scene_count: Number(b.scene_count) || 0,
      }));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }, [userId]);

  const loadBookFromServerById = useCallback(async (targetBookId: string): Promise<BookRecord | null> => {
    const fromRpc = await loadLibraryFromServer();
    const found = fromRpc.find((b) => b.id === targetBookId);
    if (found) return found;

    const { data, error } = await supabase
      .from("books")
      .select("id, title, file_name, file_path, status, created_at")
      .eq("id", targetBookId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: data.id,
      title: data.title,
      file_name: data.file_name,
      file_path: data.file_path,
      status: data.status,
      created_at: data.created_at,
      chapter_count: 0,
      scene_count: 0,
    };
  }, [loadLibraryFromServer, userId]);

  // B9 fix: Library loads ONLY from local OPFS, no server requests
  const loadLibrary = useCallback(async () => {
    if (!userId) {
      setBooks([]);
      setLoadingLibrary(false);
      return;
    }

    setLoadingLibrary(true);
    try {
      const localBooks = await loadLocalLibrary().catch((err) => {
        console.warn("[Library] Local fetch failed:", err);
        return [] as BookRecord[];
      });
      setBooks(localBooks);
    } catch (err) {
      console.error("Failed to load library:", err);
      setBooks([]);
    } finally {
      setLoadingLibrary(false);
    }
  }, [userId, loadLocalLibrary]);

  const libraryLoadedRef = useRef(false);
  useEffect(() => {
    if (!userId) {
      setBooks([]);
      setLoadingLibrary(false);
      libraryLoadedRef.current = false;
      return;
    }

    if (step !== "library") {
      // Reset so returning to library reloads
      libraryLoadedRef.current = false;
      return;
    }

    if (!libraryLoadedRef.current) {
      libraryLoadedRef.current = true;
      void loadLibrary();
    }
  }, [userId, step, loadLibrary]);

  // ─── Auto-restore active book on mount ─────────────────────
  // ─── Restore from local ProjectStorage ─────────────────────
  const restoreFromLocal = useCallback(async (savedBookId: string): Promise<boolean> => {
    if (!projectStorage?.isReady) return false;
    try {
      const local = await readStructureFromLocal(projectStorage);
      if (!local?.structure || local.structure.bookId !== savedBookId) return false;
      // Note: characters are loaded independently by useParserCharacters when bookId changes

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

      // Normalize legacy local data immediately (remove folder scene files)
      void syncStructureToLocal(projectStorage, {
        bookId: savedBookId,
        title: structure.title,
        fileName: structure.fileName,
        toc: normalizedToc,
        parts: structure.parts,
        chapterIdMap: localChIdMap,
        chapterResults: sanitizedLocalResults,
      });

      // ── Restore PDF from local project (async, non-blocking) ──
      projectStorage.readBlob("source/book.pdf").then(async (pdfBlob) => {
        if (!pdfBlob) {
          console.log("[LocalRestore] No local PDF found, will download on demand");
          return;
        }
        try {
          const arrayBuffer = await pdfBlob.arrayBuffer();
          const { getDocument } = await import("pdfjs-dist");
          const pdf = await getDocument({ data: arrayBuffer }).promise;
          setPdfRef(pdf);
          setTotalPages(pdf.numPages);
          console.log(`[LocalRestore] PDF restored locally: ${pdf.numPages} pages`);
        } catch (pdfErr) {
          console.warn("[LocalRestore] Failed to parse local PDF:", pdfErr);
        }
      });

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
  }, [projectStorage, isRu]);

  // ─── Sync-check: server vs local timestamps ────────────────
  const [serverNewerBookId, setServerNewerBookId] = useState<string | null>(null);

  const shouldRunServerSyncCheck = useCallback((targetBookId: string): boolean => {
    try {
      const browserId = getOrCreateBrowserId();
      const lastCheckedBrowserId = localStorage.getItem(getSyncCheckKey(targetBookId));
      return lastCheckedBrowserId !== browserId;
    } catch {
      return false;
    }
  }, []);

  const markServerSyncChecked = useCallback((targetBookId: string) => {
    try {
      localStorage.setItem(getSyncCheckKey(targetBookId), getOrCreateBrowserId());
    } catch {
      // non-critical
    }
  }, []);

  const checkServerNewer = useCallback(async (
    savedBookId: string,
    options?: { allowMissingLocalTimestamp?: boolean },
  ): Promise<boolean> => {
    const allowMissingLocalTimestamp = options?.allowMissingLocalTimestamp || false;

    try {
      // Try project.json first, fall back to structure/toc.json
      let localUpdatedAt: string | undefined;
      if (projectStorage?.isReady) {
        const localMeta = await projectStorage.readJSON<{ updatedAt?: string }>("project.json");
        localUpdatedAt = localMeta?.updatedAt;
        if (!localUpdatedAt) {
          const tocMeta = await projectStorage.readJSON<{ updatedAt?: string }>("structure/toc.json");
          localUpdatedAt = tocMeta?.updatedAt;
        }
      }

      const { data } = await supabase
        .from("books")
        .select("updated_at")
        .eq("id", savedBookId)
        .maybeSingle();

      if (!data?.updated_at) return false;
      if (!localUpdatedAt) return allowMissingLocalTimestamp;

      const localTime = new Date(localUpdatedAt).getTime();
      const serverTime = new Date(data.updated_at).getTime();
      const TOLERANCE_MS = 2000;

      if (serverTime > localTime + TOLERANCE_MS) {
        console.log(`[SyncCheck] Server is newer: server=${data.updated_at} local=${localUpdatedAt}`);
        return true;
      }
      return false;
    } catch (err) {
      console.warn("[SyncCheck] Failed:", err);
      return false;
    }
  }, [projectStorage]);

  const dismissServerNewer = useCallback(() => setServerNewerBookId(null), []);

  // B12 fix: acceptServerVersion forces full local replacement with server data
  const acceptServerVersion = useCallback(async () => {
    if (!serverNewerBookId) return;
    const targetBookId = serverNewerBookId;
    setServerNewerBookId(null);

    // Delete existing local project to force server download path in openSavedBook
    if (storageBackend === "opfs") {
      const projectNames = localProjectNamesByBookId.get(targetBookId) || [];
      for (const pn of projectNames) {
        try {
          await OPFSStorage.deleteProject(pn);
          console.log(`[AcceptServer] Deleted local OPFS project: ${pn}`);
        } catch (err) {
          console.warn(`[AcceptServer] Failed to delete OPFS project ${pn}:`, err);
        }
      }
    }

    const book = await loadBookFromServerById(targetBookId);
    if (book) {
      // skipTimestampCheck: we already know server is newer
      await openSavedBookRef.current?.(book, { skipTimestampCheck: true });
    }
  }, [serverNewerBookId, loadBookFromServerById, storageBackend, localProjectNamesByBookId]);

  // ─── Auto-restore active book on mount (local-first) ───────
  const [restoredOnce, setRestoredOnce] = useState(false);
  const openSavedBookRef = useRef<(book: BookRecord, options?: { skipTimestampCheck?: boolean }) => Promise<void>>();

  useEffect(() => {
    if (restoredOnce || !userId || loadingLibrary) return;
    const savedBookId = sessionStorage.getItem(ACTIVE_BOOK_KEY);
    if (!savedBookId) {
      if (step === "extracting_toc") setStep("library");
      setRestoredOnce(true);
      return;
    }

    // Для OPFS: ждем завершения bootstrap, но не блокируемся вечно при отсутствии проекта.
    if (storageBackend === "opfs" && !projectStorageInitialized) {
      // Не ставим restoredOnce — эффект перезапустится после завершения инициализации хранилища
      return;
    }

    setRestoredOnce(true);

    restoreFromLocal(savedBookId).then(async (restored) => {
      const shouldSyncWithServer = shouldRunServerSyncCheck(savedBookId);

      if (restored) {
        if (shouldSyncWithServer) {
          const isNewer = await checkServerNewer(savedBookId);
          markServerSyncChecked(savedBookId);
          if (isNewer) {
            setServerNewerBookId(savedBookId);
          }
        }
        return;
      }

      // Strict local-first: do not load from server unless this browser hasn't performed sync-check yet.
      if (!shouldSyncWithServer) {
        setStep("library");
        return;
      }

      const isServerNewerForThisBrowser = await checkServerNewer(savedBookId, { allowMissingLocalTimestamp: true });
      markServerSyncChecked(savedBookId);
      if (!isServerNewerForThisBrowser) {
        setStep("library");
        return;
      }

      const book = await loadBookFromServerById(savedBookId);
      if (book) {
        await openSavedBookRef.current?.(book, { skipTimestampCheck: true });
      } else {
        sessionStorage.removeItem(ACTIVE_BOOK_KEY);
        setStep("library");
      }
    });
  }, [
    userId,
    loadingLibrary,
    restoredOnce,
    restoreFromLocal,
    checkServerNewer,
    storageBackend,
    projectStorageInitialized,
    shouldRunServerSyncCheck,
    markServerSyncChecked,
    loadBookFromServerById,
    step,
  ]);

  // ─── Open saved book (local-first + server timestamp check) ────────────────
  const openSavedBook = useCallback(async (book: BookRecord, options?: { skipTimestampCheck?: boolean }) => {
    if (!userId) return;

    if (projectStorage?.isReady) {
      const restored = await restoreFromLocal(book.id);
      if (restored) {
        // B10 fix: always check server timestamp after successful local restore
        if (!options?.skipTimestampCheck) {
          const isNewer = await checkServerNewer(book.id);
          if (isNewer) {
            setServerNewerBookId(book.id);
          }
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

      let restoredPdf: any = null;
      let restoredTotalPages = 0;
      let tocFromPdf: { startPage: number; endPage: number; level: number }[] = [];

      if (pdfBlob) {
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
      }

      setPdfRef(restoredPdf);
      setTotalPages(restoredTotalPages);

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
        // Prefer DB-stored pages, fallback to PDF outline
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

      // B13 fix: removed upsert rangeFixes — no DB writes during read operation

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

      // ── Dual-write: sync to local project (auto-create OPFS if needed) ──
      let targetStorage = projectStorage?.isReady ? projectStorage : null;

      if (!targetStorage && storageBackend === "opfs" && createProject && userId) {
        try {
          const projectTitle = book.title || book.file_name.replace('.pdf', '');
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
          title: book.title || book.file_name.replace('.pdf', ''),
          fileName: book.file_name,
          toc: normalizedToc,
          parts: parts.map(p => ({ id: p.id, title: p.title, partNumber: p.part_number })),
          chapterIdMap: newChapterIdMap,
          chapterResults: initMap,
        });

        // Save PDF to local project if downloaded from server
        if (pdfBlob && targetStorage) {
          targetStorage.writeBlob("source/book.pdf", pdfBlob).catch(err =>
            console.warn("[OpenBook] Failed to save PDF to local project:", err)
          );
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
  }, [userId, isRu, projectStorage, storageBackend, createProject, restoreFromLocal, checkServerNewer]);

  // Keep ref in sync for auto-restore effect
  openSavedBookRef.current = openSavedBook;

  // ─── Delete book ──────────────────────────────────────────
  const deleteBook = useCallback(async (delBookId: string) => {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(delBookId);

    try {
      const localProjects = localProjectNamesByBookId.get(delBookId) || [];
      if (storageBackend === "opfs" && localProjects.length > 0) {
        await Promise.all(localProjects.map((projectName) => OPFSStorage.deleteProject(projectName)));
      }

      if (isUuid) {
        const { error } = await supabase.from("books").delete().eq("id", delBookId);
        if (error) throw error;
      }

      if (bookId === delBookId) {
        sessionStorage.removeItem(ACTIVE_BOOK_KEY);
        setStep("library");
        setBookId(null);
      }

      await loadLibrary();
      toast.success(t("bookDeleted", isRu));
    } catch (err) {
      console.error("Failed to delete book:", err);
      toast.error(t("bookDeleteFailed", isRu));
    }
  }, [isRu, storageBackend, localProjectNamesByBookId, bookId, loadLibrary]);

  // ─── Helper: flat TOC → TocChapter[] ─────────────────────
  const mapFlatToChapters = (
    flat: { title: string; level: number; startPage: number; endPage: number; children: TocEntry[] }[],
  ): TocChapter[] => {
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
  };

  // ─── File Upload & TOC Extraction ──────────────────────────
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!userId) return;
    if (!f) return;

    const ext = f.name.toLowerCase().split('.').pop() || '';
    const isDocx = ext === 'docx' || ext === 'doc';
    const isPdf = ext === 'pdf';

    if (!isPdf && !isDocx) {
      toast.error(t("onlySupported", isRu));
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error(t("maxSize", isRu));
      return;
    }

    setFileName(f.name);
    setFile(f);
    setStep("extracting_toc");
    setErrorMsg("");

    try {
      let chapters: TocChapter[] = [];

      let localTotalPages = 1;

      if (isDocx) {
        // ── DOCX path ──
        const docxResult = await extractFromDocx(f);
        setPdfRef(null); // no PDF proxy for DOCX
        localTotalPages = docxResult.totalPages;
        setTotalPages(localTotalPages);

        if (docxResult.outline.length > 0) {
          const flat = flattenTocWithRanges(docxResult.outline, localTotalPages);
          chapters = mapFlatToChapters(flat);
          const headingBased = docxResult.html.includes('<h1') || docxResult.html.includes('<h2');
          const msgKey = headingBased ? "docxTocFromHeadings" : "docxTocFromRegex";
          toast.success(`${t(msgKey, isRu)}: ${chapters.length} ${t("items", isRu)}`);
        } else {
          toast.info(t("docxNoToc", isRu));
          chapters = [{
            title: f.name.replace(/\.(docx?|pdf)$/i, ''),
            startPage: 1,
            endPage: localTotalPages,
            level: 0,
            sectionType: "content",
          }];
        }

        // Store DOCX data for later chapter text extraction
        sessionStorage.setItem("docx_chapter_texts", JSON.stringify(
          Array.from(docxResult.chapterTexts.entries())
        ));
        sessionStorage.setItem("docx_html", docxResult.html);
      } else {
        // ── PDF path (existing) ──
        const { outline, pdf } = await extractOutline(f);
        setPdfRef(pdf);
        localTotalPages = pdf.numPages;
        setTotalPages(localTotalPages);

        if (outline.length > 0) {
          // Always also scan text for headings to catch entries missing from outline
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
              title: f.name.replace('.pdf', ''),
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

      // B1/B6 fix: if bookId already exists (reload flow), UPDATE instead of INSERT
      const isReload = !!bookId;
      const filePath = isPdf ? `${userId}/${Date.now()}_${f.name}` : null;

      if (!isReload) {
        // Fresh upload — clean up previous uploads of the same file name
        const { data: existingBooks } = await supabase
          .from('books')
          .select('id, file_path')
          .eq('user_id', userId)
          .eq('file_name', f.name);
        if (existingBooks?.length) {
          const oldPaths = existingBooks.map(b => b.file_path).filter(Boolean) as string[];
          if (oldPaths.length) {
            await supabase.storage.from('book-uploads').remove(oldPaths);
          }
          const oldIds = existingBooks.map(b => b.id);
          await supabase.from('book_chapters').delete().in('book_id', oldIds);
          await supabase.from('book_parts').delete().in('book_id', oldIds);
          await supabase.from('books').delete().in('id', oldIds);
        }
      }

      if (isPdf && filePath) {
        await supabase.storage.from('book-uploads').upload(filePath, f);
      }

      let resolvedBookId: string;
      if (isReload) {
        // UPDATE existing book record
        const { error: updErr } = await supabase
          .from('books')
          .update({
            title: f.name.replace(/\.(pdf|docx?)$/i, ''),
            file_name: f.name,
            file_path: isPdf ? filePath : null,
            status: 'uploaded',
            updated_at: new Date().toISOString(),
          })
          .eq('id', bookId);
        if (updErr) throw updErr;
        resolvedBookId = bookId;
      } else {
        // INSERT new book
        const { data: book, error: bookErr } = await supabase
          .from('books')
          .insert({ user_id: userId, title: f.name.replace(/\.(pdf|docx?)$/i, ''), file_name: f.name, file_path: isPdf ? filePath : null, status: 'uploaded' })
          .select('id').single();
        if (bookErr) throw bookErr;
        resolvedBookId = book.id;
      }
      setBookId(resolvedBookId);
      sessionStorage.setItem(ACTIVE_BOOK_KEY, resolvedBookId);

      // Add default characters: Narrator and Commentator (only for fresh uploads)
      if (!isReload) {
        await supabase.from('book_characters').insert([
          {
            book_id: resolvedBookId,
            name: isRu ? 'Рассказчик' : 'Narrator',
            gender: 'male',
            age_group: 'adult',
            description: isRu ? 'Голос повествования от третьего лица' : 'Third-person narration voice',
            sort_order: -2,
            voice_config: { provider: 'yandex' },
          },
          {
            book_id: resolvedBookId,
            name: isRu ? 'Комментатор' : 'Commentator',
            gender: 'male',
            age_group: 'adult',
            description: isRu ? 'Озвучивание сносок и комментариев' : 'Footnote and commentary voice',
            sort_order: -1,
            voice_config: { provider: 'yandex' },
          },
        ]);
      }

      const uniqueParts = [...new Set(chapters.map(c => c.partTitle).filter(Boolean))] as string[];
      const newPartIdMap = new Map<string, string>();
      for (let i = 0; i < uniqueParts.length; i++) {
        const { data: partRow } = await supabase
          .from('book_parts').insert({ book_id: resolvedBookId, part_number: i + 1, title: uniqueParts[i] })
          .select('id').single();
        if (partRow) newPartIdMap.set(uniqueParts[i], partRow.id);
      }
      setPartIdMap(newPartIdMap);

      const newChapterIdMap = new Map<number, string>();
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        const partId = ch.partTitle ? newPartIdMap.get(ch.partTitle) : null;
        const { data: chRow } = await supabase
          .from('book_chapters')
          .insert({
            book_id: book.id, chapter_number: i + 1, title: ch.title,
            scene_type: ch.sectionType !== 'content' ? ch.sectionType : null,
            level: ch.level,
            start_page: ch.startPage,
            end_page: ch.endPage,
            ...(partId ? { part_id: partId } : {}),
          })
          .select('id').single();
        if (chRow) newChapterIdMap.set(i, chRow.id);
      }
      setChapterIdMap(newChapterIdMap);

      const initRawMap = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
      chapters.forEach((_, i) => initRawMap.set(i, { scenes: [], status: "pending" }));

      // For DOCX: pre-mark chapters with no/minimal content as "done" (nothing to analyze)
      if (isDocx) {
        try {
          const raw = sessionStorage.getItem("docx_chapter_texts");
          if (raw) {
            const entries: [number, string][] = JSON.parse(raw);
            const chapterTextMap = new Map(entries);
            for (let i = 0; i < chapters.length; i++) {
              const html = chapterTextMap.get(i) || "";
              const plain = html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
              if (plain.length < 50) {
                initRawMap.set(i, { scenes: [], status: "done" });
              }
            }
          }
        } catch {}
      }

      const initMap = sanitizeChapterResultsForStructure(chapters, initRawMap);
      setChapterResults(initMap);

      // ── Dual-write: sync to local project ──
      if (projectStorage?.isReady && book?.id) {
        const partsArr = uniqueParts.map((title, i) => ({
          id: newPartIdMap.get(title) || "",
          title,
          partNumber: i + 1,
        }));
        syncStructureToLocal(projectStorage, {
          bookId: book.id,
          title: f.name.replace(/\.(pdf|docx?)$/i, ''),
          fileName: f.name,
          toc: chapters,
          parts: partsArr,
          chapterIdMap: newChapterIdMap,
          chapterResults: initMap,
        });
        // Save the source file locally
        const localSourceName = isDocx ? "source/book.docx" : "source/book.pdf";
        projectStorage.writeBlob(localSourceName, f).catch(() => {});
      }

      setStep("workspace");
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
      toast.error(userErr, { duration: 8000 });
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [userId, isRu, projectStorage]);

  // ─── Reload book (delete structure, re-upload new PDF) ─────
  // B1/B6 fix: reloadBook preserves bookId, clears sessionStorage (B3)
  const reloadBook = useCallback(async () => {
    if (!bookId) return;
    try {
      // B3: clear DOCX session data
      sessionStorage.removeItem("docx_chapter_texts");
      sessionStorage.removeItem("docx_html");

      // Delete scenes, chapters, parts for this book
      const { data: chapters } = await supabase
        .from('book_chapters').select('id').eq('book_id', bookId);
      if (chapters?.length) {
        const chapterIds = chapters.map(c => c.id);
        await supabase.from('book_scenes').delete().in('chapter_id', chapterIds);
      }
      await supabase.from('book_chapters').delete().eq('book_id', bookId);
      await supabase.from('book_parts').delete().eq('book_id', bookId);

      // Clean up local OPFS project(s) — remove structure/ and scenes/ only, keep project.json and source/
      if (storageBackend === "opfs") {
        const projectNames = localProjectNamesByBookId.get(bookId);
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

      // Reset state but keep bookId for re-association (B1/B6 fix)
      setPartIdMap(new Map()); setChapterIdMap(new Map());
      setTocEntries([]); setPdfRef(null); setFile(null);
      setChapterResults(new Map());
      setStep("upload");
      toast.info(isRu ? "Выберите новый файл для перезагрузки книги" : "Select a new file to reload the book");
    } catch (err) {
      console.error("Failed to reload book:", err);
      toast.error(isRu ? "Не удалось очистить данные книги" : "Failed to clear book data");
    }
  }, [bookId, isRu, storageBackend, localProjectNamesByBookId, projectStorage]);

  // ─── Ensure PDF is loaded (local-first, then server) ────────
  const ensurePdfLoaded = useCallback(async (): Promise<any> => {
    if (pdfRef) return pdfRef;
    if (!bookId) return null;

    const loadPdf = async (arrayBuffer: ArrayBuffer) => {
      const { getDocument } = await import("pdfjs-dist");
      const pdf = await getDocument({ data: arrayBuffer }).promise;
      setPdfRef(pdf);
      setTotalPages(pdf.numPages);
      return pdf;
    };

    // 1. Try local project first
    if (projectStorage?.isReady) {
      try {
        const localBlob = await projectStorage.readBlob("source/book.pdf");
        if (localBlob) {
          console.log("[EnsurePDF] Loading from local project");
          return await loadPdf(await localBlob.arrayBuffer());
        }
      } catch (err) {
        console.warn("[EnsurePDF] Local read failed:", err);
      }
    }

    // 2. Fallback: query file_path from DB directly (books state may be empty on restore)
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
        projectStorage.writeBlob("source/book.pdf", blob).catch(() => {});
      }
      return pdf;
    } catch (err) {
      console.warn("[EnsurePDF] Server download failed:", err);
      return null;
    }
  }, [pdfRef, bookId, books, projectStorage]);

  // ─── Reset ─────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setStep("library");
    sessionStorage.removeItem(ACTIVE_BOOK_KEY);
    setFileName(""); setErrorMsg(""); setBookId(null);
    setPartIdMap(new Map()); setChapterIdMap(new Map());
    setTocEntries([]); setPdfRef(null); setFile(null);
    setChapterResults(new Map());
  }, []);

  return {
    // State
    step, setStep, books, loadingLibrary, fileName, errorMsg, bookId,
    partIdMap, chapterIdMap, setChapterIdMap, tocEntries, setTocEntries, pdfRef, totalPages, file,
    chapterResults, setChapterResults, fileInputRef,
    // Actions
    openSavedBook, deleteBook, handleFileSelect, handleReset, reloadBook, ensurePdfLoaded,
    reloadLibrary: loadLibrary,
    // Sync-check
    serverNewerBookId, dismissServerNewer, acceptServerVersion,
  };
}
