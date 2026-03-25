import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { CharacterIndex, SceneCharacterMap, LocalCharacter } from "@/pages/parser/types";
import {
  readCharacterIndex,
  saveCharacterIndex,
  readSceneCharacterMap,
  saveSceneCharacterMap,
  getSceneCharacterIds,
  getChapterCharacterIds,
  countSegmentAppearances,
  buildNameLookup,
  findCharacterByNameOrAlias,
  migrateLocalCharacter,
  toLegacyCharacter,
  upsertSpeakersFromSegments,
  listSceneCharacterMaps,
} from "@/lib/localCharacters";
import { setCachedSceneIndex, type SceneIndexData } from "@/lib/sceneIndex";

// Set up a mock scene index for V2 tests
beforeEach(() => {
  setCachedSceneIndex(null);
});

// ─── In-memory ProjectStorage mock (V2 layout) ─────────────

function createMockStorage(): ProjectStorage & { _data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};

  return {
    _data: data,
    projectName: "TestProject",
    isReady: true,
    async readJSON<T>(path: string): Promise<T | null> {
      return (data[path] as T) ?? null;
    },
    async writeJSON(path: string, value: unknown) {
      data[path] = value;
    },
    async readBlob() { return null; },
    async writeBlob() {},
    async exists(path: string) { return path in data; },
    async delete(path: string) { delete data[path]; },
    async listDir(path: string) {
      const prefix = path.endsWith("/") ? path : path + "/";
      return Object.keys(data)
        .filter(k => k.startsWith(prefix))
        .map(k => k.slice(prefix.length).split("/")[0])
        .filter((v, i, a) => a.indexOf(v) === i);
    },
    async exportZip() { return new Blob(); },
    async importZip() {},
  };
}

// ─── Test fixtures ──────────────────────────────────────────

const makeChar = (overrides: Partial<CharacterIndex> & { id: string; name: string }): CharacterIndex => ({
  aliases: [],
  gender: "unknown",
  age_group: "unknown",
  sort_order: 0,
  speech_tags: [],
  psycho_tags: [],
  appearances: [],
  sceneCount: 0,
  voice_config: {},
  ...overrides,
});

const charAnna = makeChar({ id: "c1", name: "Анна", gender: "female", aliases: ["Аня", "Аннушка"] });
const charIvan = makeChar({ id: "c2", name: "Иван", gender: "male" });

// Helper to set up a scene index with character mappings for tests
function setupSceneIndex(sceneIds: string[], characterMapped: string[] = []) {
  const entries: Record<string, any> = {};
  for (const sid of sceneIds) {
    entries[sid] = { chapterId: "ch-1", chapterIndex: 0, sceneNumber: 1, contentHash: 0 };
  }
  setCachedSceneIndex({
    version: 2,
    updatedAt: new Date().toISOString(),
    entries,
    storyboarded: [],
    characterMapped,
  });
}

// ─── Tests ──────────────────────────────────────────────────

describe("localCharacters — CRUD", () => {
  it("saveCharacterIndex writes both new and legacy formats", async () => {
    const storage = createMockStorage();
    await saveCharacterIndex(storage, [charAnna, charIvan]);

    expect(storage._data["characters.json"]).toHaveLength(2);
    expect(storage._data["structure/characters.json"]).toHaveLength(2);
  });

  it("readCharacterIndex reads from characters.json", async () => {
    const storage = createMockStorage();
    storage._data["characters.json"] = [charAnna];

    const result = await readCharacterIndex(storage);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Анна");
  });

  it("readCharacterIndex migrates legacy format when characters.json is absent", async () => {
    const storage = createMockStorage();
    const legacy: LocalCharacter[] = [{
      id: "legacy-1",
      name: "Пётр",
      aliases: ["Петя"],
      gender: "male",
      appearances: [{ chapterIdx: 0, chapterTitle: "Гл. 1", sceneNumbers: [1] }],
      sceneCount: 1,
      profile: { age_group: "adult", temperament: "cold", speech_tags: ["#тихо"] },
    }];
    storage._data["structure/characters.json"] = legacy;

    const result = await readCharacterIndex(storage);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Пётр");
    expect(result[0].age_group).toBe("adult");
    expect(result[0].temperament).toBe("cold");
    // Verify it also persisted the migrated index
    expect(storage._data["characters.json"]).toHaveLength(1);
  });

  it("readCharacterIndex returns [] when both sources are empty", async () => {
    const storage = createMockStorage();
    const result = await readCharacterIndex(storage);
    expect(result).toEqual([]);
  });
});

