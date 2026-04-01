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
  resolveTranslationMirrorProjectName,
  writePersistedTranslationMirrorProjectName,
} from "@/lib/translationMirrorResolver";

const TAG = "[useTranslationStorage]";
const RESOLUTION_RETRY_DELAYS_MS = [120, 320, 700, 1500, 2500] as const;

/** In-memory cache: sourceProjectName → resolved translation project name */
const resolvedCache = new Map<string, string>();

interface ResolvedTranslationStore {
  store: ProjectStorage;
  projectName: string;
  via: "cache" | "direct-candidate" | "full-scan";
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
    const backlink = sourceMeta.translationProject?.projectName;
    const preferredTargetLanguage = sourceMeta.language === "en" ? "ru" : "en";
    const fallbackTargetLanguage = preferredTargetLanguage === "en" ? "ru" : "en";
    const persistedProjectName = readPersistedTranslationMirrorProjectName({
      sourceBookId,
      sourceProjectName: sourceKey,
    });
    const directCandidates = Array.from(
      new Set(
        [
          persistedProjectName,
          ...buildTranslationMirrorNames(sourceKey, preferredTargetLanguage, backlink),
          ...buildTranslationMirrorNames(sourceKey, fallbackTargetLanguage),
        ].filter((name): name is string => !!name && name !== sourceKey),
      ),
    );

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

          // ── 2. Direct open by exact canonical mirror names ──
          // This bypasses metadata reads and even OPFS listing when the folder name
          // is known, which is more robust on cold browser restores.
          for (const candidateName of directCandidates) {
            const store = await tryOpenByName(candidateName);
            if (store) {
              return { store, projectName: candidateName, via: "direct-candidate" };
            }
          }

          // ── 3. Full resolver scan (fallback for legacy / renamed mirrors) ──
          const projects = await OPFSStorage.listProjects();
          console.info(TAG, "full scan, OPFS projects:", projects.length, "source:", sourceKey);

          const resolvedProjectName = await resolveTranslationMirrorProjectName({
            projects,
            sourceStorage,
            sourceMeta,
          });
          console.info(TAG, "resolved:", resolvedProjectName);

          if (!resolvedProjectName) return null;

          const store = await tryOpenByName(resolvedProjectName);
          if (!store) return null;

          return { store, projectName: resolvedProjectName, via: "full-scan" };
        };

        for (let attempt = 0; attempt <= RESOLUTION_RETRY_DELAYS_MS.length; attempt += 1) {
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

          if (attempt < RESOLUTION_RETRY_DELAYS_MS.length) {
            await wait(RESOLUTION_RETRY_DELAYS_MS[attempt]);
            if (cancelled) return;
          }
        }

        // No project found (don't cache negative result to avoid sticky false-negatives
        // when OPFS metadata is temporarily unreadable during startup contention).
        console.warn(TAG, "no translation project found for:", sourceKey, {
          backlink,
          directCandidates,
          persistedProjectName,
        });
        if (!cancelled && mountedRef.current) {
          setTranslationStorage(null);
          setExists(false);
        }
      } catch (err) {
        console.error(TAG, "resolution error:", err);
        if (!cancelled && mountedRef.current) {
          setTranslationStorage(null);
          setExists(false);
        }
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sourceStorage, sourceMeta, tick]);

  return { translationStorage, exists, loading, refresh };
}
