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
import { resolveTranslationMirrorProjectName } from "@/lib/translationMirrorResolver";

const TAG = "[useTranslationStorage]";

/** In-memory cache: sourceProjectName → resolved translation project name */
const resolvedCache = new Map<string, string | null>();

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
 * Returns the storage if the folder exists AND contains a valid project.json.
 */
async function tryOpenByName(projectName: string): Promise<ProjectStorage | null> {
  const store = await OPFSStorage.openExisting(projectName);
  if (!store) {
    console.warn(TAG, "folder missing for backlink:", projectName);
    return null;
  }
  const meta = await store.readJSON<ProjectMeta>("project.json").catch((err) => {
    console.warn(TAG, "project.json read error in", projectName, err);
    return null;
  });
  if (!meta) {
    console.warn(TAG, "project.json absent in", projectName, "— zombie folder");
    return null;
  }
  return store;
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
      return;
    }

    let cancelled = false;
    setLoading(true);

    const sourceKey = sourceStorage.projectName;

    (async () => {
      try {
        // ── 1. Check in-memory cache ──
        if (resolvedCache.has(sourceKey)) {
          const cached = resolvedCache.get(sourceKey)!;
          if (cached) {
            const store = await tryOpenByName(cached);
            if (store && !cancelled && mountedRef.current) {
              console.info(TAG, "✅ opened from cache:", cached);
              setTranslationStorage(store);
              setExists(true);
              return;
            }
            // Cache stale — clear and continue
            resolvedCache.delete(sourceKey);
          } else {
            // Cached as "no project"
            if (!cancelled && mountedRef.current) {
              setTranslationStorage(null);
              setExists(false);
            }
            return;
          }
        }

        // ── 2. Backlink: trust sourceMeta.translationProject ──
        const backlink = sourceMeta.translationProject?.projectName;
        if (backlink) {
          console.info(TAG, "trying backlink:", backlink);
          const store = await tryOpenByName(backlink);
          if (store && !cancelled && mountedRef.current) {
            console.info(TAG, "✅ opened via backlink:", backlink);
            resolvedCache.set(sourceKey, backlink);
            setTranslationStorage(store);
            setExists(true);
            return;
          }
          // Backlink broken — fall through to full scan
          console.warn(TAG, "backlink broken, falling through to full scan");
        }

        // ── 3. Full resolver scan (fallback) ──
        const projects = await OPFSStorage.listProjects();
        console.info(TAG, "full scan, OPFS projects:", projects.length, "source:", sourceKey);
        if (cancelled) return;

        const resolvedProjectName = await resolveTranslationMirrorProjectName({
          projects,
          sourceStorage,
          sourceMeta,
        });
        console.info(TAG, "resolved:", resolvedProjectName);
        if (cancelled) return;

        if (resolvedProjectName) {
          const store = await tryOpenByName(resolvedProjectName);
          if (store && !cancelled && mountedRef.current) {
            console.info(TAG, "✅ opened via full scan:", resolvedProjectName);
            resolvedCache.set(sourceKey, resolvedProjectName);
            setTranslationStorage(store);
            setExists(true);
            return;
          }
        }

        // No project found
        console.warn(TAG, "no translation project found for:", sourceKey);
        resolvedCache.set(sourceKey, null);
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