describe("localCharacters — scene character maps", () => {
  it("saveSceneCharacterMap / readSceneCharacterMap roundtrip", async () => {
    const storage = createMockStorage();
    setupSceneIndex(["s1"]);
    const map: SceneCharacterMap = {
      sceneId: "s1",
      updatedAt: new Date().toISOString(),
      speakers: [
        { characterId: "c1", role_in_scene: "speaker", segment_ids: ["seg1", "seg2"] },
      ],
      typeMappings: [],
    };

    await saveSceneCharacterMap(storage, map);
    const loaded = await readSceneCharacterMap(storage, "s1");

    expect(loaded).not.toBeNull();
    expect(loaded!.speakers[0].characterId).toBe("c1");
    expect(loaded!.speakers[0].segment_ids).toHaveLength(2);
  });

  it("getSceneCharacterIds returns character IDs from a scene map", async () => {
    const storage = createMockStorage();
    setupSceneIndex(["s1"]);
    storage._data["chapters/ch-1/scenes/s1/characters.json"] = {
      sceneId: "s1",
      updatedAt: "",
      speakers: [
        { characterId: "c1", role_in_scene: "speaker", segment_ids: ["seg1"] },
        { characterId: "c2", role_in_scene: "system", segment_ids: ["seg2"] },
      ],
      typeMappings: [],
    } satisfies SceneCharacterMap;

    const ids = await getSceneCharacterIds(storage, "s1");
    expect(ids.size).toBe(2);
    expect(ids.has("c1")).toBe(true);
    expect(ids.has("c2")).toBe(true);
  });

  it("getSceneCharacterIds returns empty set for missing scene", async () => {
    const storage = createMockStorage();
    const ids = await getSceneCharacterIds(storage, "nonexistent");
    expect(ids.size).toBe(0);
  });

  it("getChapterCharacterIds aggregates across scenes", async () => {
    const storage = createMockStorage();
    setupSceneIndex(["s1", "s2"]);
    storage._data["chapters/ch-1/scenes/s1/characters.json"] = {
      sceneId: "s1", updatedAt: "",
      speakers: [{ characterId: "c1", role_in_scene: "speaker", segment_ids: ["seg1"] }],
      typeMappings: [],
    } satisfies SceneCharacterMap;
    storage._data["chapters/ch-1/scenes/s2/characters.json"] = {
      sceneId: "s2", updatedAt: "",
      speakers: [{ characterId: "c2", role_in_scene: "speaker", segment_ids: ["seg3"] }],
      typeMappings: [],
    } satisfies SceneCharacterMap;

    const ids = await getChapterCharacterIds(storage, ["s1", "s2"]);
    expect(ids.size).toBe(2);
    expect(ids.has("c1")).toBe(true);
    expect(ids.has("c2")).toBe(true);
  });
});

describe("localCharacters — countSegmentAppearances", () => {
  it("counts segment appearances across all scene maps", async () => {
    const storage = createMockStorage();
    setupSceneIndex(["s1", "s2"], ["s1", "s2"]);
    storage._data["chapters/ch-1/scenes/s1/characters.json"] = {
      sceneId: "s1", updatedAt: "",
      speakers: [
        { characterId: "c1", role_in_scene: "speaker", segment_ids: ["seg1", "seg2"] },
        { characterId: "c2", role_in_scene: "speaker", segment_ids: ["seg3"] },
      ],
      typeMappings: [],
    } satisfies SceneCharacterMap;
    storage._data["chapters/ch-1/scenes/s2/characters.json"] = {
      sceneId: "s2", updatedAt: "",
      speakers: [
        { characterId: "c1", role_in_scene: "speaker", segment_ids: ["seg4"] },
      ],
      typeMappings: [],
    } satisfies SceneCharacterMap;

    const counts = await countSegmentAppearances(storage);
    expect(counts.get("c1")).toBe(3); // 2 + 1
    expect(counts.get("c2")).toBe(1);
  });
});

