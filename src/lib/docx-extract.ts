/**
 * DOCX extraction using Mammoth.js.
 * Produces TOC from heading styles (h1-h6) with regex fallback,
 * and preserves inline formatting as HTML tags (<em>, <strong>).
 */
import mammoth from "mammoth";
import { type TocEntry } from "./pdf-extract";

export interface DocxExtractResult {
  /** Hierarchical TOC entries (from headings or regex fallback) */
  outline: TocEntry[];
  /** Full HTML text with <em>, <strong>, <p>, <h1>-<h6> preserved */
  html: string;
  /** Plain text (stripped HTML) */
  plainText: string;
  /** Total "virtual pages" (estimated from char count, ~2000 chars/page) */
  totalPages: number;
  /** Per-heading text chunks: headingIndex → text between this heading and the next */
  chapterTexts: Map<number, string>;
}

const CHARS_PER_PAGE = 2000;

// ── Regex patterns for fallback TOC detection ──

const CHAPTER_PATTERNS = [
  /^(глава)\s+(\d+|[IVXLCDM]+|[а-яё]+(?:\s+[а-яё]+)?)\s*[.:]?\s*(.*)/i,
  /^(chapter)\s+(\d+|[IVXLCDM]+|[a-z]+(?:\s+[a-z]+)?)\s*[.:]?\s*(.*)/i,
  /^(акт)\s+(\d+|[IVXLCDM]+)\s*[.:]?\s*(.*)/i,
  /^(act)\s+(\d+|[IVXLCDM]+)\s*[.:]?\s*(.*)/i,
];

const PART_PATTERNS = [
  /^(часть)\s+(\d+|[IVXLCDM]+|[а-яё]+)\s*[.:]?\s*(.*)/i,
  /^(part)\s+(\d+|[IVXLCDM]+|[a-z]+)\s*[.:]?\s*(.*)/i,
  /^(книга)\s+(\d+|[IVXLCDM]+|[а-яё]+)\s*[.:]?\s*(.*)/i,
  /^(book)\s+(\d+|[IVXLCDM]+)\s*[.:]?\s*(.*)/i,
  /^(том)\s+(\d+|[IVXLCDM]+)\s*[.:]?\s*(.*)/i,
  /^(volume)\s+(\d+|[IVXLCDM]+)\s*[.:]?\s*(.*)/i,
];

/**
 * Extract structured content from a DOCX file.
 */
