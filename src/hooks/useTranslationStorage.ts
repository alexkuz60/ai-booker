/**
 * useTranslationStorage — opens the mirror OPFS translation project.
 *
 * Dead-simple logic:
 * 1. Build list of candidate names (persisted link, backlink, canonical suffixes)
 * 2. Try openExisting for each — OPFS open is instant, no retries needed
 * 3. If found → done. If not → exists=false.
 *
 * On tab re-focus: re-attempt once (covers edge case of concurrent creation).
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

/** In-memory cache: sourceProjectName → resolved translation project name */
const resolvedCache = new Map<string, string>();

interface UseTranslationStorageReturn {
  translationStorage: ProjectStorage | null;
  exists: boolean;
  loading: boolean;
  refresh: () => void;
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

function buildCandidates(
  sourceKey: string,
  sourceMeta: ProjectMeta,
  persistedProjectName: string | null,
): string[] {
  const backlink = sourceMeta.translationProject?.projectName ?? null;
  const targetLang = sourceMeta.language === "en" ? "ru" : "en";

  return Array.from(
    new Set(
      [
        resolvedCache.get(sourceKey),
        persistedProjectName,
        backlink,
        ...buildTranslationMirrorNames(sourceKey, targetLang, backlink),
      ].filter((n): n is string => !!n && n !== sourceKey),
    ),
  );
}

/** Try each candidate name once — openExisting is instant */
async function openFirstMatch(candidates: string[]): Promise<{ store: ProjectStorage; name: string } | null> {
  for (const name of candidates) {
    const store = await OPFSStorage.openExisting(name);
    if (store) return { store, name };
  }
  return null;
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
    if (sourceStorage) resolvedCache.delete(sourceStorage.projectName);
    setTick((t) => t + 1);
  }, [sourceStorage]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Main resolution: one-shot, no retries ──
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
    const persistedProjectName = readPersistedTranslationMirrorProjectName({
      sourceBookId,
      sourceProjectName: sourceKey,
    });
    const expected = isTranslationExpected(sourceMeta, persistedProjectName);
    const candidates = buildCandidates(sourceKey, sourceMeta, persistedProjectName);

    // Set exists optimistically if we expect it
    setExists(expected);

    (async () => {
      try {
        const result = await openFirstMatch(candidates);
        if (cancelled || !mountedRef.current) return;

        if (result) {
          console.info(TAG, "✅ opened:", result.name);
          resolvedCache.set(sourceKey, result.name);
          writePersistedTranslationMirrorProjectName({
            sourceBookId,
            sourceProjectName: sourceKey,
            translationProjectName: result.name,
          });
          setTranslationStorage(result.store);
          setExists(true);
        } else {
          console.warn(TAG, "not found for:", sourceKey, { candidates, expected });
          setTranslationStorage(null);
          if (!expected) setExists(false);
        }
      } catch (err) {
        console.error(TAG, "error:", err);
        if (!cancelled && mountedRef.current) {
          setTranslationStorage(null);
          if (!expected) setExists(false);
        }
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sourceStorage, sourceMeta, tick]);

  // ── Re-attempt on tab focus (covers creation in another tab / long inactivity) ──
  useEffect(() => {
    if (!sourceStorage || !sourceMeta || translationStorage || !exists) return;

    const handle = () => {
      if (document.visibilityState === "visible" || document.hasFocus()) {
        refresh();
      }
    };

    window.addEventListener("focus", handle);
    document.addEventListener("visibilitychange", handle);
    return () => {
      window.removeEventListener("focus", handle);
      document.removeEventListener("visibilitychange", handle);
    };
  }, [sourceStorage, sourceMeta, translationStorage, exists, refresh]);

  return { translationStorage, exists, loading, refresh };
}
