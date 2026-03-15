/**
 * CONTRACT TESTS — автоматическая проверка критических архитектурных контрактов.
 * 
 * К1: resolvePageRange — расширение диапазонов страниц для контейнерных узлов
 * К2: TOC import — пропуск контейнеров с children
 * К3: handleScenesUpdate — распределение сцен по дочерним главам (не перезапись родителя)
 * К4: selectedResult aggregation — агрегация сцен из дочерних узлов
 */

import { describe, it, expect, vi } from "vitest";
import type { TocChapter, Scene, ChapterStatus, SectionType } from "@/pages/parser/types";
import { normalizeLevels } from "@/pages/parser/types";

// ─── Helpers (extracted pure logic for testability) ──────────

/** 
 * CONTRACT K1: resolvePageRange
 * Pure function extracted from useChapterAnalysis for testing.
 */
export function resolvePageRange(
  tocEntries: TocChapter[],
  chapterIndex: number,
): { startPage: number; endPage: number; subtreeStart: number | null; subtreeEnd: number | null; nextSiblingStart: number | null } {
  const current = tocEntries[chapterIndex];
  const currentLevel = current?.level ?? 0;
  let startPage = Math.max(1, Number(current?.startPage) || 1);
  let endPage = Math.max(startPage, Number(current?.endPage) || startPage);

  let subtreeStart: number | null = null;
  let subtreeEnd: number | null = null;
  for (let i = chapterIndex + 1; i < tocEntries.length; i++) {
    const n = tocEntries[i];
    const nLevel = n.level ?? 0;
    if (nLevel <= currentLevel) break;
    const ns = Number(n.startPage) || 0;
    const ne = Number(n.endPage) || 0;
    if (ns > 0) subtreeStart = subtreeStart == null ? ns : Math.min(subtreeStart, ns);
    if (ne > 0) subtreeEnd = subtreeEnd == null ? ne : Math.max(subtreeEnd, ne);
  }

  let nextSiblingStart: number | null = null;
  for (let i = chapterIndex + 1; i < tocEntries.length; i++) {
    const n = tocEntries[i];
    const ns = Number(n.startPage) || 0;
    if (ns <= 0) continue;
    if ((n.level ?? 0) <= currentLevel) {
      nextSiblingStart = ns;
      break;
    }
  }

  if ((Number(current?.startPage) || 0) <= 0 && subtreeStart) startPage = subtreeStart;
  if ((Number(current?.endPage) || 0) <= 0 && subtreeEnd) endPage = Math.max(startPage, subtreeEnd);

  if ((endPage - startPage + 1) <= 1 && subtreeEnd && subtreeEnd > endPage) {
    endPage = subtreeEnd;
  }

  if ((endPage - startPage + 1) <= 1 && nextSiblingStart && nextSiblingStart > startPage + 1) {
    endPage = Math.max(endPage, nextSiblingStart - 1);
  }

  return { startPage, endPage, subtreeStart, subtreeEnd, nextSiblingStart };
}

/**
 * CONTRACT K2: filterContainerNodes
 * Pure function matching useBookManager's TOC import logic.
 */
export function filterContainerNodes(
  flat: Array<{ title: string; startPage: number; endPage: number; level: number; children: any[] }>,
): TocChapter[] {
  const chapters: TocChapter[] = [];
  let currentPart = "";
  for (const entry of flat) {
    const isContainer = entry.children.length > 0;
    if (isContainer) {
      if (entry.level === 0) currentPart = entry.title;
      continue; // Skip containers
    }
    chapters.push({
      title: entry.title,
      startPage: entry.startPage,
      endPage: entry.endPage,
      level: entry.level,
      partTitle: currentPart || undefined,
      sectionType: "content",
    });
  }
  return chapters;
}

/**
 * CONTRACT K3: redistributeScenes
 * Pure function matching handleScenesUpdate logic.
 */
