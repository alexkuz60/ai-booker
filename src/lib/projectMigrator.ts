/**
 * projectMigrator — migrates OPFS project from V1 (flat) to V2 (nested).
 *
 * V1 layout:
 *   scenes/chapter_{id}.json
 *   storyboard/scene_{id}.json
 *   characters/index.json
 *   characters/scene_{id}.json
 *
 * V2 layout:
 *   chapters/{chapterId}/content.json
 *   chapters/{chapterId}/scenes/{sceneId}/storyboard.json
 *   chapters/{chapterId}/scenes/{sceneId}/characters.json
 *   characters.json (root)
 *   scene_index.json
 */

import type { ProjectStorage, ProjectMeta } from "@/lib/projectStorage";
import type { LocalChapterData } from "@/lib/localSync";
import type { LocalStoryboardData } from "@/lib/storyboardSync";
import type { SceneCharacterMap, CharacterIndex } from "@/pages/parser/types";
import { setActiveLayout } from "@/lib/projectPaths";
import {
  buildSceneIndex,
  writeSceneIndex,
  type SceneIndexData,
} from "@/lib/sceneIndex";
import { fnv1a32 } from "@/lib/contentHash";

const V2_MARKER = 2;

/**
 * Detect layout version of a project.
 * V2 projects have scene_index.json or version >= 2 in project.json.
 */
export async function detectLayoutVersion(
  storage: ProjectStorage,
): Promise<"v1" | "v2"> {
  try {
    const meta = await storage.readJSON<ProjectMeta & { layoutVersion?: number }>("project.json");
    if (meta?.layoutVersion === V2_MARKER) return "v2";

    // Also check for scene_index.json existence
    const hasIndex = await storage.exists("scene_index.json");
    if (hasIndex) return "v2";
  } catch { /* ignore */ }
  return "v1";
}

/**
 * Migrate a project from V1 to V2 layout.
 * Reads V1 files, writes V2 structure, then cleans up V1 leftovers.
 */
export async function migrateV1toV2(storage: ProjectStorage): Promise<void> {
  console.info("[Migrator] Starting V1 → V2 migration...");

  // ── 1. Read V1 chapter data to build scene→chapter mapping ──
  const sceneFiles = await storage.listDir("scenes").catch(() => []);
  const chapterDataMap = new Map<string, LocalChapterData>();
  // sceneId → chapterId lookup
  const sceneToChapter = new Map<string, string>();

  for (const file of sceneFiles) {
    if (!file.startsWith("chapter_") || !file.endsWith(".json")) continue;
    try {
      const data = await storage.readJSON<LocalChapterData>(`scenes/${file}`);
      if (!data?.chapterId) continue;
      chapterDataMap.set(data.chapterId, data);

      // Map each scene's ID to its chapter
      for (const scene of (data.scenes ?? [])) {
        const sid = (scene as any).id;
        if (sid) sceneToChapter.set(sid, data.chapterId);
      }
    } catch { /* skip corrupted files */ }
  }

  console.info(`[Migrator] Found ${chapterDataMap.size} chapters, ${sceneToChapter.size} scenes`);

  // ── 2. Write V2 chapter content files ──
  for (const [chapterId, data] of chapterDataMap) {
    await storage.writeJSON(`chapters/${chapterId}/content.json`, data);
  }

  // ── 3. Migrate storyboard files ──
  const storyboardFiles = await storage.listDir("storyboard").catch(() => []);
  const storyboarded: string[] = [];

  for (const file of storyboardFiles) {
    const m = file.match(/^scene_(.+)\.json$/);
    if (!m) continue;
    const sceneId = m[1];
    const chapterId = sceneToChapter.get(sceneId);
    if (!chapterId) {
      console.warn(`[Migrator] Cannot resolve chapterId for storyboard scene ${sceneId}, skipping`);
      continue;
    }
    try {
      const data = await storage.readJSON<LocalStoryboardData>(`storyboard/${file}`);
      if (data) {
        await storage.writeJSON(
          `chapters/${chapterId}/scenes/${sceneId}/storyboard.json`,
          data,
        );
        storyboarded.push(sceneId);
      }
    } catch { /* skip */ }
  }

  // ── 4. Migrate scene character maps ──
  const charFiles = await storage.listDir("characters").catch(() => []);
  const characterMapped: string[] = [];

  for (const file of charFiles) {
    if (file === "index.json") continue; // handled separately
    const m = file.match(/^scene_(.+)\.json$/);
    if (!m) continue;
    const sceneId = m[1];
    const chapterId = sceneToChapter.get(sceneId);
    if (!chapterId) {
      console.warn(`[Migrator] Cannot resolve chapterId for character map scene ${sceneId}, skipping`);
      continue;
    }
    try {
      const data = await storage.readJSON<SceneCharacterMap>(`characters/${file}`);
      if (data) {
        await storage.writeJSON(
          `chapters/${chapterId}/scenes/${sceneId}/characters.json`,
          data,
        );
        characterMapped.push(sceneId);
      }
    } catch { /* skip */ }
  }

  // ── 5. Migrate global character index ──
  try {
    const charIndex = await storage.readJSON<CharacterIndex[]>("characters/index.json");
    if (charIndex) {
      await storage.writeJSON("characters.json", charIndex);
    }
  } catch { /* skip */ }

  // ── 6. Build and write scene index ──
  const indexEntries: SceneIndexData["entries"] = {};
  for (const [chapterId, data] of chapterDataMap) {
    for (const scene of (data.scenes ?? [])) {
      const sid = (scene as any).id;
      if (!sid) continue;
      const content = (scene as any).content || "";
      indexEntries[sid] = {
        chapterId,
        chapterIndex: data.chapterIndex,
        sceneNumber: (scene as any).scene_number ?? 1,
        contentHash: content ? fnv1a32(content) : 0,
      };
    }
  }

  const sceneIndex: SceneIndexData = {
    version: 2,
    updatedAt: new Date().toISOString(),
    entries: indexEntries,
    storyboarded,
    characterMapped,
  };
  await writeSceneIndex(storage, sceneIndex);

  // ── 7. Mark project as V2 ──
  try {
    const meta = await storage.readJSON<Record<string, unknown>>("project.json");
    if (meta) {
      meta.layoutVersion = V2_MARKer;
      meta.updatedAt = new Date().toISOString();
      await storage.writeJSON("project.json", meta);
    }
  } catch { /* non-critical */ }

  // ── 8. Clean up V1 directories ──
  await cleanupV1(storage, sceneFiles, storyboardFiles, charFiles);

  setActiveLayout("v2");
  console.info(`[Migrator] Migration complete: ${chapterDataMap.size} chapters, ${storyboarded.length} storyboards, ${characterMapped.length} character maps`);
}

