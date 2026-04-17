/**
 * Pure text-editing helpers for the OmniVoice synthesis textarea.
 * No React, no toast — just string transformations. Unit-testable.
 */

import { COMBINING_ACUTE, RU_VOWELS_RE } from "./constants";

export interface StressInsertResult {
  text: string;
  caret: number;
  /** "inserted" | "removed" | "none" — empty means nothing to do */
  action: "inserted" | "removed" | "none";
}

/**
 * Insert or toggle combining acute after a vowel.
 * Strategy:
 *   1) If [start..end] selects exactly one Russian vowel → mark after it.
 *   2) If caret is collapsed → look left up to 12 chars for nearest vowel, mark after it.
 * If already acute at target position — remove (toggle).
 */
export function toggleStressAt(
  value: string,
  start: number,
  end: number,
): StressInsertResult {
  let insertAt = -1;

  if (end - start === 1 && RU_VOWELS_RE.test(value[start])) {
    insertAt = start + 1;
  } else if (start === end) {
    for (let i = start - 1; i >= 0 && i > start - 12; i--) {
      if (value[i] === COMBINING_ACUTE) continue;
      if (/\s/.test(value[i])) break;
      if (RU_VOWELS_RE.test(value[i])) { insertAt = i + 1; break; }
    }
  }

  if (insertAt < 0) {
    return { text: value, caret: start, action: "none" };
  }

  // Already has acute at target — remove (toggle).
  if (value[insertAt] === COMBINING_ACUTE) {
    const next = value.slice(0, insertAt) + value.slice(insertAt + 1);
    const caret = Math.min(insertAt, next.length);
    return { text: next, caret, action: "removed" };
  }

  const next = value.slice(0, insertAt) + COMBINING_ACUTE + value.slice(insertAt);
  return { text: next, caret: insertAt + 1, action: "inserted" };
}

/**
 * Remove every combining acute from the string.
 */
export function clearAllStressMarks(value: string): string {
  return value.replace(new RegExp(COMBINING_ACUTE, "g"), "");
}

export interface TagInsertResult {
  text: string;
  caret: number;
}

/**
 * Insert a non-verbal tag at the caret, smartly managing spaces around it.
 * When no textarea ref is available caller can use the fallback below.
 */
export function insertTagAt(
  value: string,
  start: number,
  end: number,
  tag: string,
): TagInsertResult {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const needLeadingSpace = before.length > 0 && !/\s$/.test(before);
  const needTrailingSpace = after.length > 0 && !/^\s/.test(after);
  const inserted = (needLeadingSpace ? " " : "") + tag + (needTrailingSpace ? " " : "");
  const text = before + inserted + after;
  const caret = before.length + inserted.length;
  return { text, caret };
}

/**
 * Fallback append when textarea ref is unavailable.
 */
export function appendTag(value: string, tag: string): string {
  const sep = value.endsWith(" ") || value.length === 0 ? "" : " ";
  return value + sep + tag + " ";
}
