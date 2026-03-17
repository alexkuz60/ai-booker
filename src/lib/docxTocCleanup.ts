import type { TocEntry } from "./pdf-extract";

const TOC_HEADING_PATTERNS = [
  /^(глава|chapter)\b/i,
  /^(часть|part)\b/i,
  /^(книга|book)\b/i,
  /^(том|volume)\b/i,
  /^(акт|act)\b/i,
];

export function stripTrailingPageNumber(raw: string): string {
  return raw.replace(/[\t\s]+\d+\s*$/, "").replace(/\s+/g, " ").trim();
}

export function normalizeTocTitle(raw: string): string {
  return stripTrailingPageNumber(raw).toLowerCase();
}

function extractHtmlLines(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return Array.from(doc.body.children)
    .map((node) => stripTrailingPageNumber(node.textContent || ""))
    .map((line) => line.trim())
    .filter(Boolean);
}

function isSentenceLike(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  return words.length >= 8 && /[.!?…]/.test(line);
}

function isLikelyHeadingLine(line: string, knownTitles: Set<string>): boolean {
  const normalized = normalizeTocTitle(line);
  if (!normalized) return false;
  return knownTitles.has(normalized) || TOC_HEADING_PATTERNS.some((pattern) => pattern.test(line));
}

export function isLikelyTocOnlyHtml(html: string, knownTitles: Set<string>): boolean {
  const lines = extractHtmlLines(html);
  if (lines.length === 0) return true;
  if (lines.some(isSentenceLike)) return false;
  if (lines.some((line) => line.length >= 140)) return false;
  return lines.every((line) => isLikelyHeadingLine(line, knownTitles));
}

export function pruneDocxTocArtifacts(
  outline: TocEntry[],
  chapterTexts: Map<number, string>,
): { outline: TocEntry[]; chapterTexts: Map<number, string>; removedCount: number } {
  const knownTitles = new Set(outline.map((entry) => normalizeTocTitle(entry.title)));
  const filteredOutline: TocEntry[] = [];
  const filteredTexts = new Map<number, string>();
  let removedCount = 0;

  outline.forEach((entry, idx) => {
    const html = chapterTexts.get(idx) || "";
    if (isLikelyTocOnlyHtml(html, knownTitles)) {
      removedCount += 1;
      return;
    }

    const nextIndex = filteredOutline.length;
    filteredOutline.push(entry);
    if (html) filteredTexts.set(nextIndex, html);
  });

  return { outline: filteredOutline, chapterTexts: filteredTexts, removedCount };
}
