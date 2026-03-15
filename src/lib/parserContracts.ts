/**
 * ═══════════════════════════════════════════════════════════════
 *  PARSER CONTRACTS — Runtime Guards
 * ═══════════════════════════════════════════════════════════════
 *
 *  Эти функции содержат runtime-проверки критических инвариантов.
 *  Они НЕ молчат при нарушении — бросают ошибку или логируют предупреждение.
 *  Импортируются в местах мутации данных (Parser.tsx, useChapterAnalysis).
 *
 *  CONTRACT K1: resolvePageRange — всегда использовать при анализе глав
 *  CONTRACT K2: filterContainerNodes — пропуск контейнеров при импорте TOC
 *  CONTRACT K3: redistributeScenes — распределение сцен обратно по дочерним главам
 *  CONTRACT K4: aggregateSelectedResult — агрегация сцен из дочерних узлов
 */

import type { TocChapter, Scene, ChapterStatus } from "@/pages/parser/types";

/**
 * CONTRACT K3 GUARD: Validates that handleScenesUpdate does NOT write
 * aggregated scenes into a parent node that has children.
 *
 * Call BEFORE writing scenes to chapterResults for a given index.
 *
 * @throws Error if attempting to write non-empty scenes to a parent with children
 */
export function assertNotOverwritingParent(
  targetIdx: number,
  tocEntries: TocChapter[],
  scenesToWrite: Scene[],
  label: string = "",
): void {
  if (scenesToWrite.length === 0) return; // Empty writes are always safe

  const entry = tocEntries[targetIdx];
  if (!entry) return;

  // Check if this entry has children
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

/**
 * CONTRACT K1 GUARD: Validates that page range is reasonable.
 * Warns if range is suspiciously small (1 page) for a non-leaf node.
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

  // Check if this entry has children
  let childCount = 0;
  for (let i = idx + 1; i < tocEntries.length; i++) {
    if (tocEntries[i].level <= entry.level) break;
    if (tocEntries[i].sectionType !== entry.sectionType) break;
    childCount++;
  }

  if (pageSpan <= 1 && childCount > 0) {
    console.warn(
      `[CONTRACT K1 WARNING] Chapter "${entry.title}" (idx=${idx}) has ${childCount} children but only ${pageSpan} page(s) (${startPage}-${endPage}). This is likely a container node — resolvePageRange should have expanded the range.`
    );
  }
}

/**
 * CONTRACT K2 GUARD: Checks that a TOC entry with children is not being
 * treated as a content chapter.
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
