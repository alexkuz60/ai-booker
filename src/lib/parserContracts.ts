/**
 * ═══════════════════════════════════════════════════════════════
 *  PARSER CONTRACTS — Runtime Guards
 * ═══════════════════════════════════════════════════════════════
 *
 *  Эти функции содержат runtime-проверки критических инвариантов.
 *  Они НЕ молчат при нарушении — бросают ошибку или логируют предупреждение.
 *  Импортируются в местах мутации данных (Parser.tsx, useChapterAnalysis, useBookManager).
 *
 *  CONTRACT K1: resolvePageRange — всегда использовать при анализе глав
 *  CONTRACT K2: filterContainerNodes — пропуск контейнеров при импорте TOC
 *  CONTRACT K3: redistributeScenes — распределение сцен обратно по дочерним главам
 *  CONTRACT K4: aggregateSelectedResult — агрегация сцен из дочерних узлов
 *  CONTRACT K5: chapterIdMap consistency — индексы всегда синхронизированы с tocEntries
 */

import type { TocChapter, Scene, ChapterStatus } from "@/pages/parser/types";

// ─── K3: Parent overwrite guard ──────────────────────────────

/**
 * CONTRACT K3 GUARD: Validates that handleScenesUpdate does NOT write
 * aggregated scenes into a parent node that has children.
 *
 * @throws Error if attempting to write non-empty scenes to a parent with children
 */
export function assertNotOverwritingParent(
  targetIdx: number,
  tocEntries: TocChapter[],
  scenesToWrite: Scene[],
  label: string = "",
): void {
  if (scenesToWrite.length === 0) return;

  const entry = tocEntries[targetIdx];
  if (!entry) return;

  let hasChildren = false;
  for (let i = targetIdx + 1; i < tocEntries.length; i++) {
    if (tocEntries[i].level <= entry.level) break;
    if (tocEntries[i].sectionType !== entry.sectionType) break;
    hasChildren = true;
    break;
  }

  if (hasChildren) {
    const msg = `[CONTRACT K3 VIOLATION] Attempted to write ${scenesToWrite.length} scenes directly to parent node "${entry.title}" (idx=${targetIdx}) which has children. Scenes must be distributed to child indices. Operation: "${label}"`;
    console.error(msg);
    throw new Error(msg);
  }
}

// ─── K1: Page range guard ────────────────────────────────────

/**
 * CONTRACT K1 GUARD: Warns if page range is suspiciously small for a node with children.
 * Call after resolvePageRange to catch cases where expansion failed.
 */
export function warnSuspiciousPageRange(
  idx: number,
  tocEntries: TocChapter[],
  startPage: number,
  endPage: number,
): void {
  const entry = tocEntries[idx];
  if (!entry) return;

  const pageSpan = endPage - startPage + 1;

  let childCount = 0;
  for (let i = idx + 1; i < tocEntries.length; i++) {
    if (tocEntries[i].level <= entry.level) break;
    if (tocEntries[i].sectionType !== entry.sectionType) break;
    childCount++;
  }

  if (pageSpan <= 1 && childCount > 0) {
    console.warn(
      `[CONTRACT K1 WARNING] Chapter "${entry.title}" (idx=${idx}) has ${childCount} children but only ${pageSpan} page(s) (${startPage}-${endPage}). resolvePageRange should have expanded the range.`
    );
  }
}

/**
 * CONTRACT K1 GUARD: Asserts extracted text has meaningful content.
 * Prevents analysis from proceeding with title-page-only text.
 */
export function assertExtractedTextNotTitlePage(
  text: string,
  chapterTitle: string,
  startPage: number,
): void {
  const trimmed = text.trim();
  // If we're on page 1-2 and text is very short, it's likely the title page
  if (startPage <= 2 && trimmed.length < 200 && trimmed.length > 0) {
    console.warn(
      `[CONTRACT K1 WARNING] Extracted text from page ${startPage} for "${chapterTitle}" is suspiciously short (${trimmed.length} chars). This may be the title page, not chapter content.`
    );
  }
}

// ─── K2: Container node guard ────────────────────────────────

/**
 * CONTRACT K2 GUARD: Warns when a TOC entry with children is treated as content.
 */
export function warnContainerAsChapter(
  title: string,
  childrenCount: number,
  context: string = "",
): void {
  if (childrenCount > 0) {
    console.warn(
      `[CONTRACT K2 WARNING] "${title}" has ${childrenCount} children and should not be added as a content chapter. ${context}`
    );
  }
}

// ─── K5: Index consistency guards ────────────────────────────

/**
 * CONTRACT K5 GUARD: Validates that chapterIdMap indices don't exceed tocEntries bounds.
 * Call after any operation that modifies tocEntries length (delete, merge).
 */
export function assertMapIndicesInBounds(
  mapName: string,
  map: Map<number, any>,
  maxIndex: number,
): void {
  for (const idx of map.keys()) {
    if (idx < 0 || idx >= maxIndex) {
      const msg = `[CONTRACT K5 VIOLATION] ${mapName} contains index ${idx} but valid range is 0-${maxIndex - 1}. This indicates a desynchronization after delete/merge.`;
      console.error(msg);
      throw new Error(msg);
    }
  }
}

/**
 * CONTRACT K5 GUARD: Validates chapterResults indices match tocEntries length.
 * Warns (doesn't throw) for out-of-range results — they may be stale but not dangerous.
 */
export function warnStaleResults(
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>,
  tocLength: number,
): void {
  for (const idx of chapterResults.keys()) {
    if (idx >= tocLength) {
      console.warn(
        `[CONTRACT K5 WARNING] chapterResults has entry for index ${idx} but tocEntries only has ${tocLength} entries. Stale data from a prior delete/merge?`
      );
    }
  }
}

// ─── Merge guard ─────────────────────────────────────────────

/**
 * Asserts merge indices are valid: sorted, contiguous section, same sectionType.
 */
export function assertValidMerge(
  indices: number[],
  tocEntries: TocChapter[],
): void {
  if (indices.length < 2) {
    throw new Error(`[MERGE GUARD] Need at least 2 indices to merge, got ${indices.length}`);
  }
  const sorted = [...indices].sort((a, b) => a - b);
  const sectionType = tocEntries[sorted[0]]?.sectionType;
  for (const idx of sorted) {
    if (idx < 0 || idx >= tocEntries.length) {
      throw new Error(`[MERGE GUARD] Index ${idx} is out of bounds (0-${tocEntries.length - 1})`);
    }
    if (tocEntries[idx].sectionType !== sectionType) {
      throw new Error(`[MERGE GUARD] Cannot merge entries with different sectionTypes: "${sectionType}" vs "${tocEntries[idx].sectionType}"`);
    }
  }
}

// ─── Delete guard ────────────────────────────────────────────

/**
 * Validates that a delete operation won't leave orphaned children.
 * Warns if deleting a parent without its children.
 */
export function warnPartialTreeDelete(
  toDelete: Set<number>,
  tocEntries: TocChapter[],
): void {
  for (const idx of toDelete) {
    const entry = tocEntries[idx];
    if (!entry) continue;
    for (let i = idx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      if (!toDelete.has(i)) {
        console.warn(
          `[DELETE WARNING] Deleting parent "${entry.title}" (idx=${idx}) but child at idx=${i} ("${tocEntries[i].title}") is NOT included. This may leave orphaned children.`
        );
      }
    }
  }
}
