/**
 * ZIP export/import helpers for ProjectStorage.
 * Uses fflate for lightweight, browser-native zip operations.
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import type { ProjectStorage } from "./projectStorage";

/**
 * Recursively collect all files from a ProjectStorage into a flat path→Uint8Array map.
 */
async function collectFiles(
  storage: ProjectStorage,
  dir: string,
  result: Record<string, Uint8Array>,
): Promise<void> {
  const entries = await storage.listDir(dir);
  const tasks: Promise<void>[] = [];

  for (const name of entries) {
    const fullPath = dir ? `${dir}/${name}` : name;

    tasks.push(
      (async () => {
        // Try as file first (read blob)
        const blob = await storage.readBlob(fullPath);
        if (blob) {
          const buf = new Uint8Array(await blob.arrayBuffer());
          result[fullPath] = buf;
          return;
        }
        // If no blob, it might be a directory — recurse
        await collectFiles(storage, fullPath, result);
      })(),
    );
  }

  await Promise.all(tasks);
}

/**
 * Export all project files as a ZIP blob.
 */
export async function exportProjectZip(storage: ProjectStorage): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  await collectFiles(storage, "", files);

  if (Object.keys(files).length === 0) {
    throw new Error("Project is empty — nothing to export");
  }

  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" });
}

/**
 * Import a ZIP blob into a ProjectStorage, overwriting existing files.
 */
/**
 * Root-level legacy directories that must never be restored from ZIP.
 * These are V1 remnants and have no place in V2 project structure.
 */
const LEGACY_ROOT_PREFIXES = ["source/", "audio/", "montage/", "scenes/"];

function isLegacyPath(path: string): boolean {
  return LEGACY_ROOT_PREFIXES.some((p) => path.startsWith(p));
}

export async function importProjectZip(storage: ProjectStorage, zipBlob: Blob): Promise<number> {
  const buf = new Uint8Array(await zipBlob.arrayBuffer());
  const unzipped = unzipSync(buf);

  const writes: Promise<void>[] = [];
  let count = 0;
  let skipped = 0;

  for (const [path, data] of Object.entries(unzipped)) {
    // Skip directory entries (empty content, path ends with /)
    if (path.endsWith("/") || data.length === 0) continue;

    // Block legacy root-level directories from being restored
    if (isLegacyPath(path)) {
      skipped++;
      continue;
    }

    count++;

    const blob = new Blob([data.buffer as ArrayBuffer]);

    // JSON files: validate and write as JSON for consistency
    if (path.endsWith(".json")) {
      try {
        const text = strFromU8(data);
        const parsed = JSON.parse(text);
        writes.push(storage.writeJSON(path, parsed));
        continue;
      } catch {
        // If JSON parse fails, write as blob
      }
    }

    writes.push(storage.writeBlob(path, blob));
  }

  if (skipped > 0) {
    console.warn(`[importProjectZip] Skipped ${skipped} legacy files (source/, audio/, montage/, scenes/)`);
  }

  await Promise.all(writes);
  return count;
}

/**
 * Trigger browser download of a Blob as a file.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
