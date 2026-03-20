/**
 * К4: In-memory cache for DOCX/FB2 chapter texts.
 * NEVER stored in sessionStorage/localStorage — OPFS is the only persistent source.
 * This module-level Map acts as a runtime cache; on miss, callers re-extract from OPFS.
 */

const _chapterTextsCache = new Map<number, string>();
let _docxHtmlCache: string | null = null;

export function setChapterTextsCache(entries: Map<number, string>) {
  _chapterTextsCache.clear();
  for (const [k, v] of entries) {
    _chapterTextsCache.set(k, v);
  }
}

export function getChapterTextFromCache(idx: number): string | null {
  return _chapterTextsCache.get(idx) ?? null;
}

export function hasChapterTextsCache(): boolean {
  return _chapterTextsCache.size > 0;
}

export function clearChapterTextsCache() {
  _chapterTextsCache.clear();
  _docxHtmlCache = null;
}

export function setDocxHtmlCache(html: string) {
  _docxHtmlCache = html;
}

export function getDocxHtmlCache(): string | null {
  return _docxHtmlCache;
}
