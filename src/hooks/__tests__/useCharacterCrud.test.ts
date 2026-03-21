import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCharacterCrud } from "@/hooks/useCharacterCrud";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { CharacterIndex } from "@/pages/parser/types";

vi.mock("@/lib/localCharacters", () => ({
  saveCharacterIndex: vi.fn(),
}));

import { saveCharacterIndex } from "@/lib/localCharacters";
const mockSave = vi.mocked(saveCharacterIndex);

const makeChar = (id: string, name: string, extra?: Partial<CharacterIndex>): CharacterIndex => ({
  id, name, aliases: [], gender: "unknown", age_group: "unknown",
  sort_order: 0, speech_tags: [], psycho_tags: [],
  appearances: [], sceneCount: 0, voice_config: {},
  ...extra,
});

const fakeStorage = { writeJSON: vi.fn(), readJSON: vi.fn() } as unknown as ProjectStorage;

beforeEach(() => vi.clearAllMocks());

function setup(initial: CharacterIndex[] = [makeChar("c1", "Анна"), makeChar("c2", "Иван")]) {
  let chars = initial;
  const setChars: React.Dispatch<React.SetStateAction<CharacterIndex[]>> = (action) => {
    chars = typeof action === "function" ? action(chars) : action;
  };
  const hook = renderHook(() => useCharacterCrud(fakeStorage, chars, setChars));
  return { hook, getChars: () => chars };
}

describe("useCharacterCrud", () => {
  it("renameCharacter updates name and persists", async () => {
    const { hook, getChars } = setup();
    await act(() => hook.result.current.renameCharacter("c1", "Ольга"));
    expect(getChars().find(c => c.id === "c1")?.name).toBe("Ольга");
    expect(mockSave).toHaveBeenCalledWith(fakeStorage, expect.arrayContaining([
      expect.objectContaining({ id: "c1", name: "Ольга" }),
    ]));
  });

  it("updateGender updates gender and persists", async () => {
    const { hook, getChars } = setup();
    await act(() => hook.result.current.updateGender("c2", "male"));
    expect(getChars().find(c => c.id === "c2")?.gender).toBe("male");
    expect(mockSave).toHaveBeenCalled();
  });

  it("updateAliases replaces aliases and persists", async () => {
    const { hook, getChars } = setup();
    await act(() => hook.result.current.updateAliases("c1", ["Аня", "Аннушка"]));
    expect(getChars().find(c => c.id === "c1")?.aliases).toEqual(["Аня", "Аннушка"]);
    expect(mockSave).toHaveBeenCalled();
  });

  it("deleteCharacter removes character and persists", async () => {
    const { hook, getChars } = setup();
    await act(() => hook.result.current.deleteCharacter("c1"));
    expect(getChars()).toHaveLength(1);
    expect(getChars()[0].name).toBe("Иван");
    expect(mockSave).toHaveBeenCalled();
  });

  it("addCharacter appends new character with generated ID", async () => {
    const { hook, getChars } = setup();
    let added: CharacterIndex | undefined;
    await act(async () => { added = await hook.result.current.addCharacter("Маша"); });
    expect(getChars()).toHaveLength(3);
    expect(added?.name).toBe("Маша");
    expect(added?.id).toBeTruthy();
    expect(mockSave).toHaveBeenCalled();
  });

  it("mergeCharacters combines source into target", async () => {
    const anna = makeChar("c1", "Анна", {
      aliases: ["Аня"], gender: "female",
      appearances: [{ chapterIdx: 0, chapterTitle: "Гл.1", sceneNumbers: [1, 2] }],
    });
    const ivan = makeChar("c2", "Иван", {
      gender: "unknown",
      appearances: [{ chapterIdx: 0, chapterTitle: "Гл.1", sceneNumbers: [2, 3] }],
    });

    const { hook, getChars } = setup([anna, ivan]);

    // Merge ivan (source) into anna (target)
    await act(() => hook.result.current.mergeCharacters("c2", "c1"));

    const result = getChars();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Анна");
    expect(result[0].aliases).toContain("Иван");
    expect(result[0].aliases).toContain("Аня");
    // Gender should keep target's value (female)
    expect(result[0].gender).toBe("female");
    // Appearances merged: scenes [1,2,3] in chapter 0
    expect(result[0].appearances[0].sceneNumbers).toEqual([1, 2, 3]);
    expect(mockSave).toHaveBeenCalled();
  });

  it("mergeCharacters inherits source gender when target is unknown", async () => {
    const a = makeChar("c1", "А", { gender: "unknown" });
    const b = makeChar("c2", "Б", { gender: "male" });

    const { hook, getChars } = setup([a, b]);
    await act(() => hook.result.current.mergeCharacters("c2", "c1"));

    expect(getChars()[0].gender).toBe("male");
  });

  it("mergeCharacters is no-op for missing IDs", async () => {
    const { hook, getChars } = setup();
    await act(() => hook.result.current.mergeCharacters("nonexistent", "c1"));
    expect(getChars()).toHaveLength(2);
  });

  it("persist is no-op when storage is null", async () => {
    let chars = [makeChar("c1", "Test")];
    const setChars: React.Dispatch<React.SetStateAction<CharacterIndex[]>> = (a) => {
      chars = typeof a === "function" ? a(chars) : a;
    };
    const { result } = renderHook(() => useCharacterCrud(null, chars, setChars));
    await act(() => result.current.persist(chars));
    expect(mockSave).not.toHaveBeenCalled();
  });
});
