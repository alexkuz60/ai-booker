/**
 * translationBackup — pack/unpack translation lang-subfolders for cloud backup.
 *
 * Push: collects all files from lang-subfolders + synopsis/ into a ZIP,
 *       uploads to Supabase Storage (book-uploads/{userId}/translation_{bookId}.zip).
 *
 * Restore: downloads the ZIP, unpacks into the OPFS project.
 */

import { zipSync, unzipSync, strFromU8 } from "fflate";
import { supabase } from "@/integrations/supabase/client";
import type { ProjectStorage, ProjectMeta } from "./projectStorage";
import type { SceneIndexData } from "./sceneIndex";
import { paths } from "./projectPaths";

// Files to look for in each lang-subfolder per scene
const LANG_FILES = [
  "storyboard.json",
  "radar-literal.json",
  "radar-literary.json",
  "radar-critique.json",
  "audio_meta.json",
  "mixer_state.json",
  "clip_plugins.json",
];

// ─── Pack ────────────────────────────────────────────────────

/**
 * Collect all translation-related files into a ZIP blob.
 * Includes: lang-subfolders in every scene + synopsis/ folder.
 */
export async function packTranslationZip(
  storage: ProjectStorage,
  langs: string[],
): Promise<Blob | null> {
  const files: Record<string, Uint8Array> = {};

  // 1. Collect scene-level lang files
  const sceneIndex = await storage.readJSON<SceneIndexData>(paths.sceneIndex());
  const entries = sceneIndex?.entries ?? {};

  for (const [sceneId, entry] of Object.entries(entries)) {
    const chapterId = entry.chapterId;
    if (!chapterId) continue;

    for (const lang of langs) {
      // JSON files in lang subfolder
      for (const fileName of LANG_FILES) {
        const filePath = `chapters/${chapterId}/scenes/${sceneId}/${lang}/${fileName}`;
        const blob = await storage.readBlob(filePath).catch(() => null);
        if (blob && blob.size > 0) {
          files[filePath] = new Uint8Array(await blob.arrayBuffer());
        }
      }

      // TTS audio dir: chapters/{ch}/scenes/{sc}/{lang}/audio/tts/
      const ttsDir = `chapters/${chapterId}/scenes/${sceneId}/${lang}/audio/tts`;
      try {
        const ttsFiles = await storage.listDir(ttsDir);
        for (const f of ttsFiles) {
          const fp = `${ttsDir}/${f}`;
          const blob = await storage.readBlob(fp).catch(() => null);
          if (blob && blob.size > 0) {
            files[fp] = new Uint8Array(await blob.arrayBuffer());
          }
        }
      } catch {
        // no TTS dir — ok
      }
    }
  }

  // 2. Collect synopsis/ folder
  try {
    const synopsisFiles = await storage.listDir("synopsis");
    for (const f of synopsisFiles) {
      const fp = `synopsis/${f}`;
      const blob = await storage.readBlob(fp).catch(() => null);
      if (blob && blob.size > 0) {
        files[fp] = new Uint8Array(await blob.arrayBuffer());
      }
    }
  } catch {
    // no synopsis dir — ok
  }

  if (Object.keys(files).length === 0) return null;

  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" });
}

// ─── Push ────────────────────────────────────────────────────

/**
 * Pack translation data and upload to Supabase Storage.
 * Also saves translationLanguages to user_settings.
 */
