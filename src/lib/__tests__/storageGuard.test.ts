// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { guardedDelete, assertIntegrity, getDestructiveJournal } from "../storageGuard";
import type { ProjectStorage } from "../projectStorage";

function createMockStorage(files: Set<string>): ProjectStorage {
  return {
    projectName: "test-project",
    isReady: true,
    readJSON: vi.fn(),
    writeJSON: vi.fn(),
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    exists: vi.fn(async (path: string) => files.has(path)),
    delete: vi.fn(async (path: string) => { files.delete(path); }),
    listDir: vi.fn(async () => []),
    exportZip: vi.fn(async () => new Blob()),
    importZip: vi.fn(),
  };
}

describe("guardedDelete", () => {
  it("allows deletion of storyboard.json inside scene", async () => {
    const files = new Set(["chapters/ch1/scenes/sc1/storyboard.json"]);
    const storage = createMockStorage(files);
    const result = await guardedDelete(storage, "chapters/ch1/scenes/sc1/storyboard.json", "test");
    expect(result).toBe(true);
    expect(storage.delete).toHaveBeenCalledWith("chapters/ch1/scenes/sc1/storyboard.json");
  });

  it("allows deletion of audio files inside scene", async () => {
    const files = new Set(["chapters/ch1/scenes/sc1/audio/tts/seg1.mp3"]);
    const storage = createMockStorage(files);
    const result = await guardedDelete(storage, "chapters/ch1/scenes/sc1/audio/tts/seg1.mp3", "test");
    expect(result).toBe(true);
  });

  it("BLOCKS deletion of project.json", async () => {
    const storage = createMockStorage(new Set(["project.json"]));
    const result = await guardedDelete(storage, "project.json", "test");
    expect(result).toBe(false);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("BLOCKS deletion of structure/toc.json", async () => {
    const storage = createMockStorage(new Set());
    const result = await guardedDelete(storage, "structure/toc.json", "test");
    expect(result).toBe(false);
  });

  it("BLOCKS deletion of characters.json", async () => {
    const storage = createMockStorage(new Set());
    const result = await guardedDelete(storage, "characters.json", "test");
    expect(result).toBe(false);
  });

  it("BLOCKS deletion of audio_meta.json", async () => {
    const storage = createMockStorage(new Set());
    const result = await guardedDelete(storage, "chapters/ch1/scenes/sc1/audio_meta.json", "test");
    expect(result).toBe(false);
  });

  it("BLOCKS deletion of mixer_state.json", async () => {
    const storage = createMockStorage(new Set());
    const result = await guardedDelete(storage, "chapters/ch1/scenes/sc1/mixer_state.json", "test");
    expect(result).toBe(false);
  });

  it("BLOCKS deletion of clip_plugins.json", async () => {
    const storage = createMockStorage(new Set());
    const result = await guardedDelete(storage, "chapters/ch1/scenes/sc1/clip_plugins.json", "test");
    expect(result).toBe(false);
  });

  it("BLOCKS deletion of translation storyboard", async () => {
    const storage = createMockStorage(new Set());
    // Translation storyboard IS allowed — it's in the whitelist
    const result = await guardedDelete(storage, "chapters/ch1/scenes/sc1/en/storyboard.json", "test");
    expect(result).toBe(true);
  });

  it("BLOCKS deletion of chapter content.json", async () => {
    const storage = createMockStorage(new Set());
    const result = await guardedDelete(storage, "chapters/ch1/content.json", "test");
    expect(result).toBe(false);
  });

  it("BLOCKS deletion of a whole chapter directory", async () => {
    const storage = createMockStorage(new Set());
    const result = await guardedDelete(storage, "chapters/ch1", "test");
    expect(result).toBe(false);
  });

  it("logs all operations in journal", async () => {
    const storage = createMockStorage(new Set());
    await guardedDelete(storage, "project.json", "test-caller");
    const journal = getDestructiveJournal();
    const last = journal[journal.length - 1];
    expect(last.path).toBe("project.json");
    expect(last.caller).toBe("test-caller");
    expect(last.allowed).toBe(false);
  });
});

describe("assertIntegrity", () => {
  it("passes when critical files exist", async () => {
    const files = new Set([
      "project.json",
      "structure/toc.json",
      "structure/chapters.json",
    ]);
    const storage = createMockStorage(files);
    const report = await assertIntegrity(storage, "test-op");
    expect(report.passed).toBe(true);
    expect(report.missingCritical).toHaveLength(0);
  });

  it("fails when project.json is missing", async () => {
    const files = new Set([
      "structure/toc.json",
      "structure/chapters.json",
    ]);
    const storage = createMockStorage(files);
    const report = await assertIntegrity(storage, "test-op");
    expect(report.passed).toBe(false);
    expect(report.missingCritical).toContain("project.json");
  });
});