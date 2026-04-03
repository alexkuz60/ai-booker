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
    // Get candidate project names from the pre-built map
    let projectNames = opts.localProjectNamesByBookId.get(targetBookId) || [];

    // Fallback: if map is empty (e.g. auto-restore before library loaded),
    // do a direct OPFS scan to find the project by bookId in project.json.
    if (!projectNames.length) {
      try {
        const allProjects = await OPFSStorage.listProjects();
        for (const projectName of allProjects) {
          try {
            const store = await OPFSStorage.openExisting(projectName);
            if (!store) continue;
            const meta = await store.readJSON<{ bookId?: string }>("project.json");
            if (meta?.bookId === targetBookId) {
              projectNames.push(projectName);
            }
          } catch { /* skip unreadable */ }
        }
      } catch { /* listProjects failed */ }
    }

    if (!projectNames.length) return null;

    // If only one candidate — fast path
    if (projectNames.length === 1) {
      const name = projectNames[0];
      if (activate && opts.openProjectByName) {
        const activated = await opts.openProjectByName(name);
        if (activated?.isReady) return activated;
      }
      const store = await OPFSStorage.openExisting(name);
      return store?.isReady ? store : null;
    }

    // Multiple candidates — pick freshest by deep activity scan
    console.warn(
      `[Resolver] ⚠️ MULTIPLE OPFS projects for bookId=${targetBookId}: [${projectNames.join(", ")}]. Picking freshest.`
    );
    try {
      const ranked = (
        await Promise.all(
          projectNames.map(async (projectName) => {
            try {
              const store = await OPFSStorage.openExisting(projectName);
              if (!store) return null;
              return {
                projectName,
                store,
                activityMs: await getProjectActivityMs(store),
              };
            } catch {
              return null;
            }
          }),
        )
      )
        .filter((c): c is NonNullable<typeof c> => !!c)
        .sort((a, b) => b.activityMs - a.activityMs);

      const freshest = ranked[0];
      if (!freshest) return null;

      if (activate && opts.openProjectByName) {
        const activated = await opts.openProjectByName(freshest.projectName);
        if (activated?.isReady) return activated;
      }

      return freshest.store.isReady ? freshest.store : null;
    } catch (err) {
      console.warn("[Resolver] Failed to open freshest OPFS project for book:", targetBookId, err);
    }
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
