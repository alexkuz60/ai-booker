/**
 * localAudioProvider — reads audio from OPFS and provides it to Tone.js / AudioEngine.
 *
 * Replaces the legacy flow of:
 *   supabase.storage.createSignedUrl() → fetch → stemCache → AudioEngine
 * with:
 *   OPFS.readBlob() → BlobURL or ArrayBuffer → AudioEngine
 *
 * All audio (TTS, atmosphere, renders) is stored locally in the project OPFS.
 */

import type { ProjectStorage } from "@/lib/projectStorage";

// ── In-memory URL cache (revoked on cleanup) ────────────────

const blobUrlCache = new Map<string, string>();

/**
 * Get an audio ArrayBuffer directly from OPFS.
 * Returns null if the file doesn't exist.
 */
export async function getAudioBuffer(
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
 * Get a Blob URL for an audio file in OPFS.
 * URLs are cached and reused; call `revokeAudioUrl()` or `revokeAllAudioUrls()` to free memory.
 */
export async function getAudioBlobUrl(
  storage: ProjectStorage,
  opfsPath: string,
): Promise<string | null> {
  // Check cache first
  const cached = blobUrlCache.get(opfsPath);
  if (cached) return cached;

  try {
    const blob = await storage.readBlob(opfsPath);
    if (!blob) return null;

    const url = URL.createObjectURL(blob);
    blobUrlCache.set(opfsPath, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Revoke a specific Blob URL and remove from cache.
 */
export function revokeAudioUrl(opfsPath: string): void {
  const url = blobUrlCache.get(opfsPath);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrlCache.delete(opfsPath);
  }
}

/**
 * Revoke all cached Blob URLs (e.g. when switching scenes/chapters).
 */
export function revokeAllAudioUrls(): void {
  for (const url of blobUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobUrlCache.clear();
}

/**
 * Check if an audio file exists in OPFS.
 */
export async function hasAudioFile(
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
 * Get audio as a Blob (useful for download/export).
 */
export async function getAudioBlob(
  storage: ProjectStorage,
  opfsPath: string,
): Promise<Blob | null> {
  try {
    return await storage.readBlob(opfsPath);
  } catch {
    return null;
  }
}
