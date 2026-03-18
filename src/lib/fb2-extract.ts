/**
 * FB2 extraction — parses FictionBook XML format.
 * Produces TOC from <section>/<title> hierarchy,
 * preserves inline formatting as HTML (<em>, <strong>).
 */
import { type TocEntry } from "./pdf-extract";

export interface Fb2ExtractResult {
  /** Hierarchical TOC entries from <section>/<title> */
  outline: TocEntry[];
  /** Full HTML text with formatting preserved */
  html: string;
  /** Plain text (stripped tags) */
  plainText: string;
  /** Total "virtual pages" (estimated from char count, ~2000 chars/page) */
  totalPages: number;
  /** Per-section text chunks: sectionIndex → HTML between this title and next */
  chapterTexts: Map<number, string>;
}

const CHARS_PER_PAGE = 2000;

/**
 * Convert FB2 inline element to HTML.
 */
function fb2NodeToHtml(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.textContent || "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map(fb2NodeToHtml).join("");

  switch (tag) {
    case "emphasis":
      return `<em>${children}</em>`;
    case "strong":
      return `<strong>${children}</strong>`;
    case "strikethrough":
      return `<s>${children}</s>`;
    case "code":
      return `<code>${children}</code>`;
    case "sup":
      return `<sup>${children}</sup>`;
    case "sub":
      return `<sub>${children}</sub>`;
    case "a": {
      const href = el.getAttribute("l:href") || el.getAttribute("xlink:href") || "#";
      return `<a href="${escapeHtml(href)}">${children}</a>`;
    }
    default:
      return children;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert FB2 <p>, <poem>, <stanza>, <v>, <epigraph>, <cite> blocks to HTML.
 */
function fb2BlockToHtml(el: Element): string {
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case "p": {
      const inner = Array.from(el.childNodes).map(fb2NodeToHtml).join("");
      return `<p>${inner}</p>`;
    }
    case "empty-line":
      return "<br/>";
    case "poem":
    case "cite":
    case "epigraph": {
      const inner = Array.from(el.children).map(fb2BlockToHtml).join("");
      return `<blockquote>${inner}</blockquote>`;
    }
    case "stanza": {
      const inner = Array.from(el.children).map(fb2BlockToHtml).join("");
      return `<div class="stanza">${inner}</div>`;
    }
    case "v": {
      const inner = Array.from(el.childNodes).map(fb2NodeToHtml).join("");
      return `<p>${inner}</p>`;
    }
    case "subtitle": {
      const inner = Array.from(el.childNodes).map(fb2NodeToHtml).join("");
      return `<h4>${inner}</h4>`;
    }
    case "image": {
      // Skip images — they're binary data in FB2
      return "";
    }
    case "table": {
      return `<table>${el.innerHTML}</table>`;
    }
    default: {
      // Recurse for unknown containers
      const inner = Array.from(el.children).map(fb2BlockToHtml).join("");
      return inner;
    }
  }
}

interface SectionInfo {
  title: string;
  level: number;
  html: string;
  charOffset: number;
}

/**
 * Recursively walk <section> tree, collecting titles and content.
 */
function walkSections(
  section: Element,
  level: number,
  result: SectionInfo[],
  charCounter: { offset: number },
): void {
  // Extract title
  const titleEl = section.querySelector(":scope > title");
  let title = "Untitled";
  if (titleEl) {
    title = Array.from(titleEl.querySelectorAll("p"))
      .map((p) => p.textContent?.trim() || "")
      .filter(Boolean)
      .join(". ") || titleEl.textContent?.trim() || "Untitled";
  }

  // Collect content (non-section, non-title children)
  let contentHtml = "";
  const childSections: Element[] = [];

  for (const child of Array.from(section.children)) {
    const childTag = child.tagName.toLowerCase();
    if (childTag === "title") continue;
    if (childTag === "section") {
      childSections.push(child);
      continue;
    }
    contentHtml += fb2BlockToHtml(child);
  }

  const plainContent = contentHtml.replace(/<[^>]*>/g, "").trim();

  result.push({
    title,
    level,
    html: contentHtml,
    charOffset: charCounter.offset,
  });

  charCounter.offset += plainContent.length;

  // Recurse into child sections
  for (const childSection of childSections) {
    walkSections(childSection, level + 1, result, charCounter);
  }
}

/**
 * Extract structured content from an FB2 file.
 */
export async function extractFromFb2(file: File): Promise<Fb2ExtractResult> {
  const text = await file.text();

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, "application/xml");

  // Check for parsing errors
  const parseError = xmlDoc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid FB2 file: XML parsing failed");
  }

  // FB2 body sections
  const bodies = xmlDoc.querySelectorAll("body");
  const sections: SectionInfo[] = [];
  const charCounter = { offset: 0 };

  bodies.forEach((body) => {
    // Some FB2 files have <body name="notes"> for footnotes — process main body first
    const bodyName = body.getAttribute("name");
    if (bodyName === "notes" || bodyName === "footnotes") return;

    const topSections = body.querySelectorAll(":scope > section");
    if (topSections.length > 0) {
      topSections.forEach((sec) => walkSections(sec, 0, sections, charCounter));
    } else {
      // No sections — treat whole body as one chapter
      let html = "";
      for (const child of Array.from(body.children)) {
        html += fb2BlockToHtml(child);
      }
      sections.push({
        title: file.name.replace(/\.fb2$/i, ""),
        level: 0,
        html,
        charOffset: 0,
      });
    }
  });

  // Build full HTML and plain text
  const fullHtml = sections.map((s) => `<h${s.level + 1}>${escapeHtml(s.title)}</h${s.level + 1}>${s.html}`).join("\n");
  const plainText = fullHtml.replace(/<[^>]*>/g, "");
  const totalPages = Math.max(1, Math.ceil(plainText.length / CHARS_PER_PAGE));

  // Build outline and chapterTexts
  const outline: TocEntry[] = [];
  const chapterTexts = new Map<number, string>();

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    outline.push({
      title: sec.title,
      pageNumber: Math.max(1, Math.ceil(sec.charOffset / CHARS_PER_PAGE)),
      level: sec.level,
      children: [],
    });
    chapterTexts.set(i, sec.html);
  }

  return { outline, html: fullHtml, plainText, totalPages, chapterTexts };
}
