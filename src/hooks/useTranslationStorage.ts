/**
 * useTranslationStorage — opens the mirror OPFS translation project
 * alongside the source project, providing read/write access to translated data.
 *
 * Resolution priority:
 * 1. Backlink: sourceMeta.translationProject.projectName (trusted, no full scan)
 * 2. Full resolver scan (fallback when backlink is missing)
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { OPFSStorage } from "@/lib/projectStorage";
import type { ProjectStorage, ProjectMeta } from "@/lib/projectStorage";
import {
  buildTranslationMirrorNames,
  readPersistedTranslationMirrorProjectName,
  writePersistedTranslationMirrorProjectName,
} from "@/lib/translationMirrorResolver";

const TAG = "[useTranslationStorage]";
const OPEN_RETRY_DELAYS_MS = [120, 420] as const;
const BACKGROUND_RETRY_DELAY_MS = 1800;

/** In-memory cache: sourceProjectName → resolved translation project name */
const resolvedCache = new Map<string, string>();

interface ResolvedTranslationStore {
  store: ProjectStorage;
  projectName: string;
  via: "cache" | "trusted-link";
}

interface UseTranslationStorageReturn {
  /** Translation project storage (null if not created yet) */
  translationStorage: ProjectStorage | null;
  /** Whether translation project exists */
  exists: boolean;
  /** Loading state */
  loading: boolean;
  /** Refresh / re-check existence */
  refresh: () => void;
}

/**
 * Try to open a translation project by its exact name.
 * Returns the storage if the folder exists.
 *
 * IMPORTANT: do not hard-fail on missing/unreadable project.json here.
 * Under OPFS concurrent writes, metadata reads can transiently fail and must
 * not block opening an already linked mirror folder.
 */
async function tryOpenByName(projectName: string): Promise<ProjectStorage | null> {
  const store = await OPFSStorage.openExisting(projectName);
  return store;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTranslationExpected(
  sourceMeta: ProjectMeta,
  persistedProjectName: string | null,
): boolean {
  const progress = sourceMeta.pipelineProgress ?? {};
  return Boolean(
    sourceMeta.translationProject?.projectName
      || persistedProjectName
      || progress.trans_storage_created
      || progress.trans_migration_done,
  );
}

export function useTranslationStorage(
  sourceStorage: ProjectStorage | null,
  sourceMeta: ProjectMeta | null,
): UseTranslationStorageReturn {
  const [translationStorage, setTranslationStorage] = useState<ProjectStorage | null>(null);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    // Invalidate cache on manual refresh
    if (sourceStorage) resolvedCache.delete(sourceStorage.projectName);
    setTick((t) => t + 1);
  }, [sourceStorage]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!sourceStorage || !sourceMeta) {
      setTranslationStorage(null);
      setExists(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const sourceKey = sourceStorage.projectName;
    const sourceBookId = sourceMeta.bookId ?? null;
    const backlink = sourceMeta.translationProject?.projectName ?? null;
    const preferredTargetLanguage = sourceMeta.language === "en" ? "ru" : "en";
    const persistedProjectName = readPersistedTranslationMirrorProjectName({
      sourceBookId,
      sourceProjectName: sourceKey,
    });
    const translationExpected = isTranslationExpected(sourceMeta, persistedProjectName);
    const trustedCandidates = Array.from(
      new Set(
        [
          persistedProjectName,
          backlink,
          ...buildTranslationMirrorNames(sourceKey, preferredTargetLanguage, backlink),
        ].filter((name): name is string => !!name && name !== sourceKey),
      ),
    );

    setExists(translationExpected);

    (async () => {
      try {
        const resolveOnce = async (): Promise<ResolvedTranslationStore | null> => {
          // ── 1. Check in-memory cache ──
          const cached = resolvedCache.get(sourceKey);
          if (cached) {
            const store = await tryOpenByName(cached);
            if (store) {
              return { store, projectName: cached, via: "cache" };
            }
            // Cache stale — clear and continue
            resolvedCache.delete(sourceKey);
          }

          // ── 2. Trust the already-created mirror link/name and open it directly ──
          for (const candidateName of trustedCandidates) {
            const store = await tryOpenByName(candidateName);
            if (store) {
              return { store, projectName: candidateName, via: "trusted-link" };
            }
          }

          return null;
        };

        const maxAttempts = translationExpected ? OPEN_RETRY_DELAYS_MS.length + 1 : 1;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const resolved = await resolveOnce();
          if (cancelled) return;

          if (resolved && mountedRef.current) {
            console.info(TAG, `✅ opened via ${resolved.via}:`, resolved.projectName);
            resolvedCache.set(sourceKey, resolved.projectName);
            writePersistedTranslationMirrorProjectName({
              sourceBookId,
              sourceProjectName: sourceKey,
              translationProjectName: resolved.projectName,
            });
            setTranslationStorage(resolved.store);
            setExists(true);
            return;
          }

          if (attempt < OPEN_RETRY_DELAYS_MS.length) {
            await wait(OPEN_RETRY_DELAYS_MS[attempt]);
            if (cancelled) return;
          }
        }

        console.warn(TAG, "trusted translation project not opened for:", sourceKey, {
          backlink,
          trustedCandidates,
          persistedProjectName,
          translationExpected,
        });
        if (!cancelled && mountedRef.current) {
          setTranslationStorage(null);
          if (!translationExpected) setExists(false);
        }
      } catch (err) {
        console.error(TAG, "resolution error:", err);
        if (!cancelled && mountedRef.current) {
          setTranslationStorage(null);
          if (!translationExpected) setExists(false);
        }
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sourceStorage, sourceMeta, tick]);

  useEffect(() => {
    if (!sourceStorage || !sourceMeta || translationStorage || !exists) return;

    const handleFocus = () => refresh();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [sourceStorage, sourceMeta, translationStorage, exists, refresh]);

  useEffect(() => {
    if (!sourceStorage || !sourceMeta || translationStorage || !exists || loading) return;

    const retryId = window.setTimeout(() => {
      refresh();
    }, BACKGROUND_RETRY_DELAY_MS);

    return () => {
      window.clearTimeout(retryId);
    };
  }, [sourceStorage, sourceMeta, translationStorage, exists, loading, refresh]);

  return { translationStorage, exists, loading, refresh };
}
