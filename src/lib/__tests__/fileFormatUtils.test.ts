import { describe, it, expect } from "vitest";
import {
  detectFileFormat,
  getSourcePath,
  stripFileExtension,
  getMimeType,
  findSourceBlob,
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

  it("defaults to pdf for unknown extensions", () => {
    expect(detectFileFormat("file.txt")).toBe("pdf");
    expect(detectFileFormat("noext")).toBe("pdf");
  });
});

describe("getSourcePath", () => {
  it("returns correct path for pdf", () => {
    expect(getSourcePath("pdf")).toBe("source/book.pdf");
  });

  it("returns correct path for docx", () => {
    expect(getSourcePath("docx")).toBe("source/book.docx");
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
});

describe("getMimeType", () => {
  it("returns PDF mime", () => {
    expect(getMimeType("pdf")).toBe("application/pdf");
  });

  it("returns DOCX mime", () => {
    expect(getMimeType("docx")).toContain("wordprocessingml");
  });
});

describe("findSourceBlob", () => {
  it("finds PDF blob", async () => {
    const storage = {
      readBlob: async (path: string) =>
        path === "source/book.pdf" ? new Blob(["pdf"]) : null,
    };
    const result = await findSourceBlob(storage);
    expect(result).not.toBeNull();
    expect(result!.format).toBe("pdf");
  });

  it("finds DOCX blob when no PDF", async () => {
    const storage = {
      readBlob: async (path: string) =>
        path === "source/book.docx" ? new Blob(["docx"]) : null,
    };
    const result = await findSourceBlob(storage);
    expect(result).not.toBeNull();
    expect(result!.format).toBe("docx");
  });

  it("returns null when no source file", async () => {
    const storage = { readBlob: async () => null };
    const result = await findSourceBlob(storage);
    expect(result).toBeNull();
  });

  it("prefers PDF over DOCX when both exist", async () => {
    const storage = {
      readBlob: async () => new Blob(["data"]),
    };
    const result = await findSourceBlob(storage);
    expect(result!.format).toBe("pdf");
  });
});
