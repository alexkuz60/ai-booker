import type { ChapterStatus, Scene, TocChapter } from "@/pages/parser/types";

export interface ChapterResultSnapshot {
  scenes: Scene[];
  status: ChapterStatus;
}

export interface ResolvedPageRange {
  startPage: number;
  endPage: number;
  subtreeStart: number | null;
  subtreeEnd: number | null;
  nextSiblingStart: number | null;
}

export function isFolderNode(tocEntries: TocChapter[], idx: number): boolean {
  const current = tocEntries[idx];
  const next = tocEntries[idx + 1];
  if (!current || !next) return false;
  return next.sectionType === current.sectionType && next.level > current.level;
}

export function getLeafIndices(tocEntries: TocChapter[]): number[] {
  const leaves: number[] = [];
  for (let i = 0; i < tocEntries.length; i++) {
    if (!isFolderNode(tocEntries, i)) leaves.push(i);
  }
  return leaves;
}

function normalizeScene(scene: Scene, fallbackNumber: number): Scene {
  const content = scene.content ?? scene.content_preview ?? "";
  return {
    ...scene,
    scene_number: scene.scene_number || fallbackNumber,
    char_count: scene.char_count ?? content.length,
  };
}

const toPage = (value: unknown, fallback = 1): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
};

/**
 * CONTRACT K1: unified page-range resolver used by analysis AND navigator.
 * Keeps ranges contiguous based on next sibling start, so stale DB end_page values
 * cannot drift from real chapter boundaries.
 */
export function resolveEntryPageRange(
  tocEntries: TocChapter[],
  chapterIndex: number,
  totalPages?: number,
): ResolvedPageRange {
  const current = tocEntries[chapterIndex];
  const currentLevel = current?.level ?? 0;

  let startPage = toPage(current?.startPage, 1);
  let endPage = Math.max(startPage, toPage(current?.endPage, startPage));

  let subtreeStart: number | null = null;
  let subtreeEnd: number | null = null;
  for (let i = chapterIndex + 1; i < tocEntries.length; i++) {
    const node = tocEntries[i];
    const level = node.level ?? 0;
    if (level <= currentLevel) break;

    const ns = toPage(node.startPage, 0);
    const ne = toPage(node.endPage, 0);
    if (ns > 0) subtreeStart = subtreeStart == null ? ns : Math.min(subtreeStart, ns);
    if (ne > 0) subtreeEnd = subtreeEnd == null ? ne : Math.max(subtreeEnd, ne);
  }

  let nextSiblingStart: number | null = null;
  for (let i = chapterIndex + 1; i < tocEntries.length; i++) {
    const node = tocEntries[i];
    const ns = toPage(node.startPage, 0);
    if (ns <= 0) continue;
    if ((node.level ?? 0) <= currentLevel) {
      nextSiblingStart = ns;
      break;
    }
  }

  if (toPage(current?.startPage, 0) <= 0 && subtreeStart) startPage = subtreeStart;

  if (nextSiblingStart && nextSiblingStart > startPage) {
    endPage = nextSiblingStart - 1;
  } else if (subtreeEnd && subtreeEnd >= startPage) {
    endPage = subtreeEnd;
  }

  if (totalPages && totalPages > 0) {
    endPage = Math.min(endPage, Math.floor(totalPages));
  }

  endPage = Math.max(endPage, startPage);

  return { startPage, endPage, subtreeStart, subtreeEnd, nextSiblingStart };
}

export function normalizeTocRanges(
  tocEntries: TocChapter[],
  totalPages?: number,
): TocChapter[] {
  return tocEntries.map((entry, idx) => {
    const resolved = resolveEntryPageRange(tocEntries, idx, totalPages);
    return {
      ...entry,
      startPage: resolved.startPage,
      endPage: resolved.endPage,
    };
  });
}

export function sanitizeChapterResultsForStructure(
  tocEntries: TocChapter[],
  chapterResults: Map<number, ChapterResultSnapshot>,
): Map<number, ChapterResultSnapshot> {
  const normalized = new Map<number, ChapterResultSnapshot>();

  for (let idx = 0; idx < tocEntries.length; idx++) {
    if (isFolderNode(tocEntries, idx)) {
      normalized.set(idx, { scenes: [], status: "pending" });
      continue;
    }

    const existing = chapterResults.get(idx);
    if (!existing) {
      normalized.set(idx, { scenes: [], status: "pending" });
      continue;
    }

    normalized.set(idx, {
      status: existing.status,
      scenes: (existing.scenes || []).map((scene, i) => normalizeScene(scene, i + 1)),
    });
  }

  return normalized;
}

export function getLeafChapterIds(
  tocEntries: TocChapter[],
  chapterIdMap: Map<number, string>,
): string[] {
  const ids: string[] = [];
  for (const idx of getLeafIndices(tocEntries)) {
    const chapterId = chapterIdMap.get(idx);
    if (chapterId) ids.push(chapterId);
  }
  return ids;
}
