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

/** Strip file extension from name for display purposes */
export function stripFileExtension(name: string): string {
  return name.replace(/\.(pdf|docx?|fb2)$/i, "");
}

/** MIME type for the format */
export function getMimeType(format: FileFormat): string {
  if (format === "fb2") return "application/x-fictionbook+xml";
  return format === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/pdf";
}
