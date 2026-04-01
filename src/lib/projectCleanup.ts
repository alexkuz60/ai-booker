/**
 * projectCleanup — Wipe-and-Deploy protocol utilities.
 *
 * Centralizes all browser state cleanup needed before deploying
 * a server copy of a project into OPFS.
 *
 * Architecture: Local-Only. See ARCHITECTURE.md §1.8 step 5.
 *
 * IMPORTANT: Zombie scan must skip translation mirror projects
 * (those with targetLanguage/sourceProjectName) because they share
 * the same bookId as the source project.
 */

import { OPFSStorage } from "@/lib/projectStorage";
import type { ProjectMeta } from "@/lib/projectStorage";
import { setCachedSceneIndex } from "@/lib/sceneIndex";
import { clearChapterTextsCache } from "@/lib/chapterTextsCache";

// ── SessionStorage keys that belong to a book project ──

const SESSION_KEYS_TO_CLEAR = [
  "studio-active-chapter",
  "parser-nav-state",
  "parser-active-book",
];

// ── LocalStorage keys (exact or prefix-based) ──

const LOCAL_EXACT_KEYS: string[] = [
  // NOTE: booker_last_project is intentionally NOT cleared here.
  // It is re-set by createProject/openProjectByName after the wipe.
  // Clearing it here creates a window where bootstrap can't find any project
  // if the subsequent create fails or the session restarts mid-wipe.
];

const LOCAL_PREFIX_KEYS = [
  "booker_server_sync_checked:",
];

/**
 * Wipe all browser state related to a book project.
 * Called BEFORE deploying server copy into OPFS.
 *
 * Steps:
 * 1. Delete OPFS project folder(s) for this bookId
 * 2. Clear sessionStorage keys
 * 3. Clear localStorage keys (exact + prefix-based for bookId)
 * 4. Clear in-memory caches (sceneIndex, chapterTexts)
 */
export async function wipeProjectBrowserState(
  bookId: string,
  localProjectNames: string[],
): Promise<void> {
  // 1. Delete OPFS project folders for this bookId.
  //    ONLY delete folders that are confirmed source projects (not mirrors, not unopenable).
  for (const projectName of localProjectNames) {
    try {
      const store = await OPFSStorage.openExisting(projectName);
      if (!store) {
        // Directory can't be opened — DO NOT delete, may be a transient OPFS glitch.
        console.warn(`[Wipe] Skipping unopenable OPFS project (not deleting): ${projectName}`);
        continue;
      }
      const meta = await store.readJSON<ProjectMeta>("project.json");
      if (meta?.targetLanguage || meta?.sourceProjectName) {
        console.log(`[Wipe] Skipping translation mirror: ${projectName}`);
        continue;
      }
      if (meta?.bookId && meta.bookId !== bookId) {
        console.warn(`[Wipe] Skipping project with different bookId: ${projectName} (has ${meta.bookId}, expected ${bookId})`);
        continue;
      }
      await OPFSStorage.deleteProject(projectName);
      console.log(`[Wipe] Deleted OPFS project: ${projectName}`);
    } catch (err) {
      console.warn(`[Wipe] Failed to process OPFS project ${projectName}:`, err);
    }
  }

  // 1b. Verify deletion — scan for any surviving SOURCE folders with the same bookId.
  // CRITICAL: Skip translation mirror projects (they share bookId but are independent).
  try {
    const surviving = await OPFSStorage.listProjects();
    for (const projectName of surviving) {
      try {
        const store = await OPFSStorage.openExisting(projectName);
        if (!store) continue;
        const meta = await store.readJSON<ProjectMeta>("project.json");
        if (meta?.bookId === bookId) {
          // Skip translation mirrors — they have targetLanguage or sourceProjectName
          if (meta.targetLanguage || meta.sourceProjectName) {
            console.log(`[Wipe] Skipping translation mirror: ${projectName} (bookId=${bookId})`);
            continue;
          }
          console.warn(`[Wipe] ⚠️ ZOMBIE folder detected after wipe: ${projectName} (bookId=${bookId}). Force-deleting.`);
          await OPFSStorage.deleteProject(projectName);
        }
      } catch {
        // Can't read project.json — skip
      }
    }
  } catch {
    // listProjects failed — non-critical
  }

  // 2. Clear sessionStorage
  for (const key of SESSION_KEYS_TO_CLEAR) {
    try { sessionStorage.removeItem(key); } catch {}
  }

  // 3. Clear localStorage — exact keys
  for (const key of LOCAL_EXACT_KEYS) {
    try { localStorage.removeItem(key); } catch {}
  }

  // 3b. Clear localStorage — prefix-based keys for this bookId
  for (const prefix of LOCAL_PREFIX_KEYS) {
    const fullKey = `${prefix}${bookId}`;
    try { localStorage.removeItem(fullKey); } catch {}
  }

  // 4. Clear in-memory caches
  setCachedSceneIndex(null);
  clearChapterTextsCache();

  console.log(`[Wipe] Browser state cleared for bookId=${bookId}`);
}

/**
 * Full wipe of ALL local projects and browser state.
 * Used by hardResetLocalData.
 */
export async function wipeAllBrowserState(): Promise<void> {
  // Clear all session keys
  for (const key of SESSION_KEYS_TO_CLEAR) {
    try { sessionStorage.removeItem(key); } catch {}
  }

  // Clear all local keys (LOCAL_EXACT_KEYS + booker_last_project for full wipe)
  for (const key of [...LOCAL_EXACT_KEYS, "booker_last_project"]) {
    try { localStorage.removeItem(key); } catch {}
  }

  // Clear prefix-based keys (scan localStorage)
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && LOCAL_PREFIX_KEYS.some(prefix => key.startsWith(prefix))) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {}

  // Clear in-memory caches
  setCachedSceneIndex(null);
  clearChapterTextsCache();

  console.log("[Wipe] All browser state cleared");
}
