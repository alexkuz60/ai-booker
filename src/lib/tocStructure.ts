import type { ChapterStatus, Scene, TocChapter } from "@/pages/parser/types";

export interface ChapterResultSnapshot {
  scenes: Scene[];
  status: ChapterStatus;
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
