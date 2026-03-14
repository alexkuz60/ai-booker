import * as pdfjsLib from 'pdfjs-dist';

import { type LineInfo, type FootnoteState, initialFootnoteState, separateFootnotes, processFootnotes } from './pdf-footnotes';

// Use the worker from CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface TocEntry {
  title: string;
  pageNumber: number;
  level: number;
  children: TocEntry[];
}

export interface PageText {
  pageNumber: number;
  text: string;
}

/**
 * Extract the PDF outline (bookmarks / table of contents).
 * Returns a hierarchical array of TocEntry items.
 */
export async function extractOutline(file: File): Promise<{ outline: TocEntry[]; pdf: pdfjsLib.PDFDocumentProxy }> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const rawOutline = await pdf.getOutline();
  if (!rawOutline || rawOutline.length === 0) {
    return { outline: [], pdf };
  }

  async function parseItems(items: any[], level: number): Promise<TocEntry[]> {
    const entries: TocEntry[] = [];
    for (const item of items) {
      let pageNumber = 1;
      try {
        if (item.dest) {
          const dest = typeof item.dest === 'string'
            ? await pdf.getDestination(item.dest)
            : item.dest;
          if (dest && dest[0]) {
            const pageIndex = await pdf.getPageIndex(dest[0]);
            pageNumber = pageIndex + 1;
          }
        }
      } catch {
        // fallback to page 1
      }

      const children = item.items?.length
        ? await parseItems(item.items, level + 1)
        : [];

      entries.push({
        title: item.title || `Untitled`,
        pageNumber,
        level,
        children,
      });
    }
    return entries;
  }

  const outline = await parseItems(rawOutline, 0);
  return { outline, pdf };
}

/**
 * Extract text from specific page ranges of a PDF.
 */
/**
 * Extract text from specific page ranges of a PDF,
 * preserving paragraph breaks using Y-coordinate gaps between text items.
 */
export async function extractTextByPageRange(
  pdf: pdfjsLib.PDFDocumentProxy,
  startPage: number,
  endPage: number,
  onProgress?: (percent: number) => void
): Promise<string> {
  const pages: string[] = [];
  const total = endPage - startPage + 1;
  let footnoteState: FootnoteState = initialFootnoteState();

  for (let i = startPage; i <= endPage; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;
    const content = await page.getTextContent();
    const items = content.items.filter((it: any) => typeof it.str === 'string');

    if (items.length === 0) {
      pages.push('');
      onProgress?.(Math.round(((i - startPage + 1) / total) * 100));
      continue;
    }

    // Collect line heights to compute a typical line spacing
    const heights: number[] = [];
    for (const item of items) {
      const h = Math.abs((item as any).transform?.[3] || (item as any).height || 0);
      if (h > 0) heights.push(h);
    }
    const medianHeight = heights.length > 0
      ? heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)]
      : 12;

    // Track Y positions and font sizes per line for page-number and footnote detection
    const lineInfos: LineInfo[] = [];
    let currentLine = '';
    let currentLineY: number | null = null;
    let currentLineFontSize: number | null = null;
    let prevY: number | null = null;

    for (const item of items) {
      const t = (item as any).transform;
      const y = t ? t[5] : null; // Y coordinate (bottom of text)
      const str: string = (item as any).str;
      const itemFontSize = t ? Math.abs(t[3]) : null;

      if (prevY !== null && y !== null) {
        const gap = Math.abs(prevY - y);

        if (gap > medianHeight * 1.8) {
          // Large gap → paragraph break
          lineInfos.push({ text: currentLine.trimEnd(), y: currentLineY, fontSize: currentLineFontSize });
          lineInfos.push({ text: '', y: null, fontSize: null }); // paragraph separator
          currentLine = str;
          currentLineY = y;
          currentLineFontSize = itemFontSize;
        } else if (gap > medianHeight * 0.3) {
          // Normal line break (same paragraph)
          lineInfos.push({ text: currentLine.trimEnd(), y: currentLineY, fontSize: currentLineFontSize });
          currentLine = str;
          currentLineY = y;
          currentLineFontSize = itemFontSize;
        } else {
          // Same line — add space only if not joining to punctuation
          const needsSpace = currentLine && str && !currentLine.endsWith(' ') && !str.startsWith(' ') && !/^[.,;:!?—–)»"\u201D\u2019\u00BB]/.test(str);
          currentLine += (needsSpace ? ' ' : '') + str;
          if (itemFontSize !== null) currentLineFontSize = itemFontSize;
        }
      } else {
        currentLine += str;
        if (currentLineY === null) currentLineY = y;
        if (currentLineFontSize === null) currentLineFontSize = itemFontSize;
      }

      if (y !== null) prevY = y;
    }

    if (currentLine) lineInfos.push({ text: currentLine.trimEnd(), y: currentLineY, fontSize: currentLineFontSize });

    // Separate footnotes from body text
    const { bodyLines, footnoteLines } = separateFootnotes(lineInfos, pageHeight, medianHeight);

    // Detect page numbers in body: isolated digit-only lines in top/bottom 12% of page
    const marginZone = pageHeight * 0.12;
    const lines: string[] = bodyLines.map(li => {
      if (li.text && li.y !== null && /^\d{1,4}$/.test(li.text.trim())) {
        const isTop = li.y > pageHeight - marginZone;
        const isBottom = li.y < marginZone;
        if (isTop || isBottom) {
          return `[стр. ${li.text.trim()}]`;
        }
      }
      return li.text;
    });

    // Process footnotes into marked text
    const footnoteText = footnoteLines.map(li => li.text).join(' ');
    const { marked: markedFootnotes, newState } = processFootnotes(footnoteText, footnoteState);
    footnoteState = newState;

    // Merge consecutive non-empty lines into paragraphs, keep empty lines as \n\n
    const paragraphs: string[] = [];
    let buf: string[] = [];
    for (const line of lines) {
      if (line === '') {
        if (buf.length > 0) {
          paragraphs.push(buf.join(' '));
          buf = [];
        }
        paragraphs.push('');
      } else {
        buf.push(line);
      }
    }
    if (buf.length > 0) paragraphs.push(buf.join(' '));

    // Append footnote block if present
    if (markedFootnotes) {
      paragraphs.push(markedFootnotes);
    }

    pages.push(paragraphs.filter((p, idx, arr) => {
      // Deduplicate consecutive empty strings
      if (p === '' && idx > 0 && arr[idx - 1] === '') return false;
      return true;
    }).join('\n'));

    onProgress?.(Math.round(((i - startPage + 1) / total) * 100));
  }

  return pages.join('\n\n');
}

