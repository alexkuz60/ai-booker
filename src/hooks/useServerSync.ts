/**
 * useServerSync — handles server vs local timestamp comparison
 * and "accept server version" flow for cross-device sync.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { BookRecord } from "@/pages/parser/types";
import type { SyncProgressCallback } from "@/components/SyncProgressDialog";
import { resolveLocalStorageForBook } from "@/lib/localProjectResolver";

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
    ((book: BookRecord, options?: { skipTimestampCheck?: boolean; downloadImpulses?: boolean; downloadAtmosphere?: boolean; downloadSfx?: boolean }, _c?: any, _s?: any, onProgress?: SyncProgressCallback) => Promise<void>) | undefined
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

  const getLocalStorageForBook = useCallback(async (targetBookId: string): Promise<ProjectStorage | null> => {
    return resolveLocalStorageForBook(targetBookId, {
      storageBackend,
      localProjectNamesByBookId,
      projectStorage,
    });
  }, [storageBackend, localProjectNamesByBookId, projectStorage]);

  const checkServerNewer = useCallback(async (
    savedBookId: string,
    options?: { allowMissingLocalTimestamp?: boolean },
  ): Promise<boolean> => {
    const allowMissingLocalTimestamp = options?.allowMissingLocalTimestamp || false;

    try {
      let localUpdatedAt: string | undefined;
      const localStorage = await getLocalStorageForBook(savedBookId);
      if (localStorage?.isReady) {
        const localMeta = await localStorage.readJSON<{ updatedAt?: string }>("project.json");
        localUpdatedAt = localMeta?.updatedAt;
        if (!localUpdatedAt) {
          const tocMeta = await localStorage.readJSON<{ updatedAt?: string }>("structure/toc.json");
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
  }, [getLocalStorageForBook]);

  const dismissServerNewer = useCallback(() => setServerNewerBookId(null), []);

  /**
   * Accept server version with optional progress reporting.
   * When onProgress is provided, the caller manages the SyncProgressDialog.
   */
  const acceptServerVersion = useCallback(async (onProgress?: SyncProgressCallback) => {
    if (!serverNewerBookId) return;
    const targetBookId = serverNewerBookId;
    setServerNewerBookId(null);

    const book = await loadBookFromServerById(targetBookId);
    if (book) {
      await openSavedBookRef.current?.(book, { skipTimestampCheck: true }, undefined, undefined, onProgress);
    }
  }, [serverNewerBookId, loadBookFromServerById, openSavedBookRef]);

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