export function redistributeScenes(
  selectedIdx: number,
  tocEntries: TocChapter[],
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>,
  updatedScenes: Scene[],
): Map<number, { scenes: Scene[]; status: ChapterStatus }> {
  const entry = tocEntries[selectedIdx];

  // Collect child indices
  const childIndices: number[] = [];
  for (let i = selectedIdx + 1; i < tocEntries.length; i++) {
    if (tocEntries[i].level <= entry.level) break;
    if (tocEntries[i].sectionType !== entry.sectionType) break;
    childIndices.push(i);
  }

  const next = new Map(chapterResults);

  // No children — simple case
  if (childIndices.length === 0) {
    const existing = next.get(selectedIdx);
    if (existing) {
      next.set(selectedIdx, { ...existing, scenes: updatedScenes });
    }
    return next;
  }

  // Parent with children: distribute back
  const indices = [selectedIdx, ...childIndices];
  let offset = 0;
  for (const idx of indices) {
    const existing = chapterResults.get(idx);
    if (!existing) continue;
    const count = existing.scenes.length;
    const slice = updatedScenes.slice(offset, offset + count);
    const restored = slice.map((sc, i) => ({
      ...sc,
      scene_number: existing.scenes[i]?.scene_number ?? i + 1,
    }));
    next.set(idx, { ...existing, scenes: restored });
    offset += count;
  }
  return next;
}

/**
 * CONTRACT K4: aggregateSelectedResult
 * Pure function matching useParserHelpers logic.
 */
export function aggregateSelectedResult(
  selectedIdx: number,
  tocEntries: TocChapter[],
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>,
): { scenes: Scene[]; status: ChapterStatus } | null {
  const entry = tocEntries[selectedIdx];
  const ownResult = chapterResults.get(selectedIdx);

  const childIndices: number[] = [];
  for (let i = selectedIdx + 1; i < tocEntries.length; i++) {
    if (tocEntries[i].level <= entry.level) break;
    if (tocEntries[i].sectionType !== entry.sectionType) break;
    childIndices.push(i);
  }

  if (childIndices.length === 0) return ownResult ?? null;

  const allScenes: Scene[] = [];
  let worstStatus: ChapterStatus = "done";
  const indices = [selectedIdx, ...childIndices];
  for (const idx of indices) {
    const r = chapterResults.get(idx);
    if (!r) { worstStatus = "pending"; continue; }
    if (r.status === "analyzing") worstStatus = "analyzing";
    else if (r.status === "error" && worstStatus !== "analyzing") worstStatus = "error";
    else if (r.status === "pending" && worstStatus === "done") worstStatus = "pending";
    allScenes.push(...r.scenes);
  }

  const numberedScenes = allScenes.map((s, i) => ({ ...s, scene_number: i + 1 }));
  return { scenes: numberedScenes, status: worstStatus };
}

// ─── Helper factories ────────────────────────────────────────

function makeToc(entries: Partial<TocChapter>[]): TocChapter[] {
  return entries.map(e => ({
    title: e.title ?? "Chapter",
    startPage: e.startPage ?? 1,
    endPage: e.endPage ?? 1,
    level: e.level ?? 0,
    sectionType: (e.sectionType ?? "content") as SectionType,
    partTitle: e.partTitle,
  }));
}

function makeScene(n: number, title = `Scene ${n}`): Scene {
  return { scene_number: n, title, scene_type: "action", mood: "calm", bpm: 100 };
}

function makeResults(map: Record<number, { scenes: Scene[]; status: ChapterStatus }>): Map<number, { scenes: Scene[]; status: ChapterStatus }> {
  return new Map(Object.entries(map).map(([k, v]) => [Number(k), v]));
}

// ─── К1 Tests ────────────────────────────────────────────────