/**
 * Extract all text from a PDF with progress tracking.
 */
export async function extractTextFromPdf(
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  const pages: string[] = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item: any) => item.str).join(' ');
    pages.push(text);
    onProgress?.(Math.round((i / totalPages) * 100));
  }

  return pages.join('\n\n');
}

/**
 * Fallback TOC extraction by scanning page text for chapter heading patterns.
 * Used when the PDF has no embedded outline/bookmarks.
 *
 * Detects patterns like:
 * - "Глава 1", "ГЛАВА ПЕРВАЯ", "Глава I"
 * - "Chapter 1", "CHAPTER ONE"
 * - "Часть 1" / "Part 1" (treated as level 0)
 * - Standalone Roman numerals (I, II, III...) or Arabic numbers as headings
 */
export async function extractTocFromText(
  pdf: pdfjsLib.PDFDocumentProxy
): Promise<TocEntry[]> {
  const totalPages = pdf.numPages;
  const entries: { title: string; pageNumber: number; level: number }[] = [];

  // Patterns for chapter/part headings
  const CHAPTER_PATTERNS = [
    // Russian: Глава N / Глава Первая / ГЛАВА N
    /^(глава)\s+(\d+|[IVXLCDM]+|[а-яё]+(?:\s+[а-яё]+)?)\s*[.:]?\s*(.*)/i,
    // English: Chapter N
    /^(chapter)\s+(\d+|[IVXLCDM]+|[a-z]+(?:\s+[a-z]+)?)\s*[.:]?\s*(.*)/i,
    // Russian: Акт N / Акт 1. Title
    /^(акт)\s+(\d+|[IVXLCDM]+)\s*[.:]?\s*(.*)/i,
    // English: Act N
    /^(act)\s+(\d+|[IVXLCDM]+)\s*[.:]?\s*(.*)/i,
  ];

  const PART_PATTERNS = [
    /^(часть)\s+(\d+|[IVXLCDM]+|[а-яё]+)\s*[.:]?\s*(.*)/i,
    /^(part)\s+(\d+|[IVXLCDM]+|[a-z]+)\s*[.:]?\s*(.*)/i,
    /^(книга)\s+(\d+|[IVXLCDM]+|[а-яё]+)\s*[.:]?\s*(.*)/i,
    /^(book)\s+(\d+|[IVXLCDM]+)\s*[.:]?\s*(.*)/i,
    // Том N (volume)
    /^(том)\s+(\d+|[IVXLCDM]+)\s*[.:]?\s*(.*)/i,
    /^(volume)\s+(\d+|[IVXLCDM]+)\s*[.:]?\s*(.*)/i,
  ];

  // Standalone Roman numeral heading (I, II, III, IV, etc.)
  const ROMAN_ONLY = /^([IVXLCDM]{1,6})$/;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items.filter((it: any) => typeof it.str === 'string');

    if (items.length === 0) continue;

    // Group items by Y coordinate to form lines
    const lines: { text: string; fontSize: number; y: number }[] = [];
    let currentLine = '';
    let currentY: number | null = null;
    let currentFontSize = 0;
    let maxFontSizeInLine = 0;

    const viewport = page.getViewport({ scale: 1 });
    const heights: number[] = [];
    for (const item of items) {
      const h = Math.abs((item as any).transform?.[3] || 0);
      if (h > 0) heights.push(h);
    }
    const medianHeight = heights.length > 0
      ? heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)]
      : 12;

    for (const item of items) {
      const t = (item as any).transform;
      const y = t ? t[5] : null;
      const fontSize = t ? Math.abs(t[3]) : 0;
      const str: string = (item as any).str;

      if (currentY !== null && y !== null && Math.abs(currentY - y) > medianHeight * 0.5) {
        if (currentLine.trim()) {
          lines.push({ text: currentLine.trim(), fontSize: maxFontSizeInLine, y: currentY });
        }
        currentLine = str;
        currentY = y;
        maxFontSizeInLine = fontSize;
      } else {
        const needsSpace = currentLine && str && !currentLine.endsWith(' ') && !str.startsWith(' ');
        currentLine += (needsSpace ? ' ' : '') + str;
        if (currentY === null) currentY = y;
        maxFontSizeInLine = Math.max(maxFontSizeInLine, fontSize);
      }
    }
    if (currentLine.trim() && currentY !== null) {
      lines.push({ text: currentLine.trim(), fontSize: maxFontSizeInLine, y: currentY });
    }

    // Check first ~8 lines of the page for heading patterns
    const topLines = lines.slice(0, 8);
    for (const line of topLines) {
      const text = line.text.trim();
      if (!text || text.length > 120) continue;

      // Check part patterns first (level 0)
      let matched = false;
      for (const pat of PART_PATTERNS) {
        const m = text.match(pat);
        if (m) {
          const suffix = m[3]?.trim();
          const title = suffix ? `${m[1]} ${m[2]}. ${suffix}` : `${m[1]} ${m[2]}`;
          entries.push({ title, pageNumber: pageNum, level: 0 });
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Check chapter patterns (Глава, Chapter, Акт, Act)
      for (const pat of CHAPTER_PATTERNS) {
        const m = text.match(pat);
        if (m) {
          const suffix = m[3]?.trim();
          const title = suffix ? `${m[1]} ${m[2]}. ${suffix}` : `${m[1]} ${m[2]}`;
          if (!entries.some(e => e.pageNumber === pageNum)) {
            entries.push({ title, pageNumber: pageNum, level: 0 });
          }
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Standalone Roman numeral on a line with larger font
      if (ROMAN_ONLY.test(text) && line.fontSize > medianHeight * 1.2) {
        if (!entries.some(e => e.pageNumber === pageNum)) {
          entries.push({ title: text, pageNumber: pageNum, level: 0 });
        }
      }

      // Detect bold/large-font short titles at page top (first 3 lines only)
      // that look like section titles but don't match keyword patterns
      if (lines.indexOf(line) < 3 && line.fontSize > medianHeight * 1.4 && text.length < 80 && text.length > 2) {
        if (!entries.some(e => e.pageNumber === pageNum) && !/^\d{1,4}$/.test(text)) {
          entries.push({ title: text, pageNumber: pageNum, level: 0 });
        }
      }
    }
  }

  // Assign proper levels: if we found parts, chapters become level 1
  const hasParts = entries.some(e => {
    for (const pat of PART_PATTERNS) {
      if (pat.test(e.title)) return true;
    }
    return false;
  });

  if (hasParts) {
    for (const e of entries) {
      let isPart = false;
      for (const pat of PART_PATTERNS) {
        if (pat.test(e.title)) { isPart = true; break; }
      }
      e.level = isPart ? 0 : 1;
    }
  }

  // Convert to TocEntry format
  return entries.map(e => ({
    title: e.title,
    pageNumber: e.pageNumber,
    level: e.level,
    children: [],
  }));
}

/**
 * Flatten the hierarchical TOC into a list with page ranges,
 * grouping by the given level (0=parts, 1=chapters).
 */
export function flattenTocWithRanges(
  outline: TocEntry[],
  totalPages: number
): { title: string; level: number; startPage: number; endPage: number; children: TocEntry[] }[] {
  // Flatten all entries at all levels
  const flat: { title: string; level: number; startPage: number; children: TocEntry[] }[] = [];

  function walk(items: TocEntry[]) {
    for (const item of items) {
      flat.push({ title: item.title, level: item.level, startPage: item.pageNumber, children: item.children });
      if (item.children.length) walk(item.children);
    }
  }
  walk(outline);

  // Assign endPage based on next sibling's startPage
  const result = flat.map((entry, i) => {
    const nextSameOrHigher = flat.slice(i + 1).find(e => e.level <= entry.level);
    const endPage = nextSameOrHigher ? nextSameOrHigher.startPage - 1 : totalPages;
    return { ...entry, endPage: Math.max(endPage, entry.startPage) };
  });

  return result;
}
