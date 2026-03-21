import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useLocalCharacters } from "@/hooks/useLocalCharacters";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { CharacterIndex, SceneCharacterMap } from "@/pages/parser/types";

// ─── Mock localCharacters module ────────────────────────────

vi.mock("@/lib/localCharacters", () => ({
  readCharacterIndex: vi.fn(),
  saveCharacterIndex: vi.fn(),
  readSceneCharacterMap: vi.fn(),
  saveSceneCharacterMap: vi.fn(),
  getSceneCharacterIds: vi.fn(),
  getChapterCharacterIds: vi.fn(),
  countSegmentAppearances: vi.fn(),
  buildNameLookup: vi.fn(),
  findCharacterByNameOrAlias: vi.fn(),
}));

import {
  readCharacterIndex,
  saveCharacterIndex,
  readSceneCharacterMap,
  getSceneCharacterIds,
  getChapterCharacterIds,
  countSegmentAppearances,
  buildNameLookup,
  findCharacterByNameOrAlias,
} from "@/lib/localCharacters";

const mockReadIndex = vi.mocked(readCharacterIndex);
const mockSaveIndex = vi.mocked(saveCharacterIndex);
const mockReadSceneMap = vi.mocked(readSceneCharacterMap);
const mockGetSceneIds = vi.mocked(getSceneCharacterIds);
const mockGetChapterIds = vi.mocked(getChapterCharacterIds);
const mockCountAppearances = vi.mocked(countSegmentAppearances);
const mockBuildNameLookup = vi.mocked(buildNameLookup);
const mockFindByName = vi.mocked(findCharacterByNameOrAlias);

// ─── Fixtures ───────────────────────────────────────────────

const makeChar = (id: string, name: string): CharacterIndex => ({
  id, name, aliases: [], gender: "unknown", age_group: "unknown",
  sort_order: 0, speech_tags: [], psycho_tags: [],
  appearances: [], sceneCount: 0, voice_config: {},
});

const anna = makeChar("c1", "Анна");
const ivan = makeChar("c2", "Иван");

const fakeStorage = {
  projectName: "Test", isReady: true,
  readJSON: vi.fn(), writeJSON: vi.fn(), readBlob: vi.fn(),
  writeBlob: vi.fn(), exists: vi.fn(), delete: vi.fn(),
  listDir: vi.fn(), exportZip: vi.fn(), importZip: vi.fn(),
} as unknown as ProjectStorage;

// ─── Setup ──────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockReadIndex.mockResolvedValue([anna, ivan]);
  mockCountAppearances.mockResolvedValue(new Map([["c1", 5], ["c2", 2]]));
  mockGetSceneIds.mockResolvedValue(new Set(["c1"]));
  mockGetChapterIds.mockResolvedValue(new Set(["c1", "c2"]));
  mockReadSceneMap.mockResolvedValue(null);
  mockBuildNameLookup.mockReturnValue(new Map([["анна", "c1"], ["иван", "c2"]]));
  mockFindByName.mockReturnValue(undefined);
});

// ─── Tests ──────────────────────────────────────────────────

