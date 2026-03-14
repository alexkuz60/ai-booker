import { useCallback } from "react";
import type { Scene } from "@/pages/parser/types";

// ─── Types ───────────────────────────────────────────────────
export type CleanupAction = "header" | "page_number" | "chapter_split" | "fix_punctuation_spaces" | "footnote_link";

export interface CleanupResult {
  /** Updated scenes array (may grow if split happened) */
  scenes: Scene[];
  /** Number of removals / fixes applied */
  changeCount: number;
  /** Human-readable summary */
  summary: string;
}

// ─── Escape regex special chars ──────────────────────────────
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── 1. Remove header/footer fragments ───────────────────────
// Builds a fuzzy pattern from the selected text and removes all
// similar occurrences across all scenes.
function removeHeaderFooter(scenes: Scene[], selectedText: string): CleanupResult {
  const trimmed = selectedText.trim();
  if (!trimmed) return { scenes, changeCount: 0, summary: "Нет выделенного текста" };

  // Build pattern: escape the selected text, allow flexible whitespace
  const pattern = new RegExp(
    escapeRegex(trimmed).replace(/\s+/g, "\\s+"),
    "g"
  );

  let changeCount = 0;
  const updatedScenes = scenes.map(sc => {
    const content = sc.content || "";
    const matches = content.match(pattern);
    if (!matches) return sc;
    changeCount += matches.length;
    const cleaned = content.replace(pattern, "").replace(/\n{3,}/g, "\n\n").trim();
    return { ...sc, content: cleaned };
  });

  return {
    scenes: updatedScenes,
    changeCount,
    summary: changeCount > 0
      ? `Удалено ${changeCount} колонтитул(ов)`
      : "Совпадений не найдено",
  };
}

// ─── 2. Remove page numbers ─────────────────────────────────
// Uses the selected text as a reference to find similar number
// patterns (standalone digits on their own line or surrounded
// by whitespace).
function removePageNumbers(scenes: Scene[], selectedText: string): CleanupResult {
  const trimmed = selectedText.trim();

  // Detect the numeric pattern from selection
  const numMatch = trimmed.match(/\d+/);
  if (!numMatch) return { scenes, changeCount: 0, summary: "Число не найдено в выделении" };

  // Pattern: a line consisting only of digits (possibly with surrounding whitespace)
  // or digits surrounded by common page-number decorators
  const pattern = /(?:^|\n)\s*-?\s*\d{1,4}\s*-?\s*(?:\n|$)/g;

  let changeCount = 0;
  const updatedScenes = scenes.map(sc => {
    const content = sc.content || "";
    const matches = content.match(pattern);
    if (!matches) return sc;
    changeCount += matches.length;
    const cleaned = content.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return { ...sc, content: cleaned };
  });

  return {
    scenes: updatedScenes,
    changeCount,
    summary: changeCount > 0
      ? `Удалено ${changeCount} номер(ов) страниц`
      : "Номера страниц не найдены",
  };
}

// ─── 3. Split scene at chapter marker ────────────────────────
// Checks if the character right after selection starts with an
// uppercase letter. If so, splits the scene at that position
// and creates a new scene.
function splitAtChapterMarker(
  scenes: Scene[],
  selectedText: string,
  sceneIndex: number
): CleanupResult {
  const scene = scenes[sceneIndex];
  if (!scene) return { scenes, changeCount: 0, summary: "Сцена не найдена" };

  const content = scene.content || "";
  const selIdx = content.indexOf(selectedText);
  if (selIdx === -1) return { scenes, changeCount: 0, summary: "Выделенный текст не найден" };

  const splitPoint = selIdx + selectedText.length;
  const afterText = content.slice(splitPoint).trimStart();

  // Check if next character is uppercase
  if (!afterText || !/^[A-ZА-ЯЁ]/.test(afterText)) {
    return {
      scenes,
      changeCount: 0,
      summary: "Следующий символ не является заглавной буквой",
    };
  }

  const beforeContent = content.slice(0, splitPoint).trim();
  const afterContent = afterText;

  // Find the next similar marker (uppercase after newline) to determine sub-scene boundary
  // For now, just split into two scenes at the split point
  const beforeScene: Scene = {
    ...scene,
    content: beforeContent,
  };

  const afterScene: Scene = {
    ...scene,
    scene_number: scene.scene_number + 1,
    title: `${scene.title} (продолж.)`,
    content: afterContent,
  };

  // Re-number all subsequent scenes
  const newScenes = [...scenes];
  newScenes.splice(sceneIndex, 1, beforeScene, afterScene);

  // Re-number
  const renumbered = newScenes.map((s, i) => ({ ...s, scene_number: i + 1 }));

  return {
    scenes: renumbered,
    changeCount: 1,
    summary: "Сцена разделена на две части",
  };
}

// ─── 4. Fix punctuation spaces ───────────────────────────────
// Remove spaces before punctuation marks, add space after if missing.
function fixPunctuationSpaces(scenes: Scene[]): CleanupResult {
  // Space(s) before punctuation
  const spaceBefore = /\s+([.,!?;:»)"])/g;
  // Missing space after punctuation (except when followed by another punctuation or end)
  const spaceAfter = /([.,!?;:])([A-Za-zА-Яа-яЁё])/g;

  let changeCount = 0;
  const updatedScenes = scenes.map(sc => {
    const content = sc.content || "";
    let fixed = content;

    const beforeMatches = fixed.match(spaceBefore);
    if (beforeMatches) changeCount += beforeMatches.length;
    fixed = fixed.replace(spaceBefore, "$1");

    const afterMatches = fixed.match(spaceAfter);
    if (afterMatches) changeCount += afterMatches.length;
    fixed = fixed.replace(spaceAfter, "$1 $2");

    return { ...sc, content: fixed };
  });

  return {
    scenes: updatedScenes,
    changeCount,
    summary: changeCount > 0
      ? `Исправлено ${changeCount} проблем с пробелами`
      : "Проблем с пробелами не найдено",
  };
}

// ─── Hook ────────────────────────────────────────────────────

export function useContentCleanup() {
  const applyCleanup = useCallback((
    action: CleanupAction,
    scenes: Scene[],
    selectedText: string = "",
    sceneIndex: number = 0
  ): CleanupResult => {
    switch (action) {
      case "header":
        return removeHeaderFooter(scenes, selectedText);
      case "page_number":
        return removePageNumbers(scenes, selectedText);
      case "chapter_split":
        return splitAtChapterMarker(scenes, selectedText, sceneIndex);
      case "fix_punctuation_spaces":
        return fixPunctuationSpaces(scenes);
      default:
        return { scenes, changeCount: 0, summary: "Неизвестное действие" };
    }
  }, []);

  return { applyCleanup };
}
