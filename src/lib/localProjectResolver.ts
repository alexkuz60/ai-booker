/**
 * localProjectResolver — helpers for finding / creating the correct
 * OPFS ProjectStorage instance for a given bookId.
 *
 * Extracted from useBookRestore to keep the hook lean and allow
 * reuse from other modules (e.g. serverDeploy, useSaveBookToProject).
 */

import { OPFSStorage, type ProjectStorage } from "@/lib/projectStorage";
import { getProjectActivityMs } from "@/lib/projectActivity";
import { stripFileExtension } from "@/lib/fileFormatUtils";
/** Read project.json and return true if this folder is a legacy translation mirror */
async function isMirrorByMeta(projectName: string): Promise<boolean> {
  try {
    const store = await OPFSStorage.openExisting(projectName);
    if (!store) return false;
    const meta = await store.readJSON<{ targetLanguage?: string; sourceProjectName?: string }>("project.json");
    if (!meta) return false;
    return Boolean(meta.targetLanguage || meta.sourceProjectName);
  } catch {
    return false;
  }
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

async function getExistingOpfsProjects(): Promise<Set<string>> {
  try {
    return new Set(await OPFSStorage.listProjects());
  } catch {
    return new Set<string>();
  }
}

async function isCurrentStorageUsable(
  storage: ProjectStorage | null | undefined,
  storageBackend: "fs-access" | "opfs" | "none",
): Promise<boolean> {
  if (!storage?.isReady) return false;
  if (storageBackend !== "opfs") return true;
  const existing = await getExistingOpfsProjects();
  return existing.has(storage.projectName);
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

  // Prefer already active storage first (LAST_PROJECT_KEY bootstrap source of truth).
  const activeBookId = await getBookIdFromStorage(opts.projectStorage);
  const currentStorageUsable = await isCurrentStorageUsable(opts.projectStorage, opts.storageBackend);
  if (opts.projectStorage?.isReady && activeBookId === targetBookId && currentStorageUsable) {
    return opts.projectStorage;
  }

  if (opts.storageBackend === "opfs") {
    const existingProjects = await getExistingOpfsProjects();
    let projectNames = (opts.localProjectNamesByBookId.get(targetBookId) || [])
      .filter((projectName) => existingProjects.has(projectName));

    // Filter out mirrors that may have leaked into the pre-built map
    const filteredNames: string[] = [];
    for (const pn of projectNames) {
      if (await isMirrorByMeta(pn)) {
        console.warn("[Resolver] Filtering mirror from pre-built map:", pn);
        continue;
      }
      filteredNames.push(pn);
    }
    projectNames = filteredNames;

    // B26 fix: if the pre-built map is empty (e.g. auto-restore before library loaded),
    // do a direct OPFS scan to find the project by bookId in project.json.
    if (!projectNames.length && existingProjects.size > 0) {
      console.debug("[Resolver] Map empty for bookId=%s, scanning OPFS directly (%d projects)", targetBookId, existingProjects.size);
      for (const projectName of existingProjects) {
        try {
          // Skip mirrors — by meta first, then by name as fallback
          if (await isMirrorByMeta(projectName)) continue;

          const store = await OPFSStorage.openExisting(projectName);
          if (!store) continue;
          const meta = await store.readJSON<{ bookId?: string }>("project.json");
          if (meta?.bookId === targetBookId) {
            projectNames.push(projectName);
          }
        } catch { /* skip unreadable */ }
      }
      if (projectNames.length) {
        console.debug("[Resolver] Direct scan found %d project(s) for bookId=%s: [%s]", projectNames.length, targetBookId, projectNames.join(", "));
      }
    }

    if (projectNames.length) {
      if (projectNames.length > 1) {
        console.warn(
          `[Resolver] ⚠️ MULTIPLE OPFS projects for bookId=${targetBookId}: [${projectNames.join(", ")}]. Picking freshest.`
        );
      }
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
              } catch (err) {
                console.warn("[Resolver] Failed to inspect OPFS project:", projectName, err);
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
          if (activated?.isReady) {
            console.debug("[Resolver] Activated freshest OPFS project:", freshest.projectName, targetBookId);
            return activated;
          }
        }

        if (freshest.store.isReady) {
          console.debug("[Resolver] Opened freshest OPFS project directly:", freshest.projectName, targetBookId);
          return freshest.store;
        }
      } catch (err) {
        console.warn("[Resolver] Failed to open freshest OPFS project for book:", targetBookId, err);
      }
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

  const activeBookId = await getBookIdFromStorage(opts.projectStorage);
  const currentStorageUsable = await isCurrentStorageUsable(opts.projectStorage, opts.storageBackend);
  if (opts.projectStorage?.isReady && activeBookId === targetBookId && currentStorageUsable) {
    return opts.projectStorage;
  }

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
