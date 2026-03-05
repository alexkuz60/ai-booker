import * as pdfjsLib from 'pdfjs-dist';

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

  for (let i = startPage; i <= endPage; i++) {
    const page = await pdf.getPage(i);
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

    const lines: string[] = [];
    let currentLine = '';
    let prevY: number | null = null;

    for (const item of items) {
      const t = (item as any).transform;
      const y = t ? t[5] : null; // Y coordinate (bottom of text)
      const str: string = (item as any).str;

      if (prevY !== null && y !== null) {
        const gap = Math.abs(prevY - y);

        if (gap > medianHeight * 1.8) {
          // Large gap → paragraph break
          lines.push(currentLine.trimEnd());
          lines.push(''); // empty line = paragraph separator
          currentLine = str;
        } else if (gap > medianHeight * 0.3) {
          // Normal line break (same paragraph)
          lines.push(currentLine.trimEnd());
          currentLine = str;
        } else {
          // Same line — add space only if not joining to punctuation
          const needsSpace = currentLine && str && !currentLine.endsWith(' ') && !str.startsWith(' ') && !/^[.,;:!?—–)»"\u201D\u2019\u00BB]/.test(str);
          currentLine += (needsSpace ? ' ' : '') + str;
        }
      } else {
        currentLine += str;
      }

      if (y !== null) prevY = y;
    }

    if (currentLine) lines.push(currentLine.trimEnd());

    // Merge consecutive non-empty lines into paragraphs, keep empty lines as \n\n
    const paragraphs: string[] = [];
    let buf: string[] = [];
    for (const line of lines) {
      if (line === '') {
        if (buf.length > 0) {
          paragraphs.push(buf.join(' '));
          buf = [];
        }
        // paragraph break marker
        paragraphs.push('');
      } else {
        buf.push(line);
      }
    }
    if (buf.length > 0) paragraphs.push(buf.join(' '));

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
