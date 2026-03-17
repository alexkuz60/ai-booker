import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  extractOutline, extractTocFromText, flattenTocWithRanges, type TocEntry
} from "@/lib/pdf-extract";
import { extractFromDocx } from "@/lib/docx-extract";
import { t } from "@/pages/parser/i18n";
import type {
  Scene, TocChapter, Step, ChapterStatus, BookRecord,
} from "@/pages/parser/types";
import { classifySection, normalizeLevels, ACTIVE_BOOK_KEY } from "@/pages/parser/types";
import { OPFSStorage, type ProjectStorage } from "@/lib/projectStorage";
import { syncStructureToLocal, readStructureFromLocal, type LocalBookStructure } from "@/lib/localSync";
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

  // ─── Library: Local-first list with deterministic dedupe ──────────────────
  const mapLocalStructureToBook = useCallback(async (storage: ProjectStorage): Promise<LocalLibraryCandidate | null> => {
    const structure = await storage.readJSON<LocalBookStructure>("structure/toc.json");
    const meta = await storage.readJSON<{ bookId?: string; title?: string; createdAt?: string; updatedAt?: string }>("project.json");

    if (!structure && !meta) return null;

    const toc = structure?.toc || [];
    const chapterCount = toc.reduce((acc, _entry, idx) => acc + (isFolderNode(toc, idx) ? 0 : 1), 0);

    const resolvedId = structure?.bookId || meta?.bookId || `local:${storage.projectName}`;
    const resolvedTitle = structure?.title || meta?.title || storage.projectName;
    const resolvedFileName = structure?.fileName || `${resolvedTitle}.pdf`;
    const resolvedCreatedAt = structure?.updatedAt || meta?.updatedAt || meta?.createdAt || new Date(0).toISOString();
    const normalizedTitle = resolvedTitle.trim().toLowerCase();
    const dedupeKey = structure?.bookId || meta?.bookId
      ? `book:${resolvedId}`
      : `title:${normalizedTitle}`;

    return {
      record: {
        id: resolvedId,
        title: resolvedTitle,
        file_name: resolvedFileName,
        file_path: null,
        status: "local",
        created_at: resolvedCreatedAt,
        chapter_count: chapterCount,
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

  const loadLibrary = useCallback(async () => {
    if (!userId) {
      setBooks([]);
      setLoadingLibrary(false);
      return;
    }

    setLoadingLibrary(true);
    try {
      // Load local + server in parallel, merge once
      const [localBooks, serverBooks] = await Promise.all([
        loadLocalLibrary().catch((err) => {
          console.warn("[Library] Local fetch failed:", err);
          return [] as BookRecord[];
        }),
        loadLibraryFromServer().catch((err) => {
          console.warn("[Library] Server fetch failed:", err);
          return [] as BookRecord[];
        }),
      ]);

      // Merge: local takes priority, append server-only books
      const localIds = new Set(localBooks.map(b => b.id));
      const serverOnly = serverBooks.filter(sb => !localIds.has(sb.id));
      setBooks([...localBooks, ...serverOnly]);
    } catch (err) {
      console.error("Failed to load library:", err);
      setBooks([]);
    } finally {
      setLoadingLibrary(false);
    }
  }, [userId, loadLocalLibrary, loadLibraryFromServer]);

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

  const acceptServerVersion = useCallback(async () => {
    if (!serverNewerBookId) return;
    setServerNewerBookId(null);

    const book = await loadBookFromServerById(serverNewerBookId);
    if (book) {
      await openSavedBookRef.current?.(book);
    }
  }, [serverNewerBookId, loadBookFromServerById]);

  // ─── Auto-restore active book on mount (local-first) ───────
  const [restoredOnce, setRestoredOnce] = useState(false);
  const openSavedBookRef = useRef<(book: BookRecord) => Promise<void>>();

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
        await openSavedBookRef.current?.(book);
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

  // ─── Open saved book (local-first, server fallback) ───────────────────────
  const openSavedBook = useCallback(async (book: BookRecord) => {
    if (!userId) return;

    if (projectStorage?.isReady) {
      const restored = await restoreFromLocal(book.id);
      if (restored) return;
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

      const rangeFixes = chapters
        .map((ch, i) => {
          const next = normalizedRangedToc[i];
          if (!next) return null;
          const currentStart = Number((ch as any).start_page || 0);
          const currentEnd = Number((ch as any).end_page || 0);
          if (currentStart === next.startPage && currentEnd === next.endPage) return null;
          return {
            id: ch.id,
            book_id: book.id,
            start_page: next.startPage,
            end_page: next.endPage,
          };
        })
        .filter((v): v is { id: string; book_id: string; start_page: number; end_page: number } => !!v);

      if (rangeFixes.length > 0) {
        supabase.from('book_chapters').upsert(rangeFixes).then(({ error }) => {
          if (error) console.warn('[OpenBook] range normalization failed:', error);
        });
      }

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
  }, [userId, isRu, projectStorage, storageBackend, createProject, restoreFromLocal]);

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
          const flat = flattenTocWithRanges(outline, localTotalPages);
          chapters = mapFlatToChapters(flat);
          toast.success(`${t("tocFound", isRu)}: ${chapters.length} ${t("items", isRu)}`);
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

      // Clean up previous uploads of the same file name
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

      const filePath = isPdf ? `${userId}/${Date.now()}_${f.name}` : null;
      if (isPdf && filePath) {
        await supabase.storage.from('book-uploads').upload(filePath, f);
      }
      const { data: book, error: bookErr } = await supabase
        .from('books')
        .insert({ user_id: userId, title: f.name.replace(/\.(pdf|docx?)$/i, ''), file_name: f.name, file_path: isPdf ? filePath : null, status: 'uploaded' })
        .select('id').single();
      if (bookErr) throw bookErr;
      setBookId(book.id);
      sessionStorage.setItem(ACTIVE_BOOK_KEY, book.id);

      // Add default characters: Narrator and Commentator
      await supabase.from('book_characters').insert([
        {
          book_id: book.id,
          name: isRu ? 'Рассказчик' : 'Narrator',
          gender: 'male',
          age_group: 'adult',
          description: isRu ? 'Голос повествования от третьего лица' : 'Third-person narration voice',
          sort_order: -2,
          voice_config: { provider: 'yandex' },
        },
        {
          book_id: book.id,
          name: isRu ? 'Комментатор' : 'Commentator',
          gender: 'male',
          age_group: 'adult',
          description: isRu ? 'Озвучивание сносок и комментариев' : 'Footnote and commentary voice',
          sort_order: -1,
          voice_config: { provider: 'yandex' },
        },
      ]);

      const uniqueParts = [...new Set(chapters.map(c => c.partTitle).filter(Boolean))] as string[];
      const newPartIdMap = new Map<string, string>();
      for (let i = 0; i < uniqueParts.length; i++) {
        const { data: partRow } = await supabase
          .from('book_parts').insert({ book_id: book.id, part_number: i + 1, title: uniqueParts[i] })
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
  const reloadBook = useCallback(async () => {
    if (!bookId) return;
    try {
      // Delete scenes, chapters, parts for this book
      const { data: chapters } = await supabase
        .from('book_chapters').select('id').eq('book_id', bookId);
      if (chapters?.length) {
        const chapterIds = chapters.map(c => c.id);
        await supabase.from('book_scenes').delete().in('chapter_id', chapterIds);
      }
      await supabase.from('book_chapters').delete().eq('book_id', bookId);
      await supabase.from('book_parts').delete().eq('book_id', bookId);

      // Clean up local OPFS project(s) for this book
      if (storageBackend === "opfs") {
        const projectNames = localProjectNamesByBookId.get(bookId);
        if (projectNames?.length) {
          for (const name of projectNames) {
            try { await OPFSStorage.deleteProject(name); } catch {}
          }
        }
      } else if (projectStorage?.isReady) {
        // FS Access: clear structure files but keep project dir
        try {
          await projectStorage.writeJSON("structure/toc.json", []);
          await projectStorage.writeJSON("structure/characters.json", []);
        } catch {}
      }

      // Reset state but keep bookId for re-association
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
