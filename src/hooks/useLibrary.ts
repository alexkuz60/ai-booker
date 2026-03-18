/**
 * useLibrary — manages the book library listing (local-first from OPFS).
 * Reads only project.json per-project, no server calls on library load.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { BookRecord } from "@/pages/parser/types";
import { OPFSStorage, type ProjectStorage } from "@/lib/projectStorage";
import type { LocalBookStructure } from "@/lib/localSync";
import { detectFileFormat } from "@/lib/fileFormatUtils";

type LocalLibraryCandidate = {
  record: BookRecord;
  projectName: string;
  dedupeKey: string;
};

interface UseLibraryParams {
  userId: string | undefined;
  storageBackend: "fs-access" | "opfs" | "none";
  projectStorage?: ProjectStorage | null;
  step: string;
}

export function useLibrary({ userId, storageBackend, projectStorage, step }: UseLibraryParams) {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [localProjectNamesByBookId, setLocalProjectNamesByBookId] = useState<Map<string, string[]>>(new Map());
  const libraryLoadedRef = useRef(false);

  const mapLocalStructureToBook = useCallback(async (storage: ProjectStorage): Promise<LocalLibraryCandidate | null> => {
    const meta = await storage.readJSON<{
      bookId?: string;
      title?: string;
      createdAt?: string;
      updatedAt?: string;
      language?: string;
      fileFormat?: string;
    }>("project.json");

    const needStructure = !meta?.bookId || !meta?.title || !meta?.fileFormat;
    const structure = needStructure
      ? await storage.readJSON<LocalBookStructure>("structure/toc.json").catch(() => null)
      : null;

    const resolvedId = meta?.bookId || structure?.bookId;
    if (!resolvedId) return null;

    const resolvedTitle = meta?.title || structure?.title || storage.projectName;
    const resolvedFormat = meta?.fileFormat || detectFileFormat(structure?.fileName || resolvedTitle);
    const resolvedFileName = structure?.fileName || `${resolvedTitle}.${resolvedFormat}`;
    const resolvedCreatedAt = meta?.updatedAt || structure?.updatedAt || meta?.createdAt || new Date(0).toISOString();
    const dedupeKey = `book:${resolvedId}`;

    return {
      record: {
        id: resolvedId,
        title: resolvedTitle,
        file_name: resolvedFileName,
        file_path: null,
        status: "local",
        created_at: resolvedCreatedAt,
        chapter_count: 0,
        scene_count: 0,
        file_format: resolvedFormat as "pdf" | "docx" | "fb2",
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

  // Auto-load when on library step
  useEffect(() => {
    if (!userId) {
      setBooks([]);
      setLoadingLibrary(false);
      libraryLoadedRef.current = false;
      return;
    }

    if (step !== "library") {
      libraryLoadedRef.current = false;
      return;
    }

    if (!libraryLoadedRef.current) {
      libraryLoadedRef.current = true;
      void loadLibrary();
    }
  }, [userId, step, loadLibrary]);

  const renameBook = useCallback(async (bookId: string, newTitle: string) => {
    if (storageBackend !== "opfs") return;

    // Find the project name(s) for this book
    const projectNames = localProjectNamesByBookId.get(bookId);
    if (!projectNames?.length) return;

    // Update project.json in all matching OPFS projects
    for (const projectName of projectNames) {
      try {
        const store = await OPFSStorage.openOrCreate(projectName);
        const meta = await store.readJSON<Record<string, unknown>>("project.json");
        if (meta) {
          meta.title = newTitle;
          meta.updatedAt = new Date().toISOString();
          await store.writeJSON("project.json", meta);
        }
        // Also update toc.json title
        const toc = await store.readJSON<Record<string, unknown>>("structure/toc.json").catch(() => null);
        if (toc) {
          toc.title = newTitle;
          await store.writeJSON("structure/toc.json", toc);
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
    loadLibrary,
    loadLibraryFromServer,
    loadBookFromServerById,
    renameBook,
  };
}
