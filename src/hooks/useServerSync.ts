/**
 * useServerSync — handles server vs local timestamp comparison
 * and "accept server version" flow for cross-device sync.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { OPFSStorage, type ProjectStorage } from "@/lib/projectStorage";
import type { BookRecord } from "@/pages/parser/types";

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

interface UseServerSyncParams {
  projectStorage?: ProjectStorage | null;
  storageBackend: "fs-access" | "opfs" | "none";
  localProjectNamesByBookId: Map<string, string[]>;
  loadBookFromServerById: (bookId: string) => Promise<BookRecord | null>;
  /** Ref-based: updated by orchestrator after openSavedBook is created */
  openSavedBookRef: React.MutableRefObject<
    ((book: BookRecord, options?: { skipTimestampCheck?: boolean }) => Promise<void>) | undefined
  >;
}

export function useServerSync({
  projectStorage,
  storageBackend,
  localProjectNamesByBookId,
  loadBookFromServerById,
  openSavedBookRef,
}: UseServerSyncParams) {
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
    } catch {}
  }, []);

  const checkServerNewer = useCallback(async (
    savedBookId: string,
    options?: { allowMissingLocalTimestamp?: boolean },
  ): Promise<boolean> => {
    const allowMissingLocalTimestamp = options?.allowMissingLocalTimestamp || false;

    try {
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
    const targetBookId = serverNewerBookId;
    setServerNewerBookId(null);

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
      await openSavedBookRef.current?.(book, { skipTimestampCheck: true });
    }
  }, [serverNewerBookId, loadBookFromServerById, storageBackend, localProjectNamesByBookId, openSavedBookRef]);

  return {
    serverNewerBookId,
    setServerNewerBookId,
    dismissServerNewer,
    acceptServerVersion,
    checkServerNewer,
    shouldRunServerSyncCheck,
    markServerSyncChecked,
  };
}
