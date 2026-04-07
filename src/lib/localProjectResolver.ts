/**
 * localProjectResolver — helpers for finding / creating the correct
 * OPFS ProjectStorage instance for a given bookId.
 *
 * Architecture: ONE project per bookId. No mirror projects.
 * Translations live inside the project in {lang}/ subdirectories.
 * No multi-candidate ranking. Direct lookup only.
 */

import { OPFSStorage, type ProjectStorage } from "@/lib/projectStorage";
import { stripFileExtension } from "@/lib/fileFormatUtils";
import { getProjectActivityMs } from "@/lib/projectActivity";

async function pickBestProjectName(
  targetBookId: string,
  projectNames: string[],
  activeStorage?: ProjectStorage | null,
): Promise<string | null> {
  if (projectNames.length === 0) return null;
  if (projectNames.length === 1) return projectNames[0];

  const ranked = await Promise.all(projectNames.map(async (projectName) => {
    try {
      const store = activeStorage?.isReady && activeStorage.projectName === projectName
        ? activeStorage
        : await OPFSStorage.openExisting(projectName);
      if (!store?.isReady) return null;

      const meta = await store.readJSON<{ bookId?: string; updatedAt?: string }>("project.json").catch(() => null);
      if (meta?.bookId && meta.bookId !== targetBookId) return null;

      const activityMs = await getProjectActivityMs(store).catch(() => 0);
      const updatedAtMs = meta?.updatedAt ? new Date(meta.updatedAt).getTime() : 0;

      return {
        projectName,
        score: Math.max(activityMs, Number.isFinite(updatedAtMs) ? updatedAtMs : 0),
      };
    } catch {
      return null;
    }
  }));

  const best = ranked
    .filter((entry): entry is { projectName: string; score: number } => !!entry)
    .sort((a, b) => b.score - a.score)[0];

  return best?.projectName ?? projectNames[0];
}

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

// ── Find the OPFS project for a bookId ──────────

export interface ResolveOptions {
  activate?: boolean;
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
  const activeBookId = await getBookIdFromStorage(opts.projectStorage);
  if (opts.projectStorage?.isReady && activeBookId === targetBookId) {
    if (activate && opts.openProjectByName) {
      const refreshed = await opts.openProjectByName(opts.projectStorage.projectName);
      if (refreshed?.isReady) return refreshed;
    }
    return opts.projectStorage;
  }

  if (opts.storageBackend === "opfs") {
    // Get project name from the pre-built map (one book = one folder)
    const projectNames = opts.localProjectNamesByBookId.get(targetBookId) || [];
    if (projectNames.length === 0) return null;

    const projectName = await pickBestProjectName(targetBookId, projectNames, opts.projectStorage);
    if (!projectName) return null;
    if (projectNames.length > 1) {
      console.warn(
        `[Resolver] ⚠️ Multiple OPFS folders for bookId=${targetBookId}: [${projectNames.join(", ")}]. Using first: ${projectName}`
      );
    }

    if (activate && opts.openProjectByName) {
      const activated = await opts.openProjectByName(projectName);
      if (activated?.isReady) return activated;
    }

    const store = await OPFSStorage.openExisting(projectName);
    return store?.isReady ? store : null;
  }

  return null;
}

