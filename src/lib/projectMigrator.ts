/**
 * projectMigrator — ensures project is on V2 layout and scene index is loaded.
 *
 * V1 migration code has been removed. All projects are assumed to be V2.
 */

import type { ProjectStorage } from "@/lib/projectStorage";

/**
 * Ensure project is on V2 layout and scene index is loaded.
 * Call during project bootstrap.
 */
export async function ensureV2Layout(storage: ProjectStorage): Promise<void> {
  // Ensure scene index is loaded into memory
  const { readSceneIndex } = await import("@/lib/sceneIndex");
  await readSceneIndex(storage);
}
