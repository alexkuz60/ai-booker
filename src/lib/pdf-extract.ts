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
    const text = content.items.map((item: any) => item.str).join(' ');
    pages.push(text);
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
