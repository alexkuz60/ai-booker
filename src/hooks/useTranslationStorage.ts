/**
 * useTranslationStorage — opens the mirror OPFS translation project
 * alongside the source project, providing read/write access to translated data.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { OPFSStorage } from "@/lib/projectStorage";
import type { ProjectStorage, ProjectMeta } from "@/lib/projectStorage";

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

async function resolveTranslationProjectName(
  projects: string[],
  sourceStorage: ProjectStorage,
  sourceMeta: ProjectMeta,
): Promise<string | null> {
  const sourceLang = sourceMeta.language;
  const preferredTargetLang = sourceLang === "en" ? "ru" : "en";
  const preferredSuffix = preferredTargetLang.toUpperCase();
  const exactName = `${sourceStorage.projectName}_${preferredSuffix}`;

  if (projects.includes(exactName)) return exactName;

  let linkedCandidate: string | null = null;
  let sameBookCandidate: string | null = null;

  for (const projectName of projects) {
    try {
      const store = await OPFSStorage.openOrCreate(projectName);
      const meta = await store.readJSON<ProjectMeta>("project.json");
      if (!meta) continue;

      const isMirrorProject = !!meta.sourceProjectName || !!meta.targetLanguage;
      if (!isMirrorProject) continue;

      const sameBook = meta.bookId === sourceMeta.bookId;
      const linkedToCurrentSource = meta.sourceProjectName === sourceStorage.projectName;
      const looksLikeMirrorName = projectName.startsWith(`${sourceStorage.projectName}_`);
      const isPreferredTarget = meta.targetLanguage === preferredTargetLang;

      if (linkedToCurrentSource && isPreferredTarget) {
        return projectName;
      }

      if (!linkedCandidate && linkedToCurrentSource) {
        linkedCandidate = projectName;
      }

      if (!sameBookCandidate && sameBook && (isPreferredTarget || looksLikeMirrorName)) {
        sameBookCandidate = projectName;
      }
    } catch {
      // Ignore unreadable candidates and continue scanning.
    }
  }

  return linkedCandidate ?? sameBookCandidate ?? null;
}

export function useTranslationStorage(
  sourceStorage: ProjectStorage | null,
  sourceMeta: ProjectMeta | null,
): UseTranslationStorageReturn {
  const [translationStorage, setTranslationStorage] = useState<ProjectStorage | null>(null);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(false);
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
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const projects = await OPFSStorage.listProjects();
        if (cancelled) return;

          const resolvedProjectName = await resolveTranslationProjectName(projects, sourceStorage, sourceMeta);
          if (cancelled) return;

          if (resolvedProjectName) {
            const store = await OPFSStorage.openOrCreate(resolvedProjectName);
            if (!cancelled && mountedRef.current) {
              setTranslationStorage(store);
              setExists(true);
            }
          } else {
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
