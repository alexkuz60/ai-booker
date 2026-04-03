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
    return opts.projectStorage;
  }

  if (opts.storageBackend === "opfs") {
    // Get project name from the pre-built map (one book = one folder)
    const projectNames = opts.localProjectNamesByBookId.get(targetBookId) || [];
    if (projectNames.length === 0) return null;

    // Use the first (and ideally only) project name
    const projectName = projectNames[0];
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
