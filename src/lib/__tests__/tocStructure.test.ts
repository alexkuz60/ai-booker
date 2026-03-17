import { describe, it, expect } from "vitest";
import {
  isFolderNode,
  getLeafIndices,
  getLeafChapterIds,
  resolveEntryPageRange,
  normalizeTocRanges,
  sanitizeChapterResultsForStructure,
} from "@/lib/tocStructure";
import type { TocChapter } from "@/pages/parser/types";

// ─── Fixtures ────────────────────────────────────────────

const flat: TocChapter[] = [
  { title: "Ch 1", startPage: 1, endPage: 10, level: 0, sectionType: "content" },
  { title: "Ch 2", startPage: 11, endPage: 20, level: 0, sectionType: "content" },
  { title: "Ch 3", startPage: 21, endPage: 30, level: 0, sectionType: "content" },
];

const nested: TocChapter[] = [
  { title: "Part 1", startPage: 1, endPage: 50, level: 0, sectionType: "content" },
  { title: "Ch 1",   startPage: 1, endPage: 20, level: 1, sectionType: "content" },
  { title: "Ch 2",   startPage: 21, endPage: 50, level: 1, sectionType: "content" },
  { title: "Part 2", startPage: 51, endPage: 100, level: 0, sectionType: "content" },
  { title: "Ch 3",   startPage: 51, endPage: 100, level: 1, sectionType: "content" },
];

// ─── isFolderNode ────────────────────────────────────────

describe("isFolderNode", () => {
  it("returns false for flat chapters", () => {
    expect(isFolderNode(flat, 0)).toBe(false);
    expect(isFolderNode(flat, 1)).toBe(false);
    expect(isFolderNode(flat, 2)).toBe(false);
  });

  it("returns true for Part nodes with children", () => {
    expect(isFolderNode(nested, 0)).toBe(true); // Part 1 → Ch 1
    expect(isFolderNode(nested, 3)).toBe(true); // Part 2 → Ch 3
  });

  it("returns false for leaf chapters inside parts", () => {
    expect(isFolderNode(nested, 1)).toBe(false); // Ch 1
    expect(isFolderNode(nested, 2)).toBe(false); // Ch 2
    expect(isFolderNode(nested, 4)).toBe(false); // Ch 3
  });

  it("returns false for last entry", () => {
    expect(isFolderNode(flat, flat.length - 1)).toBe(false);
  });

  it("returns false for out of bounds", () => {
    expect(isFolderNode(flat, 99)).toBe(false);
  });
});

// ─── getLeafIndices / getLeafChapterIds ──────────────────

describe("getLeafIndices", () => {
  it("returns all indices for flat TOC", () => {
    expect(getLeafIndices(flat)).toEqual([0, 1, 2]);
  });

  it("skips folder nodes", () => {
    expect(getLeafIndices(nested)).toEqual([1, 2, 4]);
  });
});

describe("getLeafChapterIds", () => {
  it("returns IDs only for leaf chapters", () => {
    const idMap = new Map<number, string>([
      [0, "part-1"],
      [1, "ch-1"],
      [2, "ch-2"],
      [3, "part-2"],
      [4, "ch-3"],
    ]);
    expect(getLeafChapterIds(nested, idMap)).toEqual(["ch-1", "ch-2", "ch-3"]);
  });

  it("skips missing IDs", () => {
    const idMap = new Map<number, string>([[1, "ch-1"]]);
    expect(getLeafChapterIds(nested, idMap)).toEqual(["ch-1"]);
  });
});

// ─── resolveEntryPageRange ───────────────────────────────

describe("resolveEntryPageRange", () => {
  it("uses next sibling start - 1 as endPage", () => {
    const range = resolveEntryPageRange(flat, 0);
    expect(range.startPage).toBe(1);
    expect(range.endPage).toBe(10); // next sibling starts at 11
  });

  it("respects totalPages for last entry", () => {
    const range = resolveEntryPageRange(flat, 2, 25);
    expect(range.endPage).toBe(25);
  });

  it("folder node range covers subtree", () => {
    const range = resolveEntryPageRange(nested, 0);
    expect(range.startPage).toBe(1);
    expect(range.endPage).toBe(50); // next sibling (Part 2) starts at 51
    expect(range.subtreeStart).toBe(1);
    expect(range.subtreeEnd).toBe(50);
  });

  it("ensures endPage >= startPage", () => {
    const toc: TocChapter[] = [
      { title: "A", startPage: 10, endPage: 5, level: 0, sectionType: "content" },
    ];
    const range = resolveEntryPageRange(toc, 0);
    expect(range.endPage).toBeGreaterThanOrEqual(range.startPage);
  });

  it("handles invalid page numbers gracefully", () => {
    const toc: TocChapter[] = [
      { title: "Bad", startPage: -1, endPage: 0, level: 0, sectionType: "content" },
    ];
    const range = resolveEntryPageRange(toc, 0);
    expect(range.startPage).toBeGreaterThan(0);
    expect(range.endPage).toBeGreaterThanOrEqual(range.startPage);
  });
});

// ─── normalizeTocRanges ──────────────────────────────────

describe("normalizeTocRanges", () => {
  it("makes ranges contiguous", () => {
    const result = normalizeTocRanges(flat, 30);
    expect(result[0].endPage).toBe(10);
    expect(result[1].startPage).toBe(11);
    expect(result[1].endPage).toBe(20);
    expect(result[2].endPage).toBe(30);
  });
});

// ─── sanitizeChapterResultsForStructure ──────────────────

describe("sanitizeChapterResultsForStructure", () => {
  it("sets folder nodes to pending with empty scenes", () => {
    const results = new Map([[0, { scenes: [{ scene_number: 1, title: "S", scene_type: "a", mood: "b", bpm: 100 }], status: "done" as const }]]);
    const sanitized = sanitizeChapterResultsForStructure(nested, results);
    expect(sanitized.get(0)?.status).toBe("pending");
    expect(sanitized.get(0)?.scenes).toEqual([]);
  });

  it("preserves leaf chapter results", () => {
    const scene = { scene_number: 1, title: "S1", scene_type: "action", mood: "tense", bpm: 120 };
    const results = new Map([[1, { scenes: [scene], status: "done" as const }]]);
    const sanitized = sanitizeChapterResultsForStructure(nested, results);
    expect(sanitized.get(1)?.status).toBe("done");
    expect(sanitized.get(1)?.scenes.length).toBe(1);
  });

  it("fills missing chapters with pending", () => {
    const sanitized = sanitizeChapterResultsForStructure(nested, new Map());
    for (let i = 0; i < nested.length; i++) {
      expect(sanitized.get(i)?.status).toBe("pending");
    }
  });
});
