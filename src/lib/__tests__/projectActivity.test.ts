import { describe, expect, it } from "vitest";
import type { ProjectStorage } from "@/lib/projectStorage";
import { getProjectActivityMs } from "@/lib/projectActivity";

function createMockStorage(data: Record<string, unknown>): ProjectStorage {
  return {
    projectName: "Test Project",
    isReady: true,
    readJSON: async <T>(path: string) => (path in data ? (data[path] as T) : null),
    writeJSON: async () => {},
    readBlob: async () => null,
    writeBlob: async () => {},
    exists: async (path: string) => path in data,
    delete: async () => {},
    listDir: async (path: string) => {
      const prefix = path ? `${path.replace(/\/+$/, "")}/` : "";
      const items = new Set<string>();
      for (const key of Object.keys(data)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const first = rest.split("/")[0];
        if (first) items.add(first);
      }
      return [...items];
    },
    exportZip: async () => new Blob(),
    importZip: async () => {},
  } as ProjectStorage;
}

describe("getProjectActivityMs", () => {
  it("prefers nested translation and synopsis timestamps over stale project meta", async () => {
    const storage = createMockStorage({
      "project.json": { updatedAt: "2026-04-03T10:00:00.000Z" },
      "structure/toc.json": { updatedAt: "2026-04-03T10:05:00.000Z" },
      "scene_index.json": {
        entries: { scene1: { chapterId: "chapter1" } },
        storyboarded: ["scene1"],
      },
      "chapters/chapter1/scenes/scene1/en/radar-critique.json": {
        updatedAt: "2026-04-03T12:00:00.000Z",
      },
      "synopsis/book-meta.json": { updatedAt: "2026-04-03T13:00:00.000Z" },
    });

    expect(await getProjectActivityMs(storage)).toBe(
      new Date("2026-04-03T13:00:00.000Z").getTime(),
    );
  });
});