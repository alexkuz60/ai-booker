import { useCallback } from "react";
import type { Scene } from "@/pages/parser/types";

// ─── Types ───────────────────────────────────────────────────
export type CleanupAction = "header" | "page_number" | "chapter_split" | "fix_punctuation_spaces" | "footnote_link" | "footnote_auto" | "delete_selected";

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

// ─── 3. Delete selected text in current scene (exact, no global search) ─────
function deleteSelectedTextInScene(
  scenes: Scene[],
  selectedText: string,
  sceneIndex: number,
): CleanupResult {
  const trimmed = selectedText.trim();
  if (!trimmed) return { scenes, changeCount: 0, summary: "Нет выделенного текста" };

  const scene = scenes[sceneIndex];
  if (!scene) return { scenes, changeCount: 0, summary: "Сцена не найдена" };

  const content = scene.content || "";
  const selIdx = content.indexOf(trimmed);
  if (selIdx === -1) {
    return { scenes, changeCount: 0, summary: "Выделенный текст не найден в сцене" };
  }

  const newContent = content.slice(0, selIdx) + content.slice(selIdx + trimmed.length);
  const updatedScenes = scenes.map((sc, i) =>
    i === sceneIndex ? { ...sc, content: newContent } : sc
  );

  return {
    scenes: updatedScenes,
    changeCount: 1,
    summary: "Выделенный текст удалён",
  };
}

// ─── 4. Split scene at chapter marker ────────────────────────
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

// ─── 5. Link footnote number ─────────────────────────────────
// Wraps a bare footnote number in the body text with a reference
// marker [сн.→ N] and verifies the corresponding footnote body
// [сн. N]...[/сн.] exists somewhere in the scenes.
function linkFootnoteNumber(
  scenes: Scene[],
  selectedText: string,
  sceneIndex: number
): CleanupResult {
  const trimmed = selectedText.trim();
  const numMatch = trimmed.match(/^\d+$/);
  if (!numMatch) {
    return { scenes, changeCount: 0, summary: "Выделите только номер сноски (число)" };
  }

  const fnNum = numMatch[0];
  const scene = scenes[sceneIndex];
  if (!scene) return { scenes, changeCount: 0, summary: "Сцена не найдена" };

  const content = scene.content || "";

  // Check if this number is already wrapped as a reference
  const refMarker = `[сн.→ ${fnNum}]`;
  if (content.includes(refMarker)) {
    return { scenes, changeCount: 0, summary: `Сноска ${fnNum} уже размечена` };
  }

  // Find the bare number in the content and replace with reference marker
  // We need to be careful to replace only the specific occurrence the user selected
  const selIdx = content.indexOf(trimmed);
  if (selIdx === -1) {
    return { scenes, changeCount: 0, summary: "Выделенный текст не найден в сцене" };
  }

  // Replace the bare number with [сн.→ N]
  const newContent =
    content.slice(0, selIdx) + refMarker + content.slice(selIdx + trimmed.length);

  // Check if the footnote body [сн. N]...[/сн.] exists anywhere
  const fnBodyPattern = new RegExp(`\\[сн\\.\\s*${escapeRegex(fnNum)}\\]`);
  const bodyFound = scenes.some(sc => fnBodyPattern.test(sc.content || ""));

  const updatedScenes = scenes.map((sc, i) =>
    i === sceneIndex ? { ...sc, content: newContent } : sc
  );

  const status = bodyFound
    ? `Сноска ${fnNum} размечена и связана с текстом`
    : `Сноска ${fnNum} размечена ⚠️ текст сноски [сн. ${fnNum}] не найден`;

  return {
    scenes: updatedScenes,
    changeCount: 1,
    summary: status,
  };
}

