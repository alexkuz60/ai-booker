/**
 * Footnote detection and marking for PDF text extraction.
 * Detects footnotes at the bottom of pages, wraps them in [сн. N] ... [/сн.] markers,
 * and handles cross-page continuation (joining split footnotes).
 */

export interface LineInfo {
  text: string;
  y: number | null;
  fontSize: number | null;
}

export interface FootnoteState {
  openNumber: number | null;
}

export function initialFootnoteState(): FootnoteState {
  return { openNumber: null };
}

/**
 * Separate body lines from footnote lines based on position and font size.
 * Footnotes are at the bottom of the page with noticeably smaller font.
 */
export function separateFootnotes(
  lineInfos: LineInfo[],
  pageHeight: number,
  medianFontSize: number
): { bodyLines: LineInfo[]; footnoteLines: LineInfo[] } {
  const footnoteZone = pageHeight * 0.25; // bottom 25%
  const fontThreshold = medianFontSize * 0.85;

  // Scan from the end upward to find the first footnote line
  let footnoteStart = lineInfos.length;

  for (let i = lineInfos.length - 1; i >= 0; i--) {
    const li = lineInfos[i];
    if (li.text === '') continue; // skip paragraph separators
    if (li.y === null) continue;

    // Pure-digit lines at bottom are page numbers — skip them
    if (/^\d{1,4}$/.test(li.text.trim()) && li.y < footnoteZone) {
      continue;
    }

    // Footnote line: in bottom zone AND smaller font than body
    if (li.y < footnoteZone && li.fontSize !== null && li.fontSize < fontThreshold) {
      footnoteStart = i;
    } else {
      break; // hit body text, stop scanning
    }
  }

  return {
    bodyLines: lineInfos.slice(0, footnoteStart),
    footnoteLines: lineInfos.slice(footnoteStart).filter(li =>
      li.text !== '' && !/^\d{1,4}$/.test(li.text.trim())
    ),
  };
}

/**
 * Parse raw footnote text and wrap in [сн. N] ... [/сн.] markers.
 * Handles cross-page continuations via state.
 *
 * Input example: "1Пот , блуд и слёзы - описание. 2Юра Чернышевский - описание"
 * Output: "[сн. 1] Пот, блуд и слёзы - описание. [/сн.]\n[сн. 2] Юра Чернышевский - описание [/сн.]"
 */
export function processFootnotes(
  rawText: string,
  state: FootnoteState
): { marked: string; newState: FootnoteState } {
  const text = rawText.trim();

  if (!text) {
    // No footnotes on this page — close any open one from previous page
    if (state.openNumber !== null) {
      return { marked: '[/сн.]', newState: { openNumber: null } };
    }
    return { marked: '', newState: state };
  }

  // Find footnote number boundaries.
  // Pattern: digit(s) followed (possibly with whitespace) by an uppercase letter, opening quote, or parenthesis.
  // This matches "1Пот" "2 Юра" "12Текст" etc.
  const fnRegex = /(\d{1,3})\s*(?=[А-ЯЁA-Z«""(])/g;
  const matches: { index: number; num: number; numLen: number }[] = [];
  let m;

  while ((m = fnRegex.exec(text)) !== null) {
    matches.push({
      index: m.index,
      num: parseInt(m[1]),
      numLen: m[1].length,
    });
  }

  // Also detect a trailing bare number (footnote whose text is entirely on the next page)
  const trailingNum = text.match(/(\d{1,3})\s*$/);
  if (trailingNum) {
    const trailingIdx = text.lastIndexOf(trailingNum[1]);
    const alreadyMatched = matches.some(mx => mx.index === trailingIdx);
    if (!alreadyMatched) {
      matches.push({
        index: trailingIdx,
        num: parseInt(trailingNum[1]),
        numLen: trailingNum[1].length,
      });
    }
  }

  // Sort matches by position
  matches.sort((a, b) => a.index - b.index);

  const parts: string[] = [];
  const newState: FootnoteState = { openNumber: null };

  if (matches.length === 0) {
    // All text is continuation of a previous footnote
    if (state.openNumber !== null) {
      if (seemsComplete(text)) {
        parts.push(`${text} [/сн.]`);
      } else {
        parts.push(text);
        newState.openNumber = state.openNumber;
      }
    } else {
      parts.push(text);
    }
    return { marked: parts.join(' '), newState };
  }

  // Handle text before first footnote number (continuation from previous page)
  if (matches[0].index > 0) {
    const prefix = text.substring(0, matches[0].index).trim();
    if (prefix && state.openNumber !== null) {
      parts.push(`${prefix} [/сн.]`);
    } else if (prefix) {
      parts.push(prefix);
    }
  } else if (state.openNumber !== null) {
    parts.push('[/сн.]');
  }

  // Process each footnote
  for (let i = 0; i < matches.length; i++) {
    const { index, num, numLen } = matches[i];
    const textStart = index + numLen;
    const textEnd = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const fnText = text.substring(textStart, textEnd).trim();

    if (!fnText) {
      // Bare number with no text — footnote text is on the next page
      parts.push(`[сн. ${num}]`);
      newState.openNumber = num;
    } else if (i === matches.length - 1) {
      // Last footnote on page — check if it might continue on next page
      if (seemsComplete(fnText)) {
        parts.push(`[сн. ${num}] ${fnText} [/сн.]`);
      } else {
        parts.push(`[сн. ${num}] ${fnText}`);
        newState.openNumber = num;
      }
    } else {
      parts.push(`[сн. ${num}] ${fnText} [/сн.]`);
    }
  }

  return { marked: parts.join('\n'), newState };
}

/** Check if footnote text looks like it ends a complete sentence. */
function seemsComplete(text: string): boolean {
  return /[.!?»")\u201D\u2019\u00BB]\s*$/.test(text);
}
