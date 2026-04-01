/**
 * useTranslationStorage — opens the translation OPFS project.
 *
 * Resolves mirror name from backlink/local hint/canonical candidates,
 * then falls back to metadata scan when links were lost.
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

type TranslationFlags = Partial<Record<"trans_storage_created" | "trans_migration_done", boolean>>;

interface UseTranslationStorageReturn {
  translationStorage: ProjectStorage | null;
  exists: boolean;
  loading: boolean;
  refresh: () => void;
}

function getTargetLanguage(sourceMeta: ProjectMeta): "en" | "ru" {
  return sourceMeta.language === "en" ? "ru" : "en";
}

function isTranslationExpected(sourceKey: string, sourceMeta: ProjectMeta): boolean {
  const persisted = readPersistedTranslationMirrorProjectName({
    sourceBookId: sourceMeta.bookId ?? null,
    sourceProjectName: sourceKey,
  });
  const flags = (sourceMeta.pipelineProgress ?? {}) as TranslationFlags;

  return Boolean(
    sourceMeta.translationProject?.projectName ||
    persisted ||
    flags.trans_storage_created ||
    flags.trans_migration_done,
  );
}

function getTranslationProjectNames(
  sourceKey: string,
  sourceMeta: ProjectMeta,
): string[] {
  const backlink = sourceMeta.translationProject?.projectName;
  const persisted = readPersistedTranslationMirrorProjectName({
    sourceBookId: sourceMeta.bookId ?? null,
    sourceProjectName: sourceKey,
  });
  const targetLanguage = getTargetLanguage(sourceMeta);

  return Array.from(
    new Set(
      [
        backlink,
        persisted,
        ...buildTranslationMirrorNames(sourceKey, targetLanguage, backlink),
      ].filter((name): name is string => !!name),
    ),
  );
}

async function resolveTranslationByMetaScan(
  sourceKey: string,
  sourceMeta: ProjectMeta,
): Promise<{ store: ProjectStorage; projectName: string } | null> {
  try {
    const targetLanguage = getTargetLanguage(sourceMeta);
    const projectNames = await OPFSStorage.listProjects();

    const candidates: Array<{ projectName: string; score: number; updatedAt: string }> = [];

    for (const projectName of projectNames) {
      if (projectName === sourceKey) continue;

      const store = await OPFSStorage.openExisting(projectName);
      if (!store) continue;

      const meta = await store.readJSON<ProjectMeta>("project.json");
      if (!meta) continue;

      const looksLikeMirror = Boolean(meta.targetLanguage || meta.sourceProjectName);
      if (!looksLikeMirror) continue;

      let score = 0;
      if (meta.sourceProjectName === sourceKey && meta.targetLanguage === targetLanguage) {
        score = 4;
      } else if (meta.sourceProjectName === sourceKey) {
        score = 3;
      } else if (sourceMeta.bookId && meta.bookId === sourceMeta.bookId && meta.targetLanguage === targetLanguage) {
        score = 2;
      } else if (sourceMeta.bookId && meta.bookId === sourceMeta.bookId) {
        score = 1;
      }

      if (score > 0) {
        candidates.push({
          projectName,
          score,
          updatedAt: meta.updatedAt ?? meta.createdAt ?? "",
        });
      }
    }

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

    const winner = candidates[0];
    const winnerStore = await OPFSStorage.openExisting(winner.projectName);
    if (!winnerStore) return null;

    console.info(TAG, "fallback meta-scan resolved:", winner.projectName);
    return { store: winnerStore, projectName: winner.projectName };
  } catch (err) {
    console.warn(TAG, "fallback meta-scan failed:", err);
    return null;
  }
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
    setTick((t) => t + 1);
  }, []);

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
    const candidateNames = getTranslationProjectNames(sourceKey, sourceMeta);
    const expected = isTranslationExpected(sourceKey, sourceMeta);

    if (candidateNames.length === 0) {
      console.info(TAG, "no translation project name found for:", sourceKey);
      setTranslationStorage(null);
      setExists(expected);
      setLoading(false);
      return;
    }

    (async () => {
      try {
        let store: ProjectStorage | null = null;
        let resolvedProjectName: string | null = null;

        for (const candidateName of candidateNames) {
          const maybeStore = await OPFSStorage.openExisting(candidateName);
          if (!maybeStore) continue;
          store = maybeStore;
          resolvedProjectName = candidateName;
          break;
        }

        // Self-heal when link/name drift happened (duplicate source folders, stale hints, etc.)
        if (!store) {
          const fallback = await resolveTranslationByMetaScan(sourceKey, sourceMeta);
          if (fallback) {
            store = fallback.store;
            resolvedProjectName = fallback.projectName;
          }
        }

        if (cancelled || !mountedRef.current) return;

        if (store && resolvedProjectName) {
          console.info(TAG, "✅ opened:", resolvedProjectName);
          writePersistedTranslationMirrorProjectName({
            sourceBookId: sourceMeta.bookId ?? null,
            sourceProjectName: sourceKey,
            translationProjectName: resolvedProjectName,
          });
          setTranslationStorage(store);
          setExists(true);
        } else {
          console.warn(TAG, "project not found in OPFS:", candidateNames.join(", "));
          setTranslationStorage(null);
          // Keep "exists" true when translation was previously created, so UI shows reconnect state.
          setExists(expected);
        }
      } catch (err) {
        console.error(TAG, "error opening candidates:", candidateNames, err);
        if (!cancelled && mountedRef.current) {
          setTranslationStorage(null);
          setExists(expected);
        }
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sourceStorage, sourceMeta, tick]);

  // Re-open on visibility/focus (covers creation in another tab and wake-from-sleep)
  useEffect(() => {
    if (!sourceStorage || !sourceMeta || translationStorage) return;

    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onFocus = () => refresh();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [sourceStorage, sourceMeta, translationStorage, refresh]);

  return { translationStorage, exists, loading, refresh };
}
