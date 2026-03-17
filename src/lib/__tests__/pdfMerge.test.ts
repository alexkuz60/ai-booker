import { describe, it, expect } from "vitest";
import { mergeOutlineWithTextToc, type TocEntry } from "@/lib/pdf-extract";

describe("mergeOutlineWithTextToc", () => {
  it("returns outline unchanged when textToc is empty", () => {
    const outline: TocEntry[] = [
      { title: "Part 1", pageNumber: 1, level: 0, children: [
        { title: "Ch 1", pageNumber: 2, level: 1, children: [] },
      ]},
    ];
    const result = mergeOutlineWithTextToc(outline, []);
    expect(result).toEqual(outline);
  });

  it("preserves hierarchy when inserting new entries", () => {
    const outline: TocEntry[] = [
      { title: "Act I", pageNumber: 1, level: 0, children: [
        { title: "Chapter 1", pageNumber: 5, level: 1, children: [] },
        { title: "Chapter 3", pageNumber: 30, level: 1, children: [] },
      ]},
      { title: "Act II", pageNumber: 50, level: 0, children: [] },
    ];

    const textToc: TocEntry[] = [
      { title: "Chapter 2", pageNumber: 15, level: 1, children: [] },
    ];

    const result = mergeOutlineWithTextToc(outline, textToc);

    // Act I should still have children, now including Chapter 2
    expect(result[0].title).toBe("Act I");
    expect(result[0].children.length).toBe(3);
    expect(result[0].children[1].title).toBe("Chapter 2");
    expect(result[0].children[1].pageNumber).toBe(15);

    // Act II should be unchanged
    expect(result[1].title).toBe("Act II");
  });

  it("does not flatten the outline (B5 regression)", () => {
    const outline: TocEntry[] = [
      { title: "Part 1", pageNumber: 1, level: 0, children: [
        { title: "Ch 1", pageNumber: 2, level: 1, children: [] },
        { title: "Ch 2", pageNumber: 10, level: 1, children: [] },
      ]},
      { title: "Part 2", pageNumber: 20, level: 0, children: [
        { title: "Ch 3", pageNumber: 21, level: 1, children: [] },
      ]},
    ];

    const textToc: TocEntry[] = [
      { title: "Ch 4", pageNumber: 30, level: 1, children: [] },
    ];

    const result = mergeOutlineWithTextToc(outline, textToc);

    // Top-level should still be 2 parts, not flattened
    expect(result.length).toBe(2);
    expect(result[0].children.length).toBe(2); // Part 1 unchanged
    expect(result[1].children.length).toBe(2); // Part 2 got Ch 4
    expect(result[1].children[1].title).toBe("Ch 4");
  });

  it("skips entries that overlap with outline pages", () => {
    const outline: TocEntry[] = [
      { title: "Chapter 1", pageNumber: 5, level: 0, children: [] },
    ];

    const textToc: TocEntry[] = [
      { title: "Chapter 1 duplicate", pageNumber: 5, level: 0, children: [] },
      { title: "Chapter 2", pageNumber: 20, level: 0, children: [] },
    ];

    const result = mergeOutlineWithTextToc(outline, textToc);
    expect(result.length).toBe(2);
    expect(result[1].title).toBe("Chapter 2");
  });

  it("does not mutate original outline", () => {
    const outline: TocEntry[] = [
      { title: "Part 1", pageNumber: 1, level: 0, children: [] },
    ];
    const textToc: TocEntry[] = [
      { title: "Ch 1", pageNumber: 5, level: 1, children: [] },
    ];

    mergeOutlineWithTextToc(outline, textToc);
    expect(outline[0].children.length).toBe(0); // original unchanged
  });
});
