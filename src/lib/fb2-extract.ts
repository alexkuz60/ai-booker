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
const XML_DECLARATION_SCAN_BYTES = 512;
const FALLBACK_ENCODINGS = ["utf-8", "windows-1251", "koi8-r", "ibm866"] as const;
const ENCODING_ALIASES: Record<string, string> = {
  utf8: "utf-8",
  "utf-8": "utf-8",
  cp1251: "windows-1251",
  windows1251: "windows-1251",
  "windows-1251": "windows-1251",
  "win-1251": "windows-1251",
  koi8r: "koi8-r",
  "koi8-r": "koi8-r",
  cp866: "ibm866",
  ibm866: "ibm866",
  "utf-16le": "utf-16le",
  "utf-16be": "utf-16be",
};

function normalizeEncoding(encoding: string | null | undefined): string | null {
  if (!encoding) return null;
  const normalized = encoding.trim().toLowerCase().replace(/[_\s]+/g, "-");
  return ENCODING_ALIASES[normalized] || normalized;
}

function detectBomEncoding(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf-8";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return "utf-16le";
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return "utf-16be";
  }
  return null;
}

function detectXmlDeclarationEncoding(bytes: Uint8Array): string | null {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, XML_DECLARATION_SCAN_BYTES));
  const match = head.match(/<\?xml[^>]*encoding=["']([^"']+)["']/i);
  return normalizeEncoding(match?.[1]);
}

function decodeWithEncoding(bytes: Uint8Array, encoding: string): string | null {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return null;
  }
}

function scoreDecodedText(text: string): number {
  const replacementCount = (text.match(/�/g) || []).length;
  const cyrillicCount = (text.match(/[А-Яа-яЁё]/g) || []).length;
  const xmlHints = ["<fictionbook", "<body", "<section", "<title"].reduce(
    (sum, token) => sum + (text.toLowerCase().includes(token) ? 25 : 0),
    0,
  );
  return xmlHints + cyrillicCount * 2 - replacementCount * 30;
}

function parseXml(text: string): XMLDocument | null {
  const xmlDoc = new DOMParser().parseFromString(text, "application/xml");
  return xmlDoc.querySelector("parsererror") ? null : xmlDoc;
}

async function readBinaryFile(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }

  return new Response(file).arrayBuffer();
}

export function decodeFb2Buffer(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const candidates = [
    detectBomEncoding(bytes),
    detectXmlDeclarationEncoding(bytes),
    ...FALLBACK_ENCODINGS,
  ].filter((encoding, index, arr): encoding is string => !!encoding && arr.indexOf(encoding) === index);

  let bestText: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const encoding of candidates) {
    const decoded = decodeWithEncoding(bytes, encoding);
    if (!decoded) continue;

    const score = scoreDecodedText(decoded);
    if (score > bestScore) {
      bestScore = score;
      bestText = decoded;
    }

    if (!decoded.includes("�") && parseXml(decoded)) {
      return decoded;
    }
  }

  if (bestText) return bestText;
  return new TextDecoder("utf-8").decode(bytes);
}

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
  const titleEl = section.querySelector(":scope > title");
  let title = "Untitled";
  if (titleEl) {
    title = Array.from(titleEl.querySelectorAll("p"))
      .map((p) => p.textContent?.trim() || "")
      .filter(Boolean)
      .join(". ") || titleEl.textContent?.trim() || "Untitled";
  }

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

  for (const childSection of childSections) {
    walkSections(childSection, level + 1, result, charCounter);
  }
}

/**
 * Extract structured content from an FB2 file.
 */
export async function extractFromFb2(file: File): Promise<Fb2ExtractResult> {
  const text = decodeFb2Buffer(await file.arrayBuffer());
  const xmlDoc = parseXml(text);

  if (!xmlDoc) {
    throw new Error("Invalid FB2 file: XML parsing failed");
  }

  const bodies = xmlDoc.querySelectorAll("body");
  const sections: SectionInfo[] = [];
  const charCounter = { offset: 0 };

  bodies.forEach((body) => {
    const bodyName = body.getAttribute("name");
    if (bodyName === "notes" || bodyName === "footnotes") return;

    const topSections = body.querySelectorAll(":scope > section");
    if (topSections.length > 0) {
      topSections.forEach((sec) => walkSections(sec, 0, sections, charCounter));
    } else {
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

  const fullHtml = sections.map((s) => `<h${s.level + 1}>${escapeHtml(s.title)}</h${s.level + 1}>${s.html}`).join("\n");
  const plainText = fullHtml.replace(/<[^>]*>/g, "");
  const totalPages = Math.max(1, Math.ceil(plainText.length / CHARS_PER_PAGE));

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
