/**
 * Local-first character persistence layer.
 * Reads/writes characters/index.json and characters/scene_{id}.json.
 * Handles migration from legacy structure/characters.json (LocalCharacter[]).
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import type {
  CharacterIndex,
  SceneCharacterMap,
  LocalCharacter,
  CharacterVoiceConfig,
} from "@/pages/parser/types";
import { touchProjectUpdatedAt } from "@/lib/projectActivity";
import { paths } from "@/lib/projectPaths";

// ─── Read / Write helpers ────────────────────────────────────

export async function readCharacterIndex(
  storage: ProjectStorage,
): Promise<CharacterIndex[]> {
  try {
    // Try new location first
    const data = await storage.readJSON<CharacterIndex[]>(paths.characterIndex());
    if (data && data.length > 0) return data;

    // Migrate from legacy format
    const legacy = await storage.readJSON<LocalCharacter[]>(paths.structureCharactersLegacy());
    if (legacy && legacy.length > 0) {
      const migrated = legacy.map(migrateLocalCharacter);
      await saveCharacterIndex(storage, migrated);
      console.debug(`[localCharacters] Migrated ${migrated.length} characters from legacy format`);
      return migrated;
    }

    return [];
  } catch {
    return [];
  }
}

export async function saveCharacterIndex(
  storage: ProjectStorage,
  characters: CharacterIndex[],
): Promise<void> {
  try {
    await storage.writeJSON(paths.characterIndex(), characters);
    // Also write legacy format for backward compatibility with Parser hooks
    const legacy = characters.map(toLegacyCharacter);
    await storage.writeJSON(paths.structureCharactersLegacy(), legacy);
    await touchProjectUpdatedAt(storage);
    console.debug(`[localCharacters] Saved ${characters.length} characters`);
  } catch (err) {
    console.warn("[localCharacters] Failed to save characters:", err);
  }
}

export async function readSceneCharacterMap(
  storage: ProjectStorage,
  sceneId: string,
): Promise<SceneCharacterMap | null> {
  try {
    return await storage.readJSON<SceneCharacterMap>(paths.sceneCharacterMap(sceneId));
  } catch {
    return null;
  }
}

export async function saveSceneCharacterMap(
  storage: ProjectStorage,
  map: SceneCharacterMap,
): Promise<void> {
  try {
    await storage.writeJSON(paths.sceneCharacterMap(map.sceneId), map);
    await touchProjectUpdatedAt(storage);
  } catch (err) {
    console.warn("[localCharacters] Failed to save scene character map:", err);
  }
}

/**
 * List all scene character map files to compute aggregate data.
 */
export async function listSceneCharacterMaps(
  storage: ProjectStorage,
): Promise<string[]> {
  try {
    const dir = paths.characterDir();
    if (!dir) return []; // V2: need different approach
    const files = await storage.listDir(dir);
    return files.filter(f => f.startsWith("scene_") && f.endsWith(".json"));
  } catch {
    return [];
  }
}

/**
 * Get character IDs that appear in a specific scene.
 */
export async function getSceneCharacterIds(
  storage: ProjectStorage,
  sceneId: string,
): Promise<Set<string>> {
  const map = await readSceneCharacterMap(storage, sceneId);
  if (!map) return new Set();
  return new Set(map.speakers.map(s => s.characterId));
}

/**
 * Get character IDs across multiple scenes (e.g. all scenes in a chapter).
 */
export async function getChapterCharacterIds(
  storage: ProjectStorage,
  sceneIds: string[],
): Promise<Set<string>> {
  const ids = new Set<string>();
  const reads = sceneIds.map(async (sid) => {
    const map = await readSceneCharacterMap(storage, sid);
    if (map) {
      for (const s of map.speakers) ids.add(s.characterId);
    }
  });
  await Promise.all(reads);
  return ids;
}