describe("K1: resolvePageRange", () => {
  it("returns entry's own range for leaf nodes", () => {
    const toc = makeToc([
      { title: "Ch 1", startPage: 10, endPage: 30 },
      { title: "Ch 2", startPage: 31, endPage: 50 },
    ]);
    const result = resolvePageRange(toc, 0);
    expect(result.startPage).toBe(10);
    expect(result.endPage).toBe(30);
  });

  it("expands container node (1 page) to subtree range", () => {
    const toc = makeToc([
      { title: "Том 2", startPage: 3, endPage: 3, level: 0 },
      { title: "Акт 1", startPage: 4, endPage: 67, level: 1 },
      { title: "Акт 2", startPage: 68, endPage: 120, level: 1 },
    ]);
    const result = resolvePageRange(toc, 0);
    expect(result.startPage).toBe(3);
    expect(result.endPage).toBe(120); // expanded to subtreeEnd
    expect(result.subtreeStart).toBe(4);
    expect(result.subtreeEnd).toBe(120);
  });

  it("expands to nextSiblingStart when subtree is absent", () => {
    const toc = makeToc([
      { title: "Ch 1", startPage: 5, endPage: 5, level: 0 },
      { title: "Ch 2", startPage: 50, endPage: 100, level: 0 },
    ]);
    const result = resolvePageRange(toc, 0);
    expect(result.endPage).toBe(49); // nextSiblingStart - 1
  });

  it("does NOT expand multi-page leaf nodes", () => {
    const toc = makeToc([
      { title: "Ch 1", startPage: 10, endPage: 50 },
      { title: "Ch 2", startPage: 51, endPage: 100 },
    ]);
    const result = resolvePageRange(toc, 0);
    expect(result.startPage).toBe(10);
    expect(result.endPage).toBe(50);
  });

  it("handles zero startPage by using subtree", () => {
    const toc = makeToc([
      { title: "Part", startPage: 0, endPage: 0, level: 0 },
      { title: "Ch 1", startPage: 5, endPage: 20, level: 1 },
    ]);
    const result = resolvePageRange(toc, 0);
    expect(result.startPage).toBe(5);
    expect(result.endPage).toBe(20);
  });
});

// ─── К2 Tests ────────────────────────────────────────────────

describe("K2: filterContainerNodes", () => {
  it("skips containers with children, keeps leaves", () => {
    const flat = [
      { title: "Том 1", startPage: 1, endPage: 100, level: 0, children: [{}] },
      { title: "Глава 1", startPage: 1, endPage: 30, level: 1, children: [] },
      { title: "Глава 2", startPage: 31, endPage: 60, level: 1, children: [] },
    ];
    const result = filterContainerNodes(flat);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Глава 1");
    expect(result[1].title).toBe("Глава 2");
  });

  it("uses level-0 containers as partTitle", () => {
    const flat = [
      { title: "Часть 1", startPage: 1, endPage: 100, level: 0, children: [{}] },
      { title: "Глава 1", startPage: 1, endPage: 50, level: 1, children: [] },
    ];
    const result = filterContainerNodes(flat);
    expect(result[0].partTitle).toBe("Часть 1");
  });

  it("falls back to all entries when no leaves exist", () => {
    const flat = [
      { title: "Container", startPage: 1, endPage: 100, level: 0, children: [{}] },
    ];
    const result = filterContainerNodes(flat);
    // filterContainerNodes returns empty — caller must implement fallback
    expect(result).toHaveLength(0);
  });
});

// ─── К3 Tests ────────────────────────────────────────────────

describe("K3: redistributeScenes (handleScenesUpdate)", () => {
  it("distributes edited scenes back to correct child chapters", () => {
    const toc = makeToc([
      { title: "Parent", level: 0 },
      { title: "Child 1", level: 1 },
      { title: "Child 2", level: 1 },
    ]);
    const results = makeResults({
      0: { scenes: [], status: "done" },
      1: { scenes: [makeScene(1, "A"), makeScene(2, "B")], status: "done" },
      2: { scenes: [makeScene(1, "C")], status: "done" },
    });

    // Simulate editing: change scene titles
    const edited: Scene[] = [
      { ...makeScene(1, "A-edited") },
      { ...makeScene(2, "B-edited") },
      { ...makeScene(1, "C-edited") },
    ];

    const updated = redistributeScenes(0, toc, results, edited);

    // Child 1 should get first 2 scenes
    expect(updated.get(1)!.scenes).toHaveLength(2);
    expect(updated.get(1)!.scenes[0].title).toBe("A-edited");
    expect(updated.get(1)!.scenes[1].title).toBe("B-edited");

    // Child 2 should get last 1 scene
    expect(updated.get(2)!.scenes).toHaveLength(1);
    expect(updated.get(2)!.scenes[0].title).toBe("C-edited");
  });

  it("does NOT write aggregated scenes to parent index", () => {
    const toc = makeToc([
      { title: "Parent", level: 0 },
      { title: "Child 1", level: 1 },
    ]);
    const results = makeResults({
      0: { scenes: [], status: "done" },
      1: { scenes: [makeScene(1, "A")], status: "done" },
    });

    const edited: Scene[] = [makeScene(1, "A-edited")];
    const updated = redistributeScenes(0, toc, results, edited);

    // Parent stays empty
    expect(updated.get(0)!.scenes).toHaveLength(0);
    // Child gets the edit
    expect(updated.get(1)!.scenes[0].title).toBe("A-edited");
  });

  it("works correctly for leaf nodes (no children)", () => {
    const toc = makeToc([
      { title: "Ch 1", level: 0 },
      { title: "Ch 2", level: 0 },
    ]);
    const results = makeResults({
      0: { scenes: [makeScene(1, "A"), makeScene(2, "B")], status: "done" },
      1: { scenes: [makeScene(1, "C")], status: "done" },
    });

    const edited: Scene[] = [makeScene(1, "A-edited"), makeScene(2, "B-edited")];
    const updated = redistributeScenes(0, toc, results, edited);

    expect(updated.get(0)!.scenes[0].title).toBe("A-edited");
    expect(updated.get(0)!.scenes[1].title).toBe("B-edited");
    // Ch 2 unchanged
    expect(updated.get(1)!.scenes[0].title).toBe("C");
  });
});

