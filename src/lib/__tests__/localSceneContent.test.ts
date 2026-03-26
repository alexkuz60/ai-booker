import { beforeEach, describe, expect, it } from "vitest";
import type { ProjectStorage } from "@/lib/projectStorage";
import { readSceneContentFromLocal } from "@/lib/localSceneContent";
import { setCachedSceneIndex } from "@/lib/sceneIndex";

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
      const prefix = path.endsWith("/") ? path : `${path}/`;
      return Object.keys(data)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length).split("/")[0])
        .filter((v, i, a) => a.indexOf(v) === i);
    },
    async exportZip() { return new Blob(); },
    async importZip() {},
  };
}

beforeEach(() => {
  setCachedSceneIndex(null);
});

describe("readSceneContentFromLocal", () => {
  it("returns the exact scene by sceneId", async () => {
    const storage = createMockStorage();
    storage._data["chapters/ch-1/content.json"] = {
      chapterId: "ch-1",
      chapterIndex: 0,
      status: "done",
      scenes: [
        { id: "s1", scene_number: 1, title: "One", content: "Первый текст сцены." },
        { id: "s2", scene_number: 2, title: "Two", content: "Второй текст сцены, отличный от первого." },
      ],
    };

    const result = await readSceneContentFromLocal(storage, {
      sceneId: "s2",
      chapterId: "ch-1",
      sceneNumber: 2,
      title: "Two",
    });

    expect(result?.content).toContain("Второй текст");
    expect(result?.sceneNumber).toBe(2);
  });

  it("falls back to exact sceneNumber inside the same chapter when sceneId is stale", async () => {
    const storage = createMockStorage();
    storage._data["chapters/ch-1/content.json"] = {
      chapterId: "ch-1",
      chapterIndex: 0,
      status: "done",
      scenes: [
        { id: "s1", scene_number: 1, title: "One", content: "Первый текст сцены." },
        { id: "s3", scene_number: 3, title: "Three", content: "Третий текст сцены, который нельзя подменять первым." },
      ],
    };

    const result = await readSceneContentFromLocal(storage, {
      sceneId: "stale-id",
      chapterId: "ch-1",
      sceneNumber: 3,
      title: "Three",
    });

    expect(result?.content).toContain("Третий текст");
    expect(result?.sceneNumber).toBe(3);
  });

  it("returns null instead of fuzzy-matching another scene when sceneId is stale and no safe fallback exists", async () => {
    const storage = createMockStorage();
    storage._data["chapters/ch-1/content.json"] = {
      chapterId: "ch-1",
      chapterIndex: 0,
      status: "done",
      scenes: [
        { id: "s1", scene_number: 1, title: "Scene", content: "Первый текст сцены." },
        { id: "s2", scene_number: 2, title: "Scene", content: "Второй текст сцены." },
      ],
    };

    const result = await readSceneContentFromLocal(storage, {
      sceneId: "stale-id",
      chapterId: "ch-1",
      title: "Scene",
    });

    expect(result).toBeNull();
  });
});