describe("useLocalCharacters", () => {
  it("loads characters on mount when storage and bookId provided", async () => {
    const { result } = renderHook(() =>
      useLocalCharacters(fakeStorage, "book-1"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockReadIndex).toHaveBeenCalledWith(fakeStorage);
    expect(result.current.characters).toHaveLength(2);
    expect(result.current.characters[0].name).toBe("Анна");
  });

  it("returns empty state when storage is null", async () => {
    const { result } = renderHook(() =>
      useLocalCharacters(null, "book-1"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.characters).toHaveLength(0);
    expect(mockReadIndex).not.toHaveBeenCalled();
  });

  it("returns empty state when bookId is null", async () => {
    const { result } = renderHook(() =>
      useLocalCharacters(fakeStorage, null),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.characters).toHaveLength(0);
  });

  it("loads segment counts alongside characters", async () => {
    const { result } = renderHook(() =>
      useLocalCharacters(fakeStorage, "book-1"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.segmentCounts.get("c1")).toBe(5);
    expect(result.current.segmentCounts.get("c2")).toBe(2);
  });

  it("loads scene character IDs when sceneId provided", async () => {
    const { result } = renderHook(() =>
      useLocalCharacters(fakeStorage, "book-1", "scene-1"),
    );

    await waitFor(() => expect(result.current.characters).toHaveLength(2));
    await waitFor(() => expect(result.current.sceneCharIds.size).toBeGreaterThan(0));

    expect(mockGetSceneIds).toHaveBeenCalledWith(fakeStorage, "scene-1");
    expect(result.current.sceneCharIds.has("c1")).toBe(true);
  });

  it("loads chapter character IDs when chapterSceneIds provided", async () => {
    const { result } = renderHook(() =>
      useLocalCharacters(fakeStorage, "book-1", null, ["s1", "s2"]),
    );

    await waitFor(() => expect(result.current.characters).toHaveLength(2));
    await waitFor(() => expect(result.current.chapterCharIds.size).toBe(2));

    expect(mockGetChapterIds).toHaveBeenCalledWith(fakeStorage, ["s1", "s2"]);
  });

  it("updateCharacter persists changes via saveCharacterIndex", async () => {
    const { result } = renderHook(() =>
      useLocalCharacters(fakeStorage, "book-1"),
    );

    await waitFor(() => expect(result.current.characters).toHaveLength(2));

    await act(async () => {
      await result.current.updateCharacter("c1", { gender: "female" });
    });

    expect(result.current.characters.find(c => c.id === "c1")?.gender).toBe("female");
    expect(mockSaveIndex).toHaveBeenCalled();
  });

  it("mergeCharacters combines aliases and removes secondary", async () => {
    mockReadIndex.mockResolvedValue([
      { ...anna, aliases: ["Аня"] },
      { ...ivan, aliases: ["Ваня"] },
    ]);

    const { result } = renderHook(() =>
      useLocalCharacters(fakeStorage, "book-1"),
    );

    await waitFor(() => expect(result.current.characters).toHaveLength(2));

    await act(async () => {
      await result.current.mergeCharacters(["c1", "c2"]);
    });

    expect(result.current.characters).toHaveLength(1);
    expect(result.current.characters[0].name).toBe("Анна");
    expect(result.current.characters[0].aliases).toContain("Иван");
    expect(result.current.characters[0].aliases).toContain("Ваня");
    expect(mockSaveIndex).toHaveBeenCalled();
  });

  it("getById returns character by ID", async () => {
    const { result } = renderHook(() =>
      useLocalCharacters(fakeStorage, "book-1"),
    );

    await waitFor(() => expect(result.current.characters).toHaveLength(2));
    expect(result.current.getById("c2")?.name).toBe("Иван");
    expect(result.current.getById("nonexistent")).toBeUndefined();
  });

  it("nameLookup is built from characters", async () => {
    const { result } = renderHook(() =>
      useLocalCharacters(fakeStorage, "book-1"),
    );

    await waitFor(() => expect(result.current.characters).toHaveLength(2));
    expect(mockBuildNameLookup).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: "Анна" }),
    ]));
  });

  it("reloads data when bookId changes", async () => {
    const { result, rerender } = renderHook(
      ({ bookId }) => useLocalCharacters(fakeStorage, bookId),
      { initialProps: { bookId: "book-1" } },
    );

    await waitFor(() => expect(result.current.characters).toHaveLength(2));
    expect(mockReadIndex).toHaveBeenCalledTimes(1);

    rerender({ bookId: "book-2" });

    await waitFor(() => expect(mockReadIndex).toHaveBeenCalledTimes(2));
  });

  it("reload() can be called imperatively", async () => {
    const { result } = renderHook(() =>
      useLocalCharacters(fakeStorage, "book-1"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    mockReadIndex.mockResolvedValue([anna]); // simulate change

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.characters).toHaveLength(1);
  });
});