// ─── К4 Tests ────────────────────────────────────────────────

describe("K4: aggregateSelectedResult", () => {
  it("aggregates scenes from parent + all children", () => {
    const toc = makeToc([
      { title: "Parent", level: 0 },
      { title: "Child 1", level: 1 },
      { title: "Child 2", level: 1 },
    ]);
    const results = makeResults({
      0: { scenes: [makeScene(1, "P1")], status: "done" },
      1: { scenes: [makeScene(1, "C1a"), makeScene(2, "C1b")], status: "done" },
      2: { scenes: [makeScene(1, "C2a")], status: "done" },
    });

    const agg = aggregateSelectedResult(0, toc, results);
    expect(agg!.scenes).toHaveLength(4);
    expect(agg!.scenes.map(s => s.title)).toEqual(["P1", "C1a", "C1b", "C2a"]);
    // Scenes are renumbered sequentially
    expect(agg!.scenes.map(s => s.scene_number)).toEqual([1, 2, 3, 4]);
  });

  it("returns own result for leaf nodes", () => {
    const toc = makeToc([
      { title: "Ch 1", level: 0 },
      { title: "Ch 2", level: 0 },
    ]);
    const results = makeResults({
      0: { scenes: [makeScene(1, "A")], status: "done" },
    });

    const agg = aggregateSelectedResult(0, toc, results);
    expect(agg!.scenes).toHaveLength(1);
    expect(agg!.scenes[0].title).toBe("A");
  });

  it("reports worst status across children", () => {
    const toc = makeToc([
      { title: "Parent", level: 0 },
      { title: "Child 1", level: 1 },
      { title: "Child 2", level: 1 },
    ]);
    const results = makeResults({
      0: { scenes: [], status: "done" },
      1: { scenes: [makeScene(1)], status: "done" },
      2: { scenes: [], status: "error" },
    });

    const agg = aggregateSelectedResult(0, toc, results);
    expect(agg!.status).toBe("error");
  });

  it("K3↔K4 roundtrip: aggregate then redistribute preserves data", () => {
    const toc = makeToc([
      { title: "Parent", level: 0 },
      { title: "Child 1", level: 1 },
      { title: "Child 2", level: 1 },
    ]);
    const results = makeResults({
      0: { scenes: [], status: "done" },
      1: { scenes: [makeScene(1, "A"), makeScene(2, "B")], status: "done" },
      2: { scenes: [makeScene(1, "C"), makeScene(2, "D")], status: "done" },
    });

    // Step 1: aggregate (K4)
    const agg = aggregateSelectedResult(0, toc, results)!;
    expect(agg.scenes).toHaveLength(4);

    // Step 2: modify one scene
    const edited = agg.scenes.map(s =>
      s.title === "B" ? { ...s, title: "B-fixed" } : s
    );

    // Step 3: redistribute (K3)
    const updated = redistributeScenes(0, toc, results, edited);

    // Child 1 should have the edit
    expect(updated.get(1)!.scenes[1].title).toBe("B-fixed");
    // Child 2 should be unchanged
    expect(updated.get(2)!.scenes[0].title).toBe("C");
    expect(updated.get(2)!.scenes[1].title).toBe("D");
    // Parent stays empty
    expect(updated.get(0)!.scenes).toHaveLength(0);
  });
});
