/**
 * Local-first character persistence layer (V2 layout).
 * characters.json (root) + chapters/{chapterId}/scenes/{sceneId}/characters.json
 *
 * Handles migration from legacy structure/characters.json (LocalCharacter[]).
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import type {
  CharacterIndex,
  CharacterAppearance,
  SceneCharacterMap,
  LocalCharacter,
  CharacterVoiceConfig,
  TocChapter,
} from "@/pages/parser/types";
import { touchProjectUpdatedAt } from "@/lib/projectActivity";
import { paths } from "@/lib/projectPaths";
import { markCharacterMapped, getCachedSceneIndex } from "@/lib/sceneIndex";

// ─── Read / Write helpers ────────────────────────────────────

export async function readCharacterIndex(
  storage: ProjectStorage,
): Promise<CharacterIndex[]> {
  try {
    // Try current location
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
    await markCharacterMapped(storage, map.sceneId);
    await touchProjectUpdatedAt(storage);
  } catch (err) {
    console.warn("[localCharacters] Failed to save scene character map:", err);
  }
}

/**
 * List all scene character map IDs using scene index.
 */
export async function listSceneCharacterMaps(
  storage: ProjectStorage,
): Promise<string[]> {
  const index = getCachedSceneIndex();
  if (index) {
    return index.characterMapped.map(sid => `scene_${sid}.json`);
  }
  return [];
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

/**
 * Count total segment appearances per character across all scenes.
 */
export async function countSegmentAppearances(
  storage: ProjectStorage,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const index = getCachedSceneIndex();

  if (index) {
    const reads = index.characterMapped.map(async (sceneId) => {
      try {
        const map = await storage.readJSON<SceneCharacterMap>(
          paths.sceneCharacterMap(sceneId),
        );
        if (map) {
          for (const s of map.speakers) {
            counts.set(s.characterId, (counts.get(s.characterId) ?? 0) + s.segment_ids.length);
          }
        }
      } catch { /* skip */ }
    });
    await Promise.all(reads);
  }

  return counts;
}

/**
 * Rebuild appearances for characters from scene index + scene character maps.
 */
export async function rebuildAppearancesFromLocal(
  storage: ProjectStorage,
  characters: CharacterIndex[],
): Promise<CharacterIndex[]> {
  const index = getCachedSceneIndex();
  if (!index) return characters;

  // Load TOC for chapter titles
  let tocTitles: string[] = [];
  try {
    const toc = await storage.readJSON<TocChapter[]>(paths.structureToc());
    if (toc) tocTitles = toc.map(t => t.title);
  } catch { /* ignore */ }

  // Build: characterId → Map<chapterIdx, Set<sceneNumber>>
  const charAppMap = new Map<string, Map<number, Set<number>>>();
  const charSceneCount = new Map<string, number>();

  const mappedSceneIds = index.characterMapped || [];
  const reads = mappedSceneIds.map(async (sceneId) => {
    const entry = index.entries[sceneId];
    if (!entry) return;

    try {
      const map = await storage.readJSON<SceneCharacterMap>(
        paths.sceneCharacterMap(sceneId),
      );
      if (!map) return;

      for (const s of map.speakers) {
        charSceneCount.set(s.characterId, (charSceneCount.get(s.characterId) || 0) + 1);

        let chapterMap = charAppMap.get(s.characterId);
        if (!chapterMap) {
          chapterMap = new Map();
          charAppMap.set(s.characterId, chapterMap);
        }
        let scenes = chapterMap.get(entry.chapterIndex);
        if (!scenes) {
          scenes = new Set();
          chapterMap.set(entry.chapterIndex, scenes);
        }
        scenes.add(entry.sceneNumber);
      }
    } catch { /* skip */ }
  });
  await Promise.all(reads);

  return characters.map(c => {
    const chapterMap = charAppMap.get(c.id);
    if (!chapterMap) return { ...c, appearances: [], sceneCount: charSceneCount.get(c.id) || 0 };

    const appearances: CharacterAppearance[] = [];
    for (const [chIdx, sceneNums] of Array.from(chapterMap.entries()).sort((a, b) => a[0] - b[0])) {
      appearances.push({
        chapterIdx: chIdx,
        chapterTitle: tocTitles[chIdx] || `Chapter ${chIdx + 1}`,
        sceneNumbers: Array.from(sceneNums).sort((a, b) => a - b),
      });
    }
    return { ...c, appearances, sceneCount: charSceneCount.get(c.id) || 0 };
  });
}



export function buildNameLookup(
  characters: CharacterIndex[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of characters) {
    map.set(c.name.toLowerCase(), c.id);
    for (const alias of c.aliases) {
      if (alias) map.set(alias.toLowerCase(), c.id);
    }
  }
  return map;
}

export function findCharacterByNameOrAlias(
  characters: CharacterIndex[],
  name: string,
): CharacterIndex | undefined {
  const lower = name.toLowerCase();
  return characters.find(c =>
    c.name.toLowerCase() === lower ||
    c.aliases.some(a => a.toLowerCase() === lower)
  );
}

// ─── Migration: LocalCharacter → CharacterIndex ──────────────

export function migrateLocalCharacter(c: LocalCharacter): CharacterIndex {
  return {
    id: c.id,
    name: c.name,
    aliases: c.aliases || [],
    gender: c.gender || "unknown",
    role: c.role,
    age_group: c.profile?.age_group || "unknown",
    temperament: c.profile?.temperament || null,
    speech_style: c.profile?.speech_style || null,
    description: c.profile?.description || null,
    speech_tags: c.profile?.speech_tags || [],
    psycho_tags: c.profile?.psycho_tags || [],
    sort_order: 0,
    color: null,
    age_hint: c.age_hint,
    manner_hint: c.manner_hint,
    extractedBy: c.extractedBy,
    textConfirmed: c.textConfirmed,
    profile: c.profile,
    appearances: c.appearances || [],
    sceneCount: c.sceneCount || 0,
    voice_config: {},
  };
}

/**
 * Convert CharacterIndex back to legacy LocalCharacter for backward compat.
 */
export function toLegacyCharacter(c: CharacterIndex): LocalCharacter {
  return {
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    gender: c.gender,
    role: c.role,
    age_hint: c.age_hint,
    manner_hint: c.manner_hint,
    appearances: c.appearances || [],
    sceneCount: c.sceneCount || 0,
    extractedBy: c.extractedBy,
    textConfirmed: c.textConfirmed,
    profile: c.profile || {
      age_group: c.age_group,
      temperament: c.temperament || undefined,
      speech_style: c.speech_style || undefined,
      description: c.description || undefined,
      speech_tags: c.speech_tags,
      psycho_tags: c.psycho_tags,
    },
  };
}

// ─── Upsert speakers from storyboard segments ────────────────

interface SegmentLike {
  segment_id?: string;
  segment_type: string;
  speaker?: string | null;
}

const SPEAKING_TYPES = new Set(["dialogue", "monologue", "first_person", "telephone"]);
const SYSTEM_DEFS = [
  { names: ["Рассказчик", "Narrator"], types: ["narrator", "epigraph", "lyric"], sort_order: -2, desc: "Third-person narration voice" },
  { names: ["Комментатор", "Commentator"], types: ["footnote"], sort_order: -1, desc: "Footnote and commentary voice" },
];

/**
 * After segmentation: upsert new speakers into index + build scene map.
 */
export async function upsertSpeakersFromSegments(
  storage: ProjectStorage,
  sceneId: string,
  segments: SegmentLike[],
  existingIndex: CharacterIndex[],
  currentTypeMappings?: Array<{ segmentType: string; characterId: string }>,
): Promise<CharacterIndex[]> {
  const updatedIndex = [...existingIndex];

  const speakerSegments = new Map<string, string[]>();
  for (const seg of segments) {
    if (seg.speaker?.trim()) {
      const name = seg.speaker.trim();
      const ids = speakerSegments.get(name) || [];
      if (seg.segment_id) ids.push(seg.segment_id);
      speakerSegments.set(name, ids);
    }
  }

  for (const [name] of speakerSegments) {
    if (!findCharacterByNameOrAlias(updatedIndex, name)) {
      updatedIndex.push({
        id: crypto.randomUUID(),
        name,
        aliases: [],
        gender: "unknown",
        age_group: "unknown",
        sort_order: 0,
        speech_tags: [],
        psycho_tags: [],
        appearances: [],
        sceneCount: 0,
        voice_config: {},
      });
    }
  }

  for (const sys of SYSTEM_DEFS) {
    const hasType = segments.some(seg => sys.types.includes(seg.segment_type));
    if (!hasType) continue;
    const exists = updatedIndex.some(c =>
      sys.names.some(n => n.toLowerCase() === c.name.toLowerCase())
    );
    if (!exists) {
      updatedIndex.push({
        id: crypto.randomUUID(),
        name: sys.names[0],
        aliases: [],
        gender: "male",
        age_group: "adult",
        sort_order: sys.sort_order,
        description: sys.desc,
        speech_tags: [],
        psycho_tags: [],
        appearances: [],
        sceneCount: 0,
        voice_config: {},
      });
    }
  }

  const nameLookup = buildNameLookup(updatedIndex);
  const speakers: SceneCharacterMap["speakers"] = [];

  for (const [name, segIds] of speakerSegments) {
    const charId = nameLookup.get(name.toLowerCase());
    if (charId) {
      speakers.push({ characterId: charId, role_in_scene: "speaker", segment_ids: segIds });
    }
  }

  for (const sys of SYSTEM_DEFS) {
    const matchingSegIds = segments
      .filter(seg => sys.types.includes(seg.segment_type))
      .map(seg => seg.segment_id)
      .filter(Boolean) as string[];
    if (matchingSegIds.length === 0) continue;
    const sysChar = updatedIndex.find(c =>
      sys.names.some(n => n.toLowerCase() === c.name.toLowerCase())
    );
    if (sysChar) {
      speakers.push({ characterId: sysChar.id, role_in_scene: "system", segment_ids: matchingSegIds });
    }
  }

  const typeMappings: SceneCharacterMap["typeMappings"] = currentTypeMappings
    ? currentTypeMappings.map(m => ({ segmentType: m.segmentType, characterId: m.characterId }))
    : [];

  const sceneMap: SceneCharacterMap = {
    sceneId,
    updatedAt: new Date().toISOString(),
    speakers,
    typeMappings,
  };

  await Promise.all([
    saveCharacterIndex(storage, updatedIndex),
    saveSceneCharacterMap(storage, sceneMap),
  ]);

  return updatedIndex;
}
