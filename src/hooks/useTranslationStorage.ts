/**
 * useTranslationStorage — opens the mirror OPFS translation project
 * alongside the source project, providing read/write access to translated data.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { OPFSStorage } from "@/lib/projectStorage";
import type { ProjectStorage, ProjectMeta } from "@/lib/projectStorage";
import { resolveTranslationMirrorProjectName } from "@/lib/translationMirrorResolver";

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

export function useTranslationStorage(
  sourceStorage: ProjectStorage | null,
  sourceMeta: ProjectMeta | null,
): UseTranslationStorageReturn {
  const [translationStorage, setTranslationStorage] = useState<ProjectStorage | null>(null);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!sourceStorage || !sourceMeta) {
      setTranslationStorage(null);
      setExists(false);
      // Don't reset loading to false here — if inputs are null because
      // the parent context hasn't initialized yet, we should keep loading=true
      // so consumers know they should wait rather than assume "no project".
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const projects = await OPFSStorage.listProjects();
        console.info("[useTranslationStorage] OPFS projects:", projects, "source:", sourceStorage.projectName, "lang:", sourceMeta.language);
        if (cancelled) return;

          const resolvedProjectName = await resolveTranslationMirrorProjectName({
            projects,
            sourceStorage,
            sourceMeta,
          });
          console.info("[useTranslationStorage] resolved:", resolvedProjectName);
          if (cancelled) return;

          if (resolvedProjectName) {
            const store = await OPFSStorage.openExisting(resolvedProjectName);
            if (!store) {
              console.warn("[useTranslationStorage] resolved project directory missing:", resolvedProjectName);
              if (!cancelled && mountedRef.current) {
                setTranslationStorage(null);
                setExists(false);
              }
              return;
            }
            // Verify project.json exists — if not, the folder is a zombie
            const projMeta = await store.readJSON<ProjectMeta>("project.json");
            if (!projMeta) {
              console.warn("[useTranslationStorage] project.json missing in resolved project:", resolvedProjectName);
              if (!cancelled && mountedRef.current) {
                setTranslationStorage(null);
                setExists(false);
              }
            } else if (!cancelled && mountedRef.current) {
              console.info("[useTranslationStorage] ✅ opened translation project:", resolvedProjectName);
              setTranslationStorage(store);
              setExists(true);
            }
          } else {
            console.warn("[useTranslationStorage] no translation project found for source:", sourceStorage.projectName);
            if (!cancelled && mountedRef.current) {
              setTranslationStorage(null);
              setExists(false);
            }
          }
      } catch (err) {
        console.error("[useTranslationStorage] error:", err);
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
