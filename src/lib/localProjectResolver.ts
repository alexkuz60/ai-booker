/**
 * localProjectResolver — helpers for finding / creating the correct
 * OPFS ProjectStorage instance for a given bookId.
 *
 * Extracted from useBookRestore to keep the hook lean and allow
 * reuse from other modules (e.g. serverDeploy, useSaveBookToProject).
 *
 * Architecture: ONE project per bookId. No mirror projects.
 * Translations live inside the project in {lang}/ subdirectories.
 */

import { OPFSStorage, type ProjectStorage } from "@/lib/projectStorage";
import { getProjectActivityMs } from "@/lib/projectActivity";
import { stripFileExtension } from "@/lib/fileFormatUtils";
import { isLegacyMirrorMeta, pickPreferredProjectCandidate } from "@/lib/projectSourcePolicy";

// ── Read bookId from an arbitrary ProjectStorage ────────────

export async function getBookIdFromStorage(
  storage: ProjectStorage | null | undefined,
): Promise<string | null> {
  if (!storage?.isReady) return null;
  try {
    const meta = await storage.readJSON<{ bookId?: string }>("project.json");
    if (meta?.bookId) return meta.bookId;
    const structure = await storage.readJSON<{ bookId?: string }>("structure/toc.json");
    return structure?.bookId || null;
  } catch {
    return null;
  }
}

// ── Find the freshest OPFS project for a bookId ──────────

export interface ResolveOptions {
  activate?: boolean;
}

type StoredProjectIdentity = {
  bookId?: string;
  sourceProjectName?: string;
  targetLanguage?: string;
};

interface RankedProjectCandidate {
  projectName: string;
  store: ProjectStorage;
  score: number;
  isLegacyMirror: boolean;
}

async function readRankedProjectCandidate(
  projectName: string,
  targetBookId: string,
): Promise<RankedProjectCandidate | null> {
  try {
    const store = await OPFSStorage.openExisting(projectName);
    if (!store) return null;

    const meta = await store.readJSON<StoredProjectIdentity>("project.json");
    const resolvedBookId = meta?.bookId ?? await getBookIdFromStorage(store);
    if (resolvedBookId !== targetBookId) return null;

    return {
      projectName,
      store,
      score: await getProjectActivityMs(store),
      isLegacyMirror: isLegacyMirrorMeta(meta),
    };
  } catch {
    return null;
  }
}

export async function resolveLocalStorageForBook(
  targetBookId: string,
  opts: {
    storageBackend: "fs-access" | "opfs" | "none";
    localProjectNamesByBookId: Map<string, string[]>;
    projectStorage?: ProjectStorage | null;
    openProjectByName?: (name: string) => Promise<ProjectStorage | null>;
  },
  resolveOpts?: ResolveOptions,
): Promise<ProjectStorage | null> {
  const activate = resolveOpts?.activate ?? false;

  // Prefer already active storage first
  const activeMeta = await opts.projectStorage?.readJSON<StoredProjectIdentity>("project.json").catch(() => null);
  const activeBookId = activeMeta?.bookId ?? await getBookIdFromStorage(opts.projectStorage);
  if (
    opts.projectStorage?.isReady &&
    activeBookId === targetBookId &&
    !isLegacyMirrorMeta(activeMeta)
  ) {
    return opts.projectStorage;
  }

  if (opts.storageBackend === "opfs") {
    // Get candidate project names from the pre-built map
    const projectNames = opts.localProjectNamesByBookId.get(targetBookId) || [];
    const seenProjectNames = new Set(projectNames);
    const rankedCandidates = (
      await Promise.all(projectNames.map((projectName) => readRankedProjectCandidate(projectName, targetBookId)))
    ).filter((candidate): candidate is RankedProjectCandidate => !!candidate);

    const needsFallbackScan = rankedCandidates.length === 0 || rankedCandidates.every((candidate) => candidate.isLegacyMirror);

    // Fallback: if map is empty/incomplete or contains only legacy mirrors,
    // do a direct OPFS scan to find the best source project by bookId.
    if (needsFallbackScan) {
      try {
        const allProjects = await OPFSStorage.listProjects();
        for (const projectName of allProjects) {
          if (seenProjectNames.has(projectName)) continue;
          seenProjectNames.add(projectName);
          const candidate = await readRankedProjectCandidate(projectName, targetBookId);
          if (candidate) rankedCandidates.push(candidate);
        }
      } catch { /* listProjects failed */ }
    }

    if (!rankedCandidates.length) return null;

    if (rankedCandidates.length > 1) {
      console.warn(
        `[Resolver] ⚠️ MULTIPLE OPFS projects for bookId=${targetBookId}: [${rankedCandidates.map((candidate) => candidate.projectName).join(", ")}]. Preferring non-legacy source project.`
      );
    }

    const preferred = pickPreferredProjectCandidate(rankedCandidates);
    if (!preferred) return null;

    if (activate && opts.openProjectByName) {
      const activated = await opts.openProjectByName(preferred.projectName);
      if (activated?.isReady) return activated;
    }

    return preferred.store.isReady ? preferred.store : null;
  }

  return null;
}

// ── Ensure a writable project exists (find or create) ──────

export async function ensureWritableLocalStorage(
  targetBookId: string,
  targetTitle: string,
  targetFileName: string,
  opts: {
    storageBackend: "fs-access" | "opfs" | "none";
    localProjectNamesByBookId: Map<string, string[]>;
    projectStorage?: ProjectStorage | null;
    openProjectByName?: (name: string) => Promise<ProjectStorage | null>;
    createProject?: (title: string, bookId: string, userId: string, language: "ru" | "en") => Promise<ProjectStorage>;
    userId?: string;
    isRu: boolean;
  },
): Promise<ProjectStorage | null> {
  const existing = await resolveLocalStorageForBook(targetBookId, opts, { activate: true });
  if (existing?.isReady) return existing;

  if (opts.storageBackend === "opfs" && opts.createProject && opts.userId) {
    try {
      const lang = opts.isRu ? ("ru" as const) : ("en" as const);
      return await opts.createProject(
        targetTitle || stripFileExtension(targetFileName),
        targetBookId,
        opts.userId,
        lang,
      );
    } catch (err) {
      console.warn("[Resolver] Failed to create local project:", err);
    }
  }

  return null;
}
