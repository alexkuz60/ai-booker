/**
 * audioZip — export/import audio assets (TTS clips, renders, atmospheres)
 * as a standalone ZIP for cross-browser/cross-device transfer.
 *
 * The ZIP preserves relative paths within the project:
 *   chapters/{ch}/scenes/{sc}/tts/*.wav
 *   chapters/{ch}/scenes/{sc}/audio/atmosphere/*
 *   chapters/{ch}/renders/*
 */

import { zipSync, unzipSync } from "fflate";
import type { ProjectStorage } from "./projectStorage";
import { downloadBlob } from "./projectZip";

/** Audio path prefixes we collect */
const AUDIO_PATTERNS = ["/tts/", "/audio/atmosphere/", "/renders/"];

function isAudioPath(path: string): boolean {
  return AUDIO_PATTERNS.some((p) => path.includes(p));
}

/**
 * Recursively collect files from storage, filtering by predicate.
 */
async function collectFilesFiltered(
  storage: ProjectStorage,
  dir: string,
  predicate: (path: string) => boolean,
  result: Record<string, Uint8Array>,
): Promise<void> {
  let entries: string[];
  try {
    entries = await storage.listDir(dir);
  } catch {
    return;
  }

  const tasks: Promise<void>[] = [];

  for (const name of entries) {
    const fullPath = dir ? `${dir}/${name}` : name;

    tasks.push(
      (async () => {
        const blob = await storage.readBlob(fullPath);
        if (blob) {
          if (predicate(fullPath)) {
            result[fullPath] = new Uint8Array(await blob.arrayBuffer());
          }
          return;
        }
        // Directory — recurse
        await collectFilesFiltered(storage, fullPath, predicate, result);
      })(),
    );
  }

  await Promise.all(tasks);
}

export interface AudioZipProgress {
  phase: "collecting" | "zipping" | "done";
  fileCount?: number;
}

/**
 * Export all audio assets from the project as a ZIP blob.
 */
export async function exportAudioZip(
  storage: ProjectStorage,
  onProgress?: (p: AudioZipProgress) => void,
): Promise<Blob> {
  onProgress?.({ phase: "collecting" });

  const files: Record<string, Uint8Array> = {};
  await collectFilesFiltered(storage, "chapters", isAudioPath, files);

  const count = Object.keys(files).length;
  if (count === 0) {
    throw new Error("No audio files found to export");
  }

  onProgress?.({ phase: "zipping", fileCount: count });

  const zipped = zipSync(files, { level: 6 });
  const blob = new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" });

  onProgress?.({ phase: "done", fileCount: count });
  return blob;
}

/**
 * Import audio assets from a ZIP into the project storage.
 * Only writes files matching audio patterns; skips everything else.
 * Returns the number of files written.
 */
export async function importAudioZip(
  storage: ProjectStorage,
  zipBlob: Blob,
  onProgress?: (written: number, total: number) => void,
): Promise<number> {
  const buf = new Uint8Array(await zipBlob.arrayBuffer());
  const unzipped = unzipSync(buf);

  const entries = Object.entries(unzipped).filter(
    ([path, data]) => !path.endsWith("/") && data.length > 0 && isAudioPath(path),
  );

  const total = entries.length;
  let written = 0;

  // Write in batches of 10 for concurrency control
  const BATCH = 10;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async ([path, data]) => {
        const blob = new Blob([data.buffer as ArrayBuffer]);
        await storage.writeBlob(path, blob);
        written++;
        onProgress?.(written, total);
      }),
    );
  }

  return written;
}

/**
 * Trigger download of audio ZIP.
 */
export function downloadAudioZip(blob: Blob, projectName: string): void {
  const fileName = `${projectName || "project"}_audio.zip`;
  downloadBlob(blob, fileName);
}
