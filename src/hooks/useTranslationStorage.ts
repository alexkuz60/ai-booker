/**
 * useTranslationStorage — opens the translation OPFS project.
 *
 * Resolution strategy (in order):
 * 1. OPFS-internal link file (_translation_link.json in source project)
 * 2. localStorage persisted hint
 * 3. Backlink in source project.json
 * 4. Canonical name candidates (_EN, _RU)
 * 5. Full OPFS meta-scan (scans ALL projects by bookId + targetLanguage)
 *
 * Every candidate is VALIDATED by reading its project.json before acceptance.
 * On success, all link sources are written back for fast future resolution.
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

// ── OPFS-internal link (survives localStorage clears) ──────

const OPFS_LINK_FILE = "_translation_link.json";

interface OpfsTranslationLink {
  projectName: string;
  targetLanguage: string;
  updatedAt: string;
}

async function readOpfsTranslationLink(
  sourceStorage: ProjectStorage,
): Promise<string | null> {
  try {
    const link = await sourceStorage.readJSON<OpfsTranslationLink>(OPFS_LINK_FILE);
    return link?.projectName?.trim() || null;
  } catch {
    return null;
  }
}

async function writeOpfsTranslationLink(
  sourceStorage: ProjectStorage,
  projectName: string,
  targetLanguage: string,
): Promise<void> {
  try {
    const link: OpfsTranslationLink = {
      projectName,
      targetLanguage,
      updatedAt: new Date().toISOString(),
    };
    await sourceStorage.writeJSON(OPFS_LINK_FILE, link);
  } catch (err) {
    console.warn(TAG, "Failed to write OPFS link:", err);
  }
}

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

/**
 * Validate that an opened OPFS store is actually a translation mirror
 * for the given source project. Returns the store only if valid.
 */
async function validateMirrorStore(
  store: ProjectStorage,
  sourceKey: string,
  sourceBookId: string | undefined,
  targetLanguage: string,
): Promise<boolean> {
  try {
    const meta = await store.readJSON<ProjectMeta>("project.json");
    if (!meta) return false;

    // Must look like a mirror
    if (!meta.targetLanguage && !meta.sourceProjectName) return false;

    // Strong match: sourceProjectName + targetLanguage
    if (meta.sourceProjectName === sourceKey && meta.targetLanguage === targetLanguage) return true;

    // Medium match: bookId + targetLanguage
    if (sourceBookId && meta.bookId === sourceBookId && meta.targetLanguage === targetLanguage) return true;

    // Weak match: sourceProjectName only (language might differ in meta)
    if (meta.sourceProjectName === sourceKey) return true;

    // Weak match: bookId only
    if (sourceBookId && meta.bookId === sourceBookId) return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * Build all candidate names from multiple sources (OPFS link, localStorage, backlink, canonical).
 */
function getAllCandidateNames(
  sourceStorage: ProjectStorage,
  sourceKey: string,
  sourceMeta: ProjectMeta,
  opfsLinkName: string | null,
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
        opfsLinkName,
        persisted,
        backlink,
        ...buildTranslationMirrorNames(sourceKey, targetLanguage, backlink),
      ].filter((name): name is string => !!name),
    ),
  );
}

/**
 * Full OPFS meta-scan: iterate ALL projects and find the best mirror match.
 * This is the nuclear fallback that always works if the mirror exists.
 */
