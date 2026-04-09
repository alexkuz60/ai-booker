/**
 * localAudioProvider — reads audio from OPFS and provides it to Tone.js / AudioEngine.
 *
 * Two storage domains:
 * 1. Project OPFS (TTS clips, renders): read via ProjectStorage
 * 2. Global OPFS cache (atmo-cache/): read via audioAssetCache
 *
 * Paths starting with "atmo-cache/" are routed to the global cache.
 * All other paths go through ProjectStorage.
 */

import type { ProjectStorage } from "@/lib/projectStorage";

// ── In-memory URL cache (revoked on cleanup) ────────────────

const blobUrlCache = new Map<string, string>();

/** Check if path belongs to global atmo cache */
function isGlobalCachePath(path: string): boolean {
  return path.startsWith("atmo-cache/");
}

/**
 * Get an audio ArrayBuffer directly from OPFS.
 * Routes to global cache or project storage based on path prefix.
 */
export async function getAudioBuffer(
  storage: ProjectStorage,
  opfsPath: string,
): Promise<ArrayBuffer | null> {
  try {
    if (isGlobalCachePath(opfsPath)) {
      const { readAtmosphereAudio } = await import("@/lib/audioAssetCache");
      return await readAtmosphereAudio(opfsPath);
    }
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
    let blob: Blob | null = null;

    if (isGlobalCachePath(opfsPath)) {
      const { readAtmosphereBlob } = await import("@/lib/audioAssetCache");
      blob = await readAtmosphereBlob(opfsPath);
    } else {
      blob = await storage.readBlob(opfsPath);
    }

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
    if (isGlobalCachePath(opfsPath)) {
      const { hasAtmosphereAudio } = await import("@/lib/audioAssetCache");
      return await hasAtmosphereAudio(opfsPath);
    }
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
    if (isGlobalCachePath(opfsPath)) {
      const { readAtmosphereBlob } = await import("@/lib/audioAssetCache");
      return await readAtmosphereBlob(opfsPath);
    }
    return await storage.readBlob(opfsPath);
  } catch {
    return null;
  }
}
