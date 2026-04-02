/**
 * useTranslationStorage — opens the translation OPFS project referenced by
 * source project.json.translationProject.projectName.
 *
 * No localStorage hints, no canonical-name fallbacks, no OPFS scans,
 * no retry timers, no background self-healing.
 */

import { useCallback, useEffect, useState } from "react";
import { OPFSStorage } from "@/lib/projectStorage";
import type { ProjectStorage, ProjectMeta } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";
import { getLinkedTranslationProjectName } from "@/lib/translationMirrorResolver";

const TAG = "[useTranslationStorage]";

// ── Helpers ────────────────────────────────────────────────

interface UseTranslationStorageReturn {
  translationStorage: ProjectStorage | null;
  exists: boolean;
  loading: boolean;
  refresh: () => void;
}

function getTargetLanguage(sourceMeta: ProjectMeta): "en" | "ru" {
  return sourceMeta.language === "en" ? "ru" : "en";
}

async function readLiveSourceMeta(
  sourceStorage: ProjectStorage,
  sourceMeta: ProjectMeta | null,
): Promise<ProjectMeta | null> {
  const liveMeta = await sourceStorage.readJSON<ProjectMeta>(paths.projectMeta()).catch(() => null);
  return liveMeta ?? sourceMeta;
}

async function openLinkedMirror(
  sourceStorage: ProjectStorage,
  sourceMeta: ProjectMeta | null,
): Promise<ProjectStorage | null> {
  const effectiveSourceMeta = await readLiveSourceMeta(sourceStorage, sourceMeta);
  if (!effectiveSourceMeta) return null;

  const linkedProjectName = getLinkedTranslationProjectName(effectiveSourceMeta)
    ?? getLinkedTranslationProjectName(sourceMeta);
  if (!linkedProjectName) return null;

  const store = await OPFSStorage.openExisting(linkedProjectName);
  if (!store) {
    console.warn(TAG, "linked mirror not found:", linkedProjectName);
    return null;
  }

  const mirrorMeta = await store.readJSON<ProjectMeta>(paths.projectMeta()).catch(() => null);
  if (!mirrorMeta) {
    console.warn(TAG, "linked mirror project.json unreadable:", linkedProjectName);
    return null;
  }

  const targetLanguage = getTargetLanguage(effectiveSourceMeta);
  const valid = mirrorMeta.sourceProjectName === sourceStorage.projectName
    && mirrorMeta.targetLanguage === targetLanguage
    && (!effectiveSourceMeta.bookId || !mirrorMeta.bookId || mirrorMeta.bookId === effectiveSourceMeta.bookId);

  if (!valid) {
    console.warn(TAG, "linked mirror failed validation:", linkedProjectName);
    return null;
  }

  return store;
}

// ── Hook ───────────────────────────────────────────────────

export function useTranslationStorage(
  sourceStorage: ProjectStorage | null,
  sourceMeta: ProjectMeta | null,
): UseTranslationStorageReturn {
  const [translationStorage, setTranslationStorage] = useState<ProjectStorage | null>(null);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!sourceStorage) {
      setTranslationStorage(null);
      setExists(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const store = await openLinkedMirror(sourceStorage, sourceMeta);

        if (cancelled) return;

        if (store) {
          setTranslationStorage(store);
          setExists(true);
        } else {
          setTranslationStorage(null);
          setExists(false);
        }
      } catch (err) {
        console.error(TAG, "resolution error:", err);
        if (!cancelled) {
          setTranslationStorage(null);
          setExists(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sourceStorage, sourceMeta?.bookId, sourceMeta?.language, sourceMeta?.translationProject?.projectName, tick]);

  return { translationStorage, exists, loading, refresh };
}