describe("localCharacters — lookup helpers", () => {
  it("buildNameLookup maps names and aliases to character IDs", () => {
    const lookup = buildNameLookup([charAnna, charIvan]);
    expect(lookup.get("анна")).toBe("c1");
    expect(lookup.get("аня")).toBe("c1");
    expect(lookup.get("аннушка")).toBe("c1");
    expect(lookup.get("иван")).toBe("c2");
  });

  it("findCharacterByNameOrAlias finds by alias (case-insensitive)", () => {
    const found = findCharacterByNameOrAlias([charAnna, charIvan], "АНЯ");
    expect(found).toBeDefined();
    expect(found!.id).toBe("c1");
  });

  it("findCharacterByNameOrAlias returns undefined for unknown name", () => {
    const found = findCharacterByNameOrAlias([charAnna], "Ольга");
    expect(found).toBeUndefined();
  });
});

describe("localCharacters — migration", () => {
  it("migrateLocalCharacter converts legacy to CharacterIndex", () => {
    const legacy: LocalCharacter = {
      id: "l1",
      name: "Маша",
      aliases: ["Мария"],
      gender: "female",
      appearances: [],
      sceneCount: 2,
      profile: { age_group: "teen", temperament: "hot", speech_style: "quick", speech_tags: ["#крик"], psycho_tags: ["#импульсивный"] },
    };

    const migrated = migrateLocalCharacter(legacy);
    expect(migrated.id).toBe("l1");
    expect(migrated.age_group).toBe("teen");
    expect(migrated.temperament).toBe("hot");
    expect(migrated.speech_tags).toEqual(["#крик"]);
    expect(migrated.voice_config).toEqual({});
  });

  it("toLegacyCharacter roundtrips through migration", () => {
    const legacy: LocalCharacter = {
      id: "l2",
      name: "Дима",
      aliases: [],
      gender: "male",
      appearances: [{ chapterIdx: 0, chapterTitle: "Intro", sceneNumbers: [1, 2] }],
      sceneCount: 1,
    };

    const migrated = migrateLocalCharacter(legacy);
    const back = toLegacyCharacter(migrated);

    expect(back.id).toBe("l2");
    expect(back.name).toBe("Дима");
    expect(back.appearances).toHaveLength(1);
    expect(back.gender).toBe("male");
  });
});

describe("localCharacters — upsertSpeakersFromSegments", () => {
  it("creates new speakers and system characters from segments", async () => {
    const storage = createMockStorage();
    setupSceneIndex(["scene-1"]);
    const segments = [
      { segment_id: "seg1", segment_type: "dialogue", speaker: "Лена" },
      { segment_id: "seg2", segment_type: "narrator", speaker: null },
      { segment_id: "seg3", segment_type: "dialogue", speaker: "Миша" },
    ];

    const result = await upsertSpeakersFromSegments(storage, "scene-1", segments, []);

    expect(result.length).toBe(3);
    expect(result.find(c => c.name === "Лена")).toBeDefined();
    expect(result.find(c => c.name === "Миша")).toBeDefined();
    expect(result.find(c => c.name === "Рассказчик")).toBeDefined();

    const map = storage._data["chapters/ch-1/scenes/scene-1/characters.json"] as SceneCharacterMap;
    expect(map).toBeDefined();
    expect(map.speakers.length).toBe(3);
  });

  it("does not duplicate existing characters", async () => {
    const storage = createMockStorage();
    setupSceneIndex(["scene-2"]);
    const existing = [makeChar({ id: "existing-1", name: "Лена" })];
    const segments = [
      { segment_id: "seg1", segment_type: "dialogue", speaker: "Лена" },
    ];

    const result = await upsertSpeakersFromSegments(storage, "scene-2", segments, existing);
    const lenas = result.filter(c => c.name === "Лена");
    expect(lenas).toHaveLength(1);
    expect(lenas[0].id).toBe("existing-1");
  });

  it("finds existing characters by alias", async () => {
    const storage = createMockStorage();
    setupSceneIndex(["scene-3"]);
    const existing = [makeChar({ id: "c-anna", name: "Анна", aliases: ["Аня"] })];
    const segments = [
      { segment_id: "seg1", segment_type: "dialogue", speaker: "Аня" },
    ];

    const result = await upsertSpeakersFromSegments(storage, "scene-3", segments, existing);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Анна");
  });
});