export async function extractFromDocx(file: File): Promise<DocxExtractResult> {
  const arrayBuffer = await file.arrayBuffer();

  // Mammoth converts DOCX → HTML preserving headings and inline styles
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Heading 4'] => h4:fresh",
      ],
    },
  );

  const html = result.value;

  // Parse HTML to extract headings + text
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const plainText = doc.body.textContent || "";
  const totalPages = Math.max(1, Math.ceil(plainText.length / CHARS_PER_PAGE));

  // ── Strategy 1: Heading-based TOC ──
  const headings = doc.querySelectorAll("h1, h2, h3, h4, h5, h6");
  const outline: TocEntry[] = [];
  const chapterTexts = new Map<number, string>();

  if (headings.length > 0) {
    // Collect heading info with DOM positions
    const headingInfos: { title: string; level: number; element: Element }[] = [];
    headings.forEach((h) => {
      const tagLevel = parseInt(h.tagName.substring(1), 10) - 1; // h1→0, h2→1, h3→2
      headingInfos.push({
        title: h.textContent?.trim() || "Untitled",
        level: tagLevel,
        element: h,
      });
    });

    // Build TocEntry list and extract text between headings
    const allElements = Array.from(doc.body.children);
    for (let i = 0; i < headingInfos.length; i++) {
      const info = headingInfos[i];
      const startIdx = allElements.indexOf(info.element);
      const endIdx = i + 1 < headingInfos.length
        ? allElements.indexOf(headingInfos[i + 1].element)
        : allElements.length;

      // Collect HTML between this heading and the next
      let chapterHtml = "";
      for (let j = startIdx + 1; j < endIdx; j++) {
        chapterHtml += allElements[j]?.outerHTML || "";
      }
      chapterTexts.set(i, chapterHtml);

      // Estimate "page number" from character offset
      const offsetChars = getTextBefore(doc.body, info.element).length;
      const pageNumber = Math.max(1, Math.ceil(offsetChars / CHARS_PER_PAGE));

      outline.push({
        title: info.title,
        pageNumber,
        level: info.level,
        children: [],
      });
    }
  }

  // ── Strategy 2: Regex fallback if no headings found ──
  if (outline.length === 0) {
    const paragraphs = doc.querySelectorAll("p");
    let charOffset = 0;

    paragraphs.forEach((p) => {
      const text = p.textContent?.trim() || "";
      if (!text) return;

      let matched = false;

      // Check part patterns (level 0)
      for (const pat of PART_PATTERNS) {
        const m = text.match(pat);
        if (m) {
          const suffix = m[3]?.trim();
          const title = suffix ? `${m[1]} ${m[2]}. ${suffix}` : `${m[1]} ${m[2]}`;
          outline.push({
            title,
            pageNumber: Math.max(1, Math.ceil(charOffset / CHARS_PER_PAGE)),
            level: 0,
            children: [],
          });
          matched = true;
          break;
        }
      }

      if (!matched) {
        for (const pat of CHAPTER_PATTERNS) {
          const m = text.match(pat);
          if (m) {
            const suffix = m[3]?.trim();
            const title = suffix ? `${m[1]} ${m[2]}. ${suffix}` : `${m[1]} ${m[2]}`;
            outline.push({
              title,
              pageNumber: Math.max(1, Math.ceil(charOffset / CHARS_PER_PAGE)),
              level: 0,
              children: [],
            });
            break;
          }
        }
      }

      charOffset += text.length;
    });

    // If regex found parts, promote chapters to level 1
    const hasParts = outline.some((e) => {
      for (const pat of PART_PATTERNS) {
        if (pat.test(e.title)) return true;
      }
      return false;
    });

    if (hasParts) {
      for (const e of outline) {
        let isPart = false;
        for (const pat of PART_PATTERNS) {
          if (pat.test(e.title)) { isPart = true; break; }
        }
        e.level = isPart ? 0 : 1;
      }
    }

    // Build chapter texts for regex-based entries
    if (outline.length > 0) {
      const allParagraphs = Array.from(paragraphs);
      let entryIdx = 0;
      let collecting = false;
      let currentHtml = "";

      for (const p of allParagraphs) {
        const text = p.textContent?.trim() || "";
        const isHeading = outline.some((e) => e.title === text || text.startsWith(e.title));

        if (isHeading) {
          if (collecting && entryIdx > 0) {
            chapterTexts.set(entryIdx - 1, currentHtml);
          }
          collecting = true;
          currentHtml = "";
          entryIdx++;
        } else if (collecting) {
          currentHtml += p.outerHTML;
        }
      }
      if (collecting && entryIdx > 0) {
        chapterTexts.set(entryIdx - 1, currentHtml);
      }
    }
  }

  return { outline, html, plainText, totalPages, chapterTexts };
}

/**
 * Extract text content for a specific chapter range from DOCX HTML.
 * Returns HTML with inline formatting preserved.
 */
export function extractDocxChapterText(
  chapterTexts: Map<number, string>,
  chapterIndex: number,
): string {
  return chapterTexts.get(chapterIndex) || "";
}

/**
 * Strip HTML tags to get plain text (for analysis pipeline compatibility).
 */
export function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}

/** Get all text content before a given element */
function getTextBefore(root: Element, target: Element): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (target.contains(node)) break;
    // Check if node is before target in DOM order
    const pos = target.compareDocumentPosition(node);
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
      text += node.textContent || "";
    }
  }
  return text;
}
