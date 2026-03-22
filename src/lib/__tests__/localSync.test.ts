import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncStructureToLocal, readStructureFromLocal } from "@/lib/localSync";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { TocChapter, Scene } from "@/pages/parser/types";
import { setActiveLayout } from "@/lib/projectPaths";

beforeEach(() => { setActiveLayout("v1"); });

/** Minimal in-memory mock of ProjectStorage */
function createMockStorage(): ProjectStorage & { _data: Record<string, unknown> } {
  const data: Record<string, unknown> = {
    "project.json": { version: 1, bookId: "b1", title: "Test", userId: "u1", createdAt: "", updatedAt: "", language: "en" },
  };

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

const sampleToc: TocChapter[] = [
  { title: "Part 1", startPage: 1, endPage: 10, level: 0, sectionType: "content" },
  { title: "Chapter 1", startPage: 1, endPage: 5, level: 1, sectionType: "content" },
  { title: "Chapter 2", startPage: 6, endPage: 10, level: 1, sectionType: "content" },
];

const sampleScenes: Scene[] = [
  { scene_number: 1, title: "Scene 1", scene_type: "action", mood: "tense", bpm: 120 },
];

describe("localSync roundtrip", () => {
  it("syncStructureToLocal → readStructureFromLocal preserves data", async () => {
    const storage = createMockStorage();

    const chapterIdMap = new Map<number, string>();
    chapterIdMap.set(1, "ch-1");
    chapterIdMap.set(2, "ch-2");

    const chapterResults = new Map<number, { scenes: Scene[]; status: "done" }>();
    chapterResults.set(1, { scenes: sampleScenes, status: "done" as const });

    await syncStructureToLocal(storage, {
      bookId: "b1",
      title: "Test Book",
      fileName: "test.pdf",
      toc: sampleToc,
      parts: [{ id: "p1", title: "Part 1", partNumber: 1 }],
      chapterIdMap,
      chapterResults,
    });

    // Verify structure was written
    const result = await readStructureFromLocal(storage);
    expect(result).not.toBeNull();
    expect(result!.structure!.bookId).toBe("b1");
    expect(result!.structure!.toc.length).toBe(3);
    expect(result!.chapterIdMap.get(1)).toBe("ch-1");
    expect(result!.chapterResults.get(1)?.scenes.length).toBe(1);
    expect(result!.chapterResults.get(1)?.status).toBe("done");
  });

  it("updates project.json updatedAt", async () => {
    const storage = createMockStorage();
    const before = (storage._data["project.json"] as any).updatedAt;

    await syncStructureToLocal(storage, {
      bookId: "b1",
      title: "Test",
      fileName: "test.pdf",
      toc: sampleToc,
      parts: [],
      chapterIdMap: new Map([[1, "ch-1"]]),
      chapterResults: new Map(),
    });

    const after = (storage._data["project.json"] as any).updatedAt;
    expect(after).not.toBe(before);
  });

  it("skips folder nodes (level 0 with children at level 1)", async () => {
    const storage = createMockStorage();

    // Index 0 is a folder (Part 1), indices 1 and 2 are leaves
    const chapterIdMap = new Map<number, string>();
    chapterIdMap.set(0, "part-1");
    chapterIdMap.set(1, "ch-1");
    chapterIdMap.set(2, "ch-2");

    const chapterResults = new Map<number, { scenes: Scene[]; status: "done" }>();
    chapterResults.set(0, { scenes: [], status: "done" as const }); // folder — should be skipped
    chapterResults.set(1, { scenes: sampleScenes, status: "done" as const });

    await syncStructureToLocal(storage, {
      bookId: "b1",
      title: "Test",
      fileName: "test.pdf",
      toc: sampleToc,
      parts: [],
      chapterIdMap,
      chapterResults,
    });

    // Only leaf chapter should have scenes saved
    const result = await readStructureFromLocal(storage);
    expect(result!.chapterResults.has(1)).toBe(true);
    // Folder node (index 0) should not have scenes file
    expect(storage._data["scenes/chapter_0.json"]).toBeUndefined();
  });
});