async function findMirrorByMetaScan(
  sourceKey: string,
  sourceMeta: ProjectMeta,
): Promise<{ store: ProjectStorage; projectName: string } | null> {
  try {
    const targetLanguage = getTargetLanguage(sourceMeta);
    const allProjects = await OPFSStorage.listProjects();

    const candidates: Array<{
      projectName: string;
      score: number;
      updatedAt: string;
    }> = [];

    for (const projectName of allProjects) {
      if (projectName === sourceKey) continue;

      try {
        const store = await OPFSStorage.openExisting(projectName);
        if (!store) continue;

        const meta = await store.readJSON<ProjectMeta>("project.json");
        if (!meta) continue;

        // Must have SOME mirror signal
        const isMirror = Boolean(meta.targetLanguage || meta.sourceProjectName);
        // Also accept by name pattern if metadata is incomplete
        const nameMatch = /_(EN|RU)$/i.test(projectName);
        if (!isMirror && !nameMatch) continue;

        let score = 0;

        // Exact source + language match
        if (meta.sourceProjectName === sourceKey && meta.targetLanguage === targetLanguage) {
          score = 10;
        }
        // Source match, any language
        else if (meta.sourceProjectName === sourceKey) {
          score = 8;
        }
        // BookId + language match
        else if (sourceMeta.bookId && meta.bookId === sourceMeta.bookId && meta.targetLanguage === targetLanguage) {
          score = 6;
        }
        // BookId match only
        else if (sourceMeta.bookId && meta.bookId === sourceMeta.bookId) {
          score = 4;
        }
        // Name pattern match (e.g., SourceName_EN)
        else if (nameMatch && projectName.startsWith(sourceKey)) {
          score = 2;
        }

        if (score > 0) {
          candidates.push({
            projectName,
            score,
            updatedAt: meta.updatedAt ?? meta.createdAt ?? "",
          });
        }
      } catch {
        // Skip unreadable projects
      }
    }

    if (!candidates.length) return null;

    // Best score wins, then most recently updated
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

    const winner = candidates[0];
    console.info(TAG, `meta-scan found mirror: ${winner.projectName} (score=${winner.score})`);

    const store = await OPFSStorage.openExisting(winner.projectName);
    if (!store) return null;

    return { store, projectName: winner.projectName };
  } catch (err) {
    console.warn(TAG, "meta-scan failed:", err);
    return null;
  }
}

/**
 * Persist ALL link sources for fast future resolution.
 */
function persistAllLinks(
  sourceStorage: ProjectStorage,
  sourceKey: string,
  sourceMeta: ProjectMeta,
  resolvedName: string,
  targetLanguage: string,
): void {
  // 1. OPFS-internal link (survives localStorage clears)
  writeOpfsTranslationLink(sourceStorage, resolvedName, targetLanguage);

  // 2. localStorage hint
  writePersistedTranslationMirrorProjectName({
    sourceBookId: sourceMeta.bookId ?? null,
    sourceProjectName: sourceKey,
    translationProjectName: resolvedName,
  });
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
    const targetLanguage = getTargetLanguage(sourceMeta);

    (async () => {
      try {
        let store: ProjectStorage | null = null;
        let resolvedProjectName: string | null = null;

        // ── Phase 1: Try candidates (fast path) ──────────
        const opfsLinkName = await readOpfsTranslationLink(sourceStorage);
        const candidateNames = getAllCandidateNames(sourceStorage, sourceKey, sourceMeta, opfsLinkName);

        console.debug(TAG, "candidates for", sourceKey, ":", candidateNames);

        for (const candidateName of candidateNames) {
          const maybeStore = await OPFSStorage.openExisting(candidateName);
          if (!maybeStore) continue;

          // CRITICAL: Validate the store is actually our mirror
          const valid = await validateMirrorStore(maybeStore, sourceKey, sourceMeta.bookId, targetLanguage);
          if (!valid) {
            console.warn(TAG, `candidate ${candidateName} exists but failed validation — skipping`);
            continue;
          }

          store = maybeStore;
          resolvedProjectName = candidateName;
          console.info(TAG, "✅ validated candidate:", candidateName);
          break;
        }

        // ── Phase 2: Full meta-scan (nuclear fallback) ───
        if (!store) {
          console.info(TAG, "all candidates failed, starting full meta-scan…");
          const fallback = await findMirrorByMetaScan(sourceKey, sourceMeta);
          if (fallback) {
            store = fallback.store;
            resolvedProjectName = fallback.projectName;
          }
        }

        if (cancelled || !mountedRef.current) return;

        // ── Result ───────────────────────────────────────
        if (store && resolvedProjectName) {
          console.info(TAG, "✅ opened:", resolvedProjectName);
          // Write back ALL links for instant future resolution
          persistAllLinks(sourceStorage, sourceKey, sourceMeta, resolvedProjectName, targetLanguage);
          setTranslationStorage(store);
          setExists(true);
        } else {
          console.warn(TAG, "mirror not found in OPFS for:", sourceKey);
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