export async function pushTranslationBackup(
  storage: ProjectStorage,
  bookId: string,
  userId: string,
  onProgress?: (detail: string) => void,
): Promise<{ fileCount: number; uploaded: boolean }> {
  const meta = await storage.readJSON<ProjectMeta>("project.json");
  const langs = meta?.translationLanguages ?? [];
  if (langs.length === 0) return { fileCount: 0, uploaded: false };

  onProgress?.("Packing...");
  const zipBlob = await packTranslationZip(storage, langs);
  if (!zipBlob) return { fileCount: 0, uploaded: false };

  const storagePath = `${userId}/translation_${bookId}.zip`;

  onProgress?.("Uploading...");
  // Remove existing file first (upsert)
  await supabase.storage.from("book-uploads").remove([storagePath]);
  const { error } = await supabase.storage
    .from("book-uploads")
    .upload(storagePath, zipBlob, { contentType: "application/zip" });

  if (error) {
    console.error("[TranslationBackup] Upload failed:", error);
    throw new Error(`Translation backup upload failed: ${error.message}`);
  }

  // Save translationLanguages metadata to user_settings
  await supabase.from("user_settings").upsert(
    {
      user_id: userId,
      setting_key: `translation-langs-${bookId}`,
      setting_value: langs as any,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,setting_key" },
  );

  console.log(`[TranslationBackup] Uploaded ${storagePath} (${(zipBlob.size / 1024).toFixed(1)}KB)`);
  return { fileCount: Object.keys(await countFilesInZip(zipBlob)).length, uploaded: true };
}

async function countFilesInZip(zipBlob: Blob): Promise<Record<string, true>> {
  const buf = new Uint8Array(await zipBlob.arrayBuffer());
  const unzipped = unzipSync(buf);
  const result: Record<string, true> = {};
  for (const path of Object.keys(unzipped)) {
    if (!path.endsWith("/")) result[path] = true;
  }
  return result;
}

// ─── Restore ─────────────────────────────────────────────────

/**
 * Download translation backup ZIP from Storage and unpack into OPFS project.
 * Also restores translationLanguages in project.json.
 */
export async function restoreTranslationBackup(
  storage: ProjectStorage,
  bookId: string,
  userId: string,
  onProgress?: (detail: string) => void,
): Promise<{ fileCount: number; langs: string[] }> {
  // 1. Check if translation languages metadata exists
  const { data: settingRow } = await supabase
    .from("user_settings")
    .select("setting_value")
    .eq("user_id", userId)
    .eq("setting_key", `translation-langs-${bookId}`)
    .maybeSingle();

  const langs = Array.isArray(settingRow?.setting_value)
    ? (settingRow.setting_value as string[])
    : [];

  if (langs.length === 0) return { fileCount: 0, langs: [] };

  // 2. Download ZIP
  onProgress?.("Downloading...");
  const storagePath = `${userId}/translation_${bookId}.zip`;
  const { data: fileData, error } = await supabase.storage
    .from("book-uploads")
    .download(storagePath);

  if (error || !fileData) {
    console.warn("[TranslationBackup] No backup found:", storagePath, error?.message);
    return { fileCount: 0, langs };
  }

  // 3. Unpack into project
  onProgress?.("Unpacking...");
  const buf = new Uint8Array(await fileData.arrayBuffer());
  const unzipped = unzipSync(buf);

  let count = 0;
  const writes: Promise<void>[] = [];

  for (const [path, data] of Object.entries(unzipped)) {
    if (path.endsWith("/") || data.length === 0) continue;
    count++;

    const blob = new Blob([data.buffer as ArrayBuffer]);

    if (path.endsWith(".json")) {
      try {
        const text = strFromU8(data);
        const parsed = JSON.parse(text);
        writes.push(storage.writeJSON(path, parsed));
        continue;
      } catch {
        // fallback to blob
      }
    }

    writes.push(storage.writeBlob(path, blob));
  }

  await Promise.all(writes);

  // 4. Update project.json with translationLanguages
  try {
    const meta = await storage.readJSON<ProjectMeta>("project.json");
    if (meta) {
      const existing = meta.translationLanguages ?? [];
      const merged = [...new Set([...existing, ...langs])];
      if (merged.length !== existing.length || merged.some((l, i) => l !== existing[i])) {
        await storage.writeJSON("project.json", {
          ...meta,
          translationLanguages: merged,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  } catch {}

  console.log(`[TranslationBackup] Restored ${count} files, langs: ${langs.join(",")}`);
  return { fileCount: count, langs };
}
