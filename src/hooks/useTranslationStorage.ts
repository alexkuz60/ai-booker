/**
 * useTranslationStorage — opens the translation OPFS project.
 *
 * Resolves the mirror name from backlink/local hint/canonical candidates,
 * then opens the first existing OPFS project.
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

interface UseTranslationStorageReturn {
  translationStorage: ProjectStorage | null;
  exists: boolean;
  loading: boolean;
  refresh: () => void;
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
  const targetLanguage: "en" | "ru" = sourceMeta.language === "en" ? "ru" : "en";

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

    if (candidateNames.length === 0) {
      console.info(TAG, "no translation project name found for:", sourceKey);
      setTranslationStorage(null);
      setExists(false);
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
          setExists(false);
        }
      } catch (err) {
        console.error(TAG, "error opening candidates:", candidateNames, err);
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

  // Re-open on tab focus (covers creation in another tab)
  useEffect(() => {
    if (!sourceStorage || !sourceMeta || translationStorage) return;

    const handle = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, [sourceStorage, sourceMeta, translationStorage, refresh]);

  return { translationStorage, exists, loading, refresh };
}
