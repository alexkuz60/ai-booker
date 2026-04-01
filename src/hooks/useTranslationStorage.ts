/**
 * useTranslationStorage — opens the translation OPFS project.
 *
 * Dead-simple: read the project name from meta/localStorage, open it. Done.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { OPFSStorage } from "@/lib/projectStorage";
import type { ProjectStorage, ProjectMeta } from "@/lib/projectStorage";
import {
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

function getTranslationProjectName(
  sourceKey: string,
  sourceMeta: ProjectMeta,
): string | null {
  // 1. Backlink in project.json — the most reliable source
  const backlink = sourceMeta.translationProject?.projectName;
  if (backlink) return backlink;

  // 2. localStorage persistence
  const persisted = readPersistedTranslationMirrorProjectName({
    sourceBookId: sourceMeta.bookId ?? null,
    sourceProjectName: sourceKey,
  });
  if (persisted) return persisted;

  // 3. Canonical suffix convention
  const targetLang = sourceMeta.language === "en" ? "RU" : "EN";
  return `${sourceKey}_${targetLang}`;
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
    const projectName = getTranslationProjectName(sourceKey, sourceMeta);

    if (!projectName) {
      console.info(TAG, "no translation project name found for:", sourceKey);
      setTranslationStorage(null);
      setExists(false);
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const store = await OPFSStorage.openExisting(projectName);
        if (cancelled || !mountedRef.current) return;

        if (store) {
          console.info(TAG, "✅ opened:", projectName);
          writePersistedTranslationMirrorProjectName({
            sourceBookId: sourceMeta.bookId ?? null,
            sourceProjectName: sourceKey,
            translationProjectName: projectName,
          });
          setTranslationStorage(store);
          setExists(true);
        } else {
          console.warn(TAG, "project not found in OPFS:", projectName);
          setTranslationStorage(null);
          setExists(false);
        }
      } catch (err) {
        console.error(TAG, "error opening:", projectName, err);
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