/**
 * Remove V1 files after successful migration.
 */
async function cleanupV1(
  storage: ProjectStorage,
  sceneFiles: string[],
  storyboardFiles: string[],
  charFiles: string[],
): Promise<void> {
  const deletes: Promise<void>[] = [];

  // Delete V1 scene files
  for (const f of sceneFiles) {
    deletes.push(storage.delete(`scenes/${f}`).catch(() => {}));
  }

  // Delete V1 storyboard files
  for (const f of storyboardFiles) {
    deletes.push(storage.delete(`storyboard/${f}`).catch(() => {}));
  }

  // Delete V1 character files (scene maps only, keep index for legacy compat)
  for (const f of charFiles) {
    if (f !== "index.json") {
      deletes.push(storage.delete(`characters/${f}`).catch(() => {}));
    }
  }

  await Promise.all(deletes);

  // Try to remove empty V1 directories
  try { await storage.delete("scenes"); } catch {}
  try { await storage.delete("storyboard"); } catch {}
  // Keep characters/ and structure/ for legacy backward compat
}

/**
 * Ensure project is on V2 layout, migrating if needed.
 * Call during project bootstrap.
 */
export async function ensureV2Layout(storage: ProjectStorage): Promise<void> {
  const version = await detectLayoutVersion(storage);
  if (version === "v2") {
    setActiveLayout("v2");
    // Ensure scene index is loaded into memory
    const { readSceneIndex } = await import("@/lib/sceneIndex");
    await readSceneIndex(storage);
    return;
  }

  // Check if project has any data to migrate
  const hasScenes = await storage.listDir("scenes").catch(() => []);
  if (hasScenes.length === 0) {
    // Empty project — just mark as V2
    setActiveLayout("v2");
    try {
      const meta = await storage.readJSON<Record<string, unknown>>("project.json");
      if (meta) {
        meta.layoutVersion = 2;
        await storage.writeJSON("project.json", meta);
      }
    } catch {}
    return;
  }

  await migrateV1toV2(storage);
}
