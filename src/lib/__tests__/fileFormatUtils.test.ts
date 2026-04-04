import { describe, it, expect } from "vitest";
import {
  detectFileFormat,
  stripFileExtension,
  getMimeType,
} from "@/lib/fileFormatUtils";

describe("detectFileFormat", () => {
  it("detects PDF", () => {
    expect(detectFileFormat("book.pdf")).toBe("pdf");
    expect(detectFileFormat("My Book.PDF")).toBe("pdf");
  });

  it("detects DOCX", () => {
    expect(detectFileFormat("book.docx")).toBe("docx");
    expect(detectFileFormat("Report.DOCX")).toBe("docx");
  });

  it("detects DOC as docx", () => {
    expect(detectFileFormat("old.doc")).toBe("docx");
    expect(detectFileFormat("legacy.DOC")).toBe("docx");
  });

  it("detects FB2", () => {
    expect(detectFileFormat("book.fb2")).toBe("fb2");
    expect(detectFileFormat("Novel.FB2")).toBe("fb2");
  });

  it("defaults to pdf for unknown extensions", () => {
    expect(detectFileFormat("file.txt")).toBe("pdf");
    expect(detectFileFormat("noext")).toBe("pdf");
  });
});

describe("stripFileExtension", () => {
  it("strips .pdf", () => {
    expect(stripFileExtension("My Book.pdf")).toBe("My Book");
  });

  it("strips .docx", () => {
    expect(stripFileExtension("Report.docx")).toBe("Report");
  });

  it("strips .doc", () => {
    expect(stripFileExtension("Legacy.doc")).toBe("Legacy");
  });

  it("is case insensitive", () => {
    expect(stripFileExtension("BOOK.PDF")).toBe("BOOK");
  });

  it("leaves other extensions alone", () => {
    expect(stripFileExtension("file.txt")).toBe("file.txt");
  });

  it("strips .fb2", () => {
    expect(stripFileExtension("Novel.fb2")).toBe("Novel");
  });
});

describe("getMimeType", () => {
  it("returns PDF mime", () => {
    expect(getMimeType("pdf")).toBe("application/pdf");
  });

  it("returns DOCX mime", () => {
    expect(getMimeType("docx")).toContain("wordprocessingml");
  });
});
