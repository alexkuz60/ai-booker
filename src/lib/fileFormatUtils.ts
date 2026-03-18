/**
 * Shared utilities for handling both PDF and DOCX file formats.
 * Prevents hardcoding "source/book.pdf" across the codebase.
 */

export type FileFormat = "pdf" | "docx" | "fb2";

/** Detect format from file name */
export function detectFileFormat(fileName: string): FileFormat {
  if (/\.fb2$/i.test(fileName)) return "fb2";
  return /\.docx?$/i.test(fileName) ? "docx" : "pdf";
}

/** Get the local storage path for the source file */
export function getSourcePath(format: FileFormat): string {
  return format === "docx" ? "source/book.docx" : "source/book.pdf";
}

/** Try to find the source file in local storage, checking both formats */
export async function findSourceBlob(
  storage: { readBlob: (path: string) => Promise<Blob | null> },
): Promise<{ blob: Blob; format: FileFormat } | null> {
  // Try PDF first (more common), then DOCX
  const pdfBlob = await storage.readBlob("source/book.pdf");
  if (pdfBlob) return { blob: pdfBlob, format: "pdf" };

  const docxBlob = await storage.readBlob("source/book.docx");
  if (docxBlob) return { blob: docxBlob, format: "docx" };

  return null;
}

/** Strip file extension from name for display purposes */
export function stripFileExtension(name: string): string {
  return name.replace(/\.(pdf|docx?)$/i, "");
}

/** MIME type for the format */
export function getMimeType(format: FileFormat): string {
  return format === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/pdf";
}