// ─── 6. Auto-link all footnote numbers ───────────────────────
// Scans all scenes for existing footnote bodies [сн. N]...[/сн.],
// collects their numbers, then finds bare occurrences of those
// numbers in the body text and wraps them with [сн.→ N].
function autoLinkFootnotes(scenes: Scene[]): CleanupResult {
  // 1. Collect all footnote numbers from [сн. N] markers
  const fnNumbers = new Set<string>();
  const fnBodyRe = /\[сн\.\s*(\d+)\]/g;
  for (const sc of scenes) {
    let m: RegExpExecArray | null;
    while ((m = fnBodyRe.exec(sc.content || "")) !== null) {
      fnNumbers.add(m[1]);
    }
  }

  if (fnNumbers.size === 0) {
    return { scenes, changeCount: 0, summary: "Маркеры сносок [сн. N] не найдены в тексте" };
  }

  let changeCount = 0;
  const updatedScenes = scenes.map(sc => {
    let content = sc.content || "";

    for (const num of fnNumbers) {
      const refMarker = `[сн.→ ${num}]`;
      // Skip if already has this reference
      if (content.includes(refMarker)) continue;

      // Find bare number that is:
      // - NOT inside an existing marker [сн. N] or [сн.→ N] or [стр. N]
      // - Surrounded by non-digit context (word boundary or punctuation)
      // Strategy: temporarily mask all existing markers, find bare numbers, then restore
      const markerPlaceholders: string[] = [];
      const masked = content.replace(/\[(?:сн\.|сн\.→|стр\.|\/сн\.)[^\]]*\]/g, (match) => {
        const idx = markerPlaceholders.length;
        markerPlaceholders.push(match);
        return `\x00MARKER${idx}\x00`;
      });

      // Match bare number N at word boundary (not part of a larger number)
      const barePattern = new RegExp(`(?<=\\D|^)${escapeRegex(num)}(?=\\D|$)`);
      const bareMatch = barePattern.exec(masked);

      if (bareMatch) {
        // Map position back to original content
        // Count how many placeholder chars precede this position
        let origPos = 0;
        let maskedPos = 0;
        const placeholderRe = /\x00MARKER(\d+)\x00/g;
        let lastEnd = 0;
        let pm: RegExpExecArray | null;
        const segments: { masked: number; orig: number; len: number }[] = [];

        // Rebuild position mapping
        placeholderRe.lastIndex = 0;
        while ((pm = placeholderRe.exec(masked)) !== null) {
          segments.push({
            masked: pm.index,
            orig: pm.index + (origPos - maskedPos),
            len: markerPlaceholders[parseInt(pm[1])].length,
          });
          const placeholderLen = pm[0].length;
          const origLen = markerPlaceholders[parseInt(pm[1])].length;
          origPos += origLen - placeholderLen;
        }

        // Calculate real position
        let realPos = bareMatch.index;
        let offset = 0;
        for (const seg of segments) {
          if (bareMatch.index > seg.masked) {
            offset += markerPlaceholders[segments.indexOf(seg)].length - `\x00MARKER${segments.indexOf(seg)}\x00`.length;
          }
        }
        realPos = bareMatch.index + offset;

        content = content.slice(0, realPos) + refMarker + content.slice(realPos + num.length);
        changeCount++;
      }
    }

    return changeCount > 0 ? { ...sc, content } : sc;
  });

  const linked = changeCount;
  const notLinked = fnNumbers.size - linked;
  const summary = linked > 0
    ? `Размечено ${linked} сносок` + (notLinked > 0 ? `, ${notLinked} не найдены в тексте` : "")
    : "Голые номера сносок не найдены в тексте";

  return { scenes: updatedScenes, changeCount, summary };
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
      case "delete_selected":
        return deleteSelectedTextInScene(scenes, selectedText, sceneIndex);
      case "chapter_split":
        return splitAtChapterMarker(scenes, selectedText, sceneIndex);
      case "fix_punctuation_spaces":
        return fixPunctuationSpaces(scenes);
      case "footnote_link":
        return linkFootnoteNumber(scenes, selectedText, sceneIndex);
      case "footnote_auto":
        return autoLinkFootnotes(scenes);
      default:
        return { scenes, changeCount: 0, summary: "Неизвестное действие" };
    }
  }, []);

  return { applyCleanup };
}
