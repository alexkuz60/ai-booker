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
      const store = await OPFSStorage.openExisting(projectName);
      if (!store) continue;
      const meta = await store.readJSON<ProjectMeta>("project.json");
      if (!meta) continue;

      const isMirrorProject = !!meta.sourceProjectName || !!meta.targetLanguage;
      if (!isMirrorProject) continue;

      console.info("[resolveTranslation] candidate:", projectName, {
        sourceProjectName: meta.sourceProjectName,
        targetLanguage: meta.targetLanguage,
        bookId: meta.bookId,
      });

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

          const resolvedProjectName = await resolveTranslationProjectName(projects, sourceStorage, sourceMeta);
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
