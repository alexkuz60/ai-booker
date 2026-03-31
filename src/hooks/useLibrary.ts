/**
 * useLibrary — manages the book library listing (local-first from OPFS).
 * Reads only project.json per-project, no server calls on library load.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { BookRecord } from "@/pages/parser/types";
import { OPFSStorage, type ProjectStorage, type PipelineProgress } from "@/lib/projectStorage";
import type { LocalBookStructure } from "@/lib/localSync";
import { detectFileFormat } from "@/lib/fileFormatUtils";
import { getProjectActivityMs } from "@/lib/projectActivity";
import { paths } from "@/lib/projectPaths";
import { readPipelineProgress } from "@/hooks/usePipelineProgress";

const OPFS_NON_PROJECT_DIRS = new Set(["atmo-cache", "ir-cache", "sfx-cache"]);
const NESTED_TRANSLATION_SUFFIX_RE = /_(EN|RU)_(EN|RU)$/i;
const LANG_SUFFIX_RE = /_(EN|RU)$/i;

function isNestedTranslationMirrorMeta(meta: Record<string, unknown> | null): boolean {
  const source = typeof meta?.sourceProjectName === "string" ? meta.sourceProjectName : "";
  return !!source && LANG_SUFFIX_RE.test(source);
}

type LocalLibraryCandidate = {
  record: BookRecord;
  projectName: string;
  dedupeKey: string;
  progress: PipelineProgress;
};

interface UseLibraryParams {
  userId: string | undefined;
  storageBackend: "fs-access" | "opfs" | "none";
  projectStorage?: ProjectStorage | null;
  step: string;
}

export function useLibrary({ userId, storageBackend, projectStorage, step }: UseLibraryParams) {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [localProjectNamesByBookId, setLocalProjectNamesByBookId] = useState<Map<string, string[]>>(new Map());
  const [progressMap, setProgressMap] = useState<Record<string, PipelineProgress>>({});
  const libraryLoadedRef = useRef(false);

  // Server books (separate section)
  const [serverBooks, setServerBooks] = useState<BookRecord[]>([]);
  const [loadingServerBooks, setLoadingServerBooks] = useState(false);
  const serverBooksLoadedRef = useRef(false);

  const mapLocalStructureToBook = useCallback(async (storage: ProjectStorage): Promise<LocalLibraryCandidate | null> => {
    const meta = await storage.readJSON<{
      bookId?: string;
      title?: string;
      createdAt?: string;
      updatedAt?: string;
      language?: string;
      fileFormat?: string;
      sourceProjectName?: string;
      targetLanguage?: string;
    }>("project.json");

    // Skip mirror translation projects — they are not independent books
    if (meta?.sourceProjectName || meta?.targetLanguage) return null;

    const needStructure = !meta?.bookId || !meta?.title || !meta?.fileFormat;
    const structure = needStructure
      ? await storage.readJSON<LocalBookStructure>("structure/toc.json").catch(() => null)
      : null;

    const resolvedId = meta?.bookId || structure?.bookId;
    if (!resolvedId) return null;

    const resolvedTitle = meta?.title || structure?.title || storage.projectName;
    const resolvedFormat = meta?.fileFormat || detectFileFormat(structure?.fileName || resolvedTitle);
    const resolvedFileName = structure?.fileName || `${resolvedTitle}.${resolvedFormat}`;
    const activityMs = await getProjectActivityMs(storage);
    const resolvedUpdatedAt = activityMs > 0
      ? new Date(activityMs).toISOString()
      : meta?.updatedAt || structure?.updatedAt || meta?.createdAt || new Date(0).toISOString();
    const dedupeKey = `book:${resolvedId}`;

    // Read pipeline progress alongside metadata
    const progress = await readPipelineProgress(storage);

    return {
      record: {
        id: resolvedId,
        title: resolvedTitle,
        file_name: resolvedFileName,
        file_path: null,
        status: "local",
        created_at: resolvedUpdatedAt,
        updated_at: resolvedUpdatedAt,
        chapter_count: 0,
        scene_count: 0,
        file_format: resolvedFormat as "pdf" | "docx" | "fb2",
      },
      projectName: storage.projectName,
      dedupeKey,
      progress,
    };
  }, []);

  const loadLocalLibrary = useCallback(async (): Promise<BookRecord[]> => {
    const getTs = (value: string) => {
      const ts = new Date(value).getTime();
      return Number.isFinite(ts) ? ts : 0;
    };

    if (storageBackend === "opfs") {
      const allProjectNames = await OPFSStorage.listProjects();
      const projectNames = allProjectNames.filter((name) => !OPFS_NON_PROJECT_DIRS.has(name));

      const scanResults = await Promise.all(projectNames.map(async (projectName) => {
        try {
          if (NESTED_TRANSLATION_SUFFIX_RE.test(projectName)) {
            return { candidate: null as LocalLibraryCandidate | null, shouldDelete: true, projectName };
          }

          const store = await OPFSStorage.openExisting(projectName);
          if (!store) {
            return { candidate: null as LocalLibraryCandidate | null, shouldDelete: false, projectName };
          }
          const meta = await store.readJSON<Record<string, unknown>>("project.json").catch(() => null);

          if (isNestedTranslationMirrorMeta(meta)) {
            return { candidate: null as LocalLibraryCandidate | null, shouldDelete: true, projectName };
          }

          // Skip translation mirror projects — they share bookId but are independent
          if (meta && ((meta as any).targetLanguage || (meta as any).sourceProjectName)) {
            return { candidate: null as LocalLibraryCandidate | null, shouldDelete: false, projectName };
          }

          const result = await mapLocalStructureToBook(store);
          if (!result) {
            const toc = await store.readJSON<Record<string, unknown>>("structure/toc.json").catch(() => null);
            const hasBookId = typeof (meta as any)?.bookId === "string" || typeof (toc as any)?.bookId === "string";
            return { candidate: null as LocalLibraryCandidate | null, shouldDelete: !hasBookId, projectName };
          }
          return { candidate: result, shouldDelete: false, projectName };
        } catch (err) {
          console.warn("[Library] Failed to read project:", projectName, err);
          return { candidate: null as LocalLibraryCandidate | null, shouldDelete: false, projectName };
        }
      }));

      const staleProjects = Array.from(
        new Set(scanResults.filter((r) => r.shouldDelete).map((r) => r.projectName)),
      );
      if (staleProjects.length > 0) {
        await Promise.all(staleProjects.map((name) => OPFSStorage.deleteProject(name).catch(() => {})));
      }

      const candidates = scanResults
        .map((r) => r.candidate)
        .filter((v): v is LocalLibraryCandidate => !!v);

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
      const pMap: Record<string, PipelineProgress> = {};
      const dedupedBooks = Array.from(byDedupeKey.values()).map((candidate) => {
        const allProjects = projectsByDedupeKey.get(candidate.dedupeKey) || [candidate.projectName];
        localIndex.set(candidate.record.id, allProjects);
        pMap[candidate.record.id] = candidate.progress;

        // ── Diagnostic: warn about duplicate OPFS folders for the same bookId ──
        if (allProjects.length > 1) {
          console.warn(
            `[Library] ⚠️ DUPLICATE OPFS folders for bookId=${candidate.record.id}: [${allProjects.join(", ")}]. ` +
            `This can cause content swap bugs. The freshest folder will be used.`
          );
        }

        return candidate.record;
      });

      setLocalProjectNamesByBookId(localIndex);
      setProgressMap(pMap);
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
        updated_at: b.updated_at || undefined,
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
  }, [loadLibraryFromServer]);

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

  // Load server books — NO filtering, show all for cleanup/audit
  const loadServerBooks = useCallback(async () => {
    if (!userId) { setServerBooks([]); return; }
    setLoadingServerBooks(true);
    try {
      const fromServer = await loadLibraryFromServer();
      setServerBooks(fromServer);
    } catch (err) {
      console.warn("[Library] Server books fetch failed:", err);
      setServerBooks([]);
      // Allow retry on next effect cycle if fetch failed
      serverBooksLoadedRef.current = false;
    } finally {
      setLoadingServerBooks(false);
    }
  }, [userId, loadLibraryFromServer]);

  // Auto-load when on library step
  useEffect(() => {
    if (!userId) {
      setBooks([]);
      setLoadingLibrary(false);
      libraryLoadedRef.current = false;
      serverBooksLoadedRef.current = false;
      return;
    }

    const shouldLoadLibrary = step === "library" || step === "workspace";

    if (!shouldLoadLibrary) {
      libraryLoadedRef.current = false;
      serverBooksLoadedRef.current = false;
      return;
    }

    if (!libraryLoadedRef.current) {
      libraryLoadedRef.current = true;
      void loadLibrary();
    }
  }, [userId, step, storageBackend, loadLibrary]);

  // Auto-load server books after local library is ready
  useEffect(() => {
    const shouldLoadLibrary = step === "library" || step === "workspace";
    if (!userId || !shouldLoadLibrary || loadingLibrary) return;
    if (!serverBooksLoadedRef.current) {
      serverBooksLoadedRef.current = true;
      void loadServerBooks();
    }
  }, [userId, step, loadingLibrary, loadServerBooks]);

  const renameBook = useCallback(async (bookId: string, newTitle: string) => {
    if (storageBackend !== "opfs") return;

    // Find the project name(s) for this book
    const projectNames = localProjectNamesByBookId.get(bookId);
    if (!projectNames?.length) return;

    // Update project.json in all matching OPFS projects
    for (const projectName of projectNames) {
      try {
        const store = await OPFSStorage.openExisting(projectName);
        if (!store) continue;
        const meta = await store.readJSON<Record<string, unknown>>(paths.projectMeta());
        if (meta) {
          meta.title = newTitle;
          meta.updatedAt = new Date().toISOString();
          await store.writeJSON(paths.projectMeta(), meta);
        }
        // Also update toc.json title
        const toc = await store.readJSON<Record<string, unknown>>(paths.structureToc()).catch(() => null);
        if (toc) {
          toc.title = newTitle;
          await store.writeJSON(paths.structureToc(), toc);
        }
      } catch (err) {
        console.warn("[Library] Rename failed for project:", projectName, err);
      }
    }

    // Update in-memory state
    setBooks(prev => prev.map(b => b.id === bookId ? { ...b, title: newTitle } : b));
  }, [storageBackend, localProjectNamesByBookId]);

  return {
    books,
    loadingLibrary,
    localProjectNamesByBookId,
    progressMap,
    setProgressMap,
    loadLibrary,
    loadLibraryFromServer,
    loadBookFromServerById,
    renameBook,
    serverBooks,
    loadingServerBooks,
    loadServerBooks,
  };
}
