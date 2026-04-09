/**
 * audioAssetCache — project-OPFS-backed storage for atmosphere and SFX audio.
 *
 * V2 architecture: audio files are stored INSIDE the project OPFS at:
 *   chapters/{chapterId}/scenes/{sceneId}/audio/atmosphere/{filename}
 *
 * This replaces the legacy global OPFS cache + Supabase Storage approach.
 * No network fetches at playback time — everything is local.
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";

export type AudioAssetCategory = "atmosphere" | "sfx";

// ── Write audio to project OPFS ─────────────────────────────

/**
 * Save an atmosphere/sfx audio blob into the project's scene directory.
 * Returns the OPFS-relative path for use in atmospheres.json.
 */
export async function writeAtmosphereAudio(
  storage: ProjectStorage,
  sceneId: string,
  fileName: string,
  blob: Blob,
  chapterId?: string,
): Promise<string> {
  const filePath = paths.atmosphereClip(fileName, sceneId, chapterId);
  if (filePath.includes("__unresolved__")) {
    console.error(`[audioAssetCache] Cannot write — unresolved chapterId for scene ${sceneId}`);
    return "";
  }
  await storage.writeBlob(filePath, blob, blob.type || "audio/mpeg");
  return filePath;
}

// ── Read audio from project OPFS ────────────────────────────

/**
 * Read atmosphere/sfx audio as ArrayBuffer from project OPFS.
 */
export async function readAtmosphereAudio(
  storage: ProjectStorage,
  opfsPath: string,
): Promise<ArrayBuffer | null> {
  try {
    const blob = await storage.readBlob(opfsPath);
    if (!blob) return null;
    return await blob.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Check if an atmosphere/sfx audio file exists in project OPFS.
 */
export async function hasAtmosphereAudio(
  storage: ProjectStorage,
  opfsPath: string,
): Promise<boolean> {
  try {
    return await storage.exists(opfsPath);
  } catch {
    return false;
  }
}

/**
 * Delete an atmosphere/sfx audio file from project OPFS (via guardedDelete).
 */
export async function deleteAtmosphereAudio(
  storage: ProjectStorage,
  opfsPath: string,
): Promise<boolean> {
  const { guardedDelete } = await import("@/lib/storageGuard");
  return guardedDelete(storage, opfsPath, "audioAssetCache.deleteAtmosphereAudio");
}

// ── Migration helper: fetch from Supabase Storage into project OPFS ──

/**
 * Download an atmosphere/sfx file from Supabase Storage and save to project OPFS.
 * Used during Wipe-and-Deploy to populate the project with server-backed audio.
 * Returns the OPFS-relative path, or empty string on failure.
 */
export async function downloadAtmosphereFromServer(
  storage: ProjectStorage,
  sceneId: string,
  supabaseStoragePath: string,
  chapterId?: string,
): Promise<string> {
  const { supabase } = await import("@/integrations/supabase/client");

  const { data: urlData } = await supabase.storage
    .from("user-media")
    .createSignedUrl(supabaseStoragePath, 600);

  if (!urlData?.signedUrl) {
    console.warn(`[audioAssetCache] No signed URL for: ${supabaseStoragePath}`);
    return "";
  }

  const response = await fetch(urlData.signedUrl);
  if (!response.ok) {
    console.warn(`[audioAssetCache] Fetch failed: ${response.status} for ${supabaseStoragePath}`);
    return "";
  }

  const blob = await response.blob();
  const fileName = supabaseStoragePath.split("/").pop() || `atmo-${Date.now()}.mp3`;
  return writeAtmosphereAudio(storage, sceneId, fileName, blob, chapterId);
}
