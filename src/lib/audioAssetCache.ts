/**
 * audioAssetCache — Global OPFS cache for atmosphere and SFX audio.
 *
 * Architecture (like irCache.ts):
 * - Global cache: OPFS root `atmo-cache/{filename}` — shared across all projects
 * - Per-scene reference: `atmospheres.json.audio_path` stores `atmo-cache/{filename}`
 *
 * Audio files are NOT duplicated into each project's OPFS.
 * Multiple projects can reference the same cached sound file.
 *
 * Flow:
 * 1. Generate/download sound → save to global `atmo-cache/`
 * 2. `atmospheres.json` stores reference path
 * 3. Player reads audio from global OPFS via reference
 */

const ATMO_CACHE_DIR = "atmo-cache";

// ── Global OPFS directory handle ────────────────────────────

async function getAtmoCacheDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(ATMO_CACHE_DIR, { create: true });
  } catch {
    return null;
  }
}

// ── Write to global cache ───────────────────────────────────

/**
 * Save an atmosphere/sfx audio blob to the global OPFS cache.
 * Returns the cache-relative path for use in atmospheres.json (e.g. "atmo-cache/rain-1234.mp3").
 */
export async function writeAtmosphereAudio(
  fileName: string,
  blob: Blob,
): Promise<string> {
  try {
    const dir = await getAtmoCacheDir();
    if (!dir) return "";
    const fh = await dir.getFileHandle(fileName, { create: true });
    const writable = await fh.createWritable();
    await writable.write(blob);
    await writable.close();
    return `${ATMO_CACHE_DIR}/${fileName}`;
  } catch (e) {
    console.error("[audioAssetCache] Failed to write:", fileName, e);
    return "";
  }
}

// ── Read from global cache ──────────────────────────────────

/**
 * Read atmosphere/sfx audio as ArrayBuffer from global OPFS cache.
 * @param cachePath Full cache path like "atmo-cache/filename.mp3"
 */
export async function readAtmosphereAudio(
  cachePath: string,
): Promise<ArrayBuffer | null> {
  try {
    const fileName = cachePath.replace(`${ATMO_CACHE_DIR}/`, "");
    const dir = await getAtmoCacheDir();
    if (!dir) return null;
    const fh = await dir.getFileHandle(fileName);
    const file = await fh.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Read atmosphere/sfx audio as Blob from global OPFS cache.
 */
export async function readAtmosphereBlob(
  cachePath: string,
): Promise<Blob | null> {
  try {
    const fileName = cachePath.replace(`${ATMO_CACHE_DIR}/`, "");
    const dir = await getAtmoCacheDir();
    if (!dir) return null;
    const fh = await dir.getFileHandle(fileName);
    return await fh.getFile();
  } catch {
    return null;
  }
}

/**
 * Check if an atmosphere/sfx audio file exists in global cache.
 */
export async function hasAtmosphereAudio(
  cachePath: string,
): Promise<boolean> {
  try {
    const fileName = cachePath.replace(`${ATMO_CACHE_DIR}/`, "");
    const dir = await getAtmoCacheDir();
    if (!dir) return false;
    await dir.getFileHandle(fileName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete an atmosphere/sfx audio file from global cache.
 */
export async function deleteAtmosphereAudio(
  cachePath: string,
): Promise<boolean> {
  try {
    const fileName = cachePath.replace(`${ATMO_CACHE_DIR}/`, "");
    const dir = await getAtmoCacheDir();
    if (!dir) return false;
    await dir.removeEntry(fileName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a Blob URL for an atmosphere audio file (for Tone.js / playback).
 * Uses an in-memory URL cache. Caller should revoke via revokeAtmoUrl().
 */
const atmoUrlCache = new Map<string, string>();

export async function getAtmoBlobUrl(cachePath: string): Promise<string | null> {
  const cached = atmoUrlCache.get(cachePath);
  if (cached) return cached;

  const blob = await readAtmosphereBlob(cachePath);
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  atmoUrlCache.set(cachePath, url);
  return url;
}

export function revokeAtmoUrl(cachePath: string): void {
  const url = atmoUrlCache.get(cachePath);
  if (url) {
    URL.revokeObjectURL(url);
    atmoUrlCache.delete(cachePath);
  }
}

export function revokeAllAtmoUrls(): void {
  for (const url of atmoUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  atmoUrlCache.clear();
}

// ── Migration helper: fetch from Supabase Storage into global cache ──

/**
 * Download an atmosphere/sfx file from Supabase Storage and save to global cache.
 * Used during Wipe-and-Deploy to populate cache with server-backed audio.
 * Returns the cache path, or empty string on failure.
 */
export async function downloadAtmosphereFromServer(
  supabaseStoragePath: string,
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
  return writeAtmosphereAudio(fileName, blob);
}
