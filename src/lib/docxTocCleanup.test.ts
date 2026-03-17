import { describe, expect, it } from "vitest";
import { isLikelyTocOnlyHtml, normalizeTocTitle, pruneDocxTocArtifacts, stripTrailingPageNumber } from "./docxTocCleanup";
import type { TocEntry } from "./pdf-extract";

describe("docxTocCleanup", () => {
  it("strips trailing page numbers from TOC titles", () => {
    expect(stripTrailingPageNumber("КНИГА ПЕРВАЯ. ПРИМУС 6")).toBe("КНИГА ПЕРВАЯ. ПРИМУС");
    expect(normalizeTocTitle("Глава 1. КОЗЁЛ: БИОГРАФИЯ 378")).toBe("глава 1. козёл: биография");
  });

  it("detects TOC-only HTML blocks made of heading lines", () => {
    const knownTitles = new Set([
      "книга первая. примус",
      "глава 1. козёл: биография",
      "глава 2. сороковая ночь",
    ]);

    expect(
      isLikelyTocOnlyHtml(
        "<p>Глава 1. КОЗЁЛ: БИОГРАФИЯ 378</p><p>Глава 2. СОРОКОВАЯ НОЧЬ 389</p>",
        knownTitles,
      ),
    ).toBe(true);

    expect(
      isLikelyTocOnlyHtml(
        "<p>Это уже настоящий текст сцены. Здесь начинается действие и есть полноценное предложение.</p>",
        knownTitles,
      ),
    ).toBe(false);
  });

  it("removes TOC container artifacts and reindexes chapter texts", () => {
    const outline: TocEntry[] = [
      { title: "КНИГА ПЕРВАЯ. ПРИМУС 6", pageNumber: 6, level: 0, children: [] },
      { title: "Глава 1. КОЗЁЛ: БИОГРАФИЯ 378", pageNumber: 378, level: 1, children: [] },
      { title: "Глава 2. СОРОКОВАЯ НОЧЬ", pageNumber: 389, level: 1, children: [] },
    ];

    const chapterTexts = new Map<number, string>([
      [0, "<p>Глава 1. КОЗЁЛ: БИОГРАФИЯ 378</p><p>Глава 2. СОРОКОВАЯ НОЧЬ 389</p>"],
      [1, "<p>Глава 1.1. ХМУРОЕ УТРО 380</p><p>Глава 1.2. КОЗЛИНЫЙ РАЙ 381</p>"],
      [2, "<p>Это уже настоящий текст сцены. Здесь начинается действие и есть полноценное предложение.</p>"],
    ]);

    const cleaned = pruneDocxTocArtifacts(outline, chapterTexts);

    expect(cleaned.outline).toHaveLength(1);
    expect(cleaned.outline[0].title).toBe("Глава 2. СОРОКОВАЯ НОЧЬ");
    expect(cleaned.chapterTexts.get(0)).toContain("настоящий текст сцены");
    expect(cleaned.removedCount).toBe(2);
  });
});
