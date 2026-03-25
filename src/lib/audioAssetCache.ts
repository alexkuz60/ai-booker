/**
 * audioAssetCache — Global OPFS-based cache for atmosphere and SFX audio files.
 *
 * Architecture (mirrors irCache.ts):
 * - Separate OPFS directories: `atmo-cache/` and `sfx-cache/` at root
 * - Cache key = storage path (userId/category/filename)
 * - Files are per-user, shared across all books
 */

import { supabase } from "@/integrations/supabase/client";

const ATMO_CACHE_DIR = "atmo-cache";
const SFX_CACHE_DIR = "sfx-cache";

export type AudioAssetCategory = "atmosphere" | "sfx";

function dirNameForCategory(category: AudioAssetCategory): string {
  return category === "atmosphere" ? ATMO_CACHE_DIR : SFX_CACHE_DIR;
}

/** Sanitize storage path to a safe filename for OPFS */
function pathToFileName(storagePath: string): string {
  return storagePath.replace(/\//g, "__");
}

function fileNameToPath(fileName: string): string {
  return fileName.replace(/__/g, "/");
}

// ── OPFS directory helpers ──────────────────────────────────

async function getCacheDir(category: AudioAssetCategory): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(dirNameForCategory(category), { create: true });
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────

export async function getAudioAssetFromCache(
  category: AudioAssetCategory,
  storagePath: string,
): Promise<ArrayBuffer | null> {
  try {
    const dir = await getCacheDir(category);
    if (!dir) return null;
    const fh = await dir.getFileHandle(pathToFileName(storagePath));
    const file = await fh.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

export async function putAudioAssetToCache(
  category: AudioAssetCategory,
  storagePath: string,
  data: ArrayBuffer,
): Promise<void> {
  try {
    const dir = await getCacheDir(category);
    if (!dir) return;
    const fh = await dir.getFileHandle(pathToFileName(storagePath), { create: true });
    const writable = await fh.createWritable();
    await writable.write(data);
    await writable.close();
  } catch (e) {
    console.warn(`[audioAssetCache] Failed to write ${category}:`, storagePath, e);
  }
}

export async function isAudioAssetCached(
  category: AudioAssetCategory,
  storagePath: string,
): Promise<boolean> {
  try {
    const dir = await getCacheDir(category);
    if (!dir) return false;
    await dir.getFileHandle(pathToFileName(storagePath));
    return true;
  } catch {
    return false;
  }
}

export async function listCachedAudioAssets(category: AudioAssetCategory): Promise<string[]> {
  try {
    const dir = await getCacheDir(category);
    if (!dir) return [];
    const paths: string[] = [];
    for await (const [name] of (dir as any).entries()) {
      if (typeof name === "string") {
        paths.push(fileNameToPath(name));
      }
    }
    return paths;
  } catch {
    return [];
  }
}

export async function removeAudioAssetFromCache(
  category: AudioAssetCategory,
  storagePath: string,
): Promise<void> {
  try {
    const dir = await getCacheDir(category);
    if (!dir) return;
    await dir.removeEntry(pathToFileName(storagePath));
  } catch { /* not found — fine */ }
}

// ── Fetch with cache ────────────────────────────────────────

/**
 * Fetch audio asset with OPFS cache-first strategy.
 * Falls back to Supabase Storage signed URL if not cached.
 */
export async function fetchAudioAssetWithCache(
  category: AudioAssetCategory,
  storagePath: string,
): Promise<ArrayBuffer> {
  // 1. Check OPFS cache
  const cached = await getAudioAssetFromCache(category, storagePath);
  if (cached) {
    console.log(`[audioAssetCache] HIT ${category}: ${storagePath}`);
    return cached;
  }

  // 2. Fetch from server
  console.log(`[audioAssetCache] MISS ${category}, fetching: ${storagePath}`);
  const { data: urlData } = await supabase.storage
    .from("user-media")
    .createSignedUrl(storagePath, 600);
  if (!urlData?.signedUrl) {
    throw new Error(`No signed URL for audio asset: ${storagePath}`);
  }

  const response = await fetch(urlData.signedUrl);
  if (!response.ok) {
    throw new Error(`Audio asset fetch failed: ${response.status}`);
  }

  const arrayBuf = await response.arrayBuffer();

  // 3. Store in OPFS cache (fire-and-forget)
  putAudioAssetToCache(category, storagePath, arrayBuf).catch(() => {});

  return arrayBuf;
}

// ── Batch download ──────────────────────────────────────────

/**
 * Download all user's atmosphere/sfx files from server to local OPFS cache.
 * Skips files already cached. Returns count of downloaded files.
 */
export async function downloadAudioAssetsBatch(
  userId: string,
  category: AudioAssetCategory,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const folder = category === "atmosphere" ? "atmosphere" : "sfx";
  const prefix = `${userId}/${folder}`;

  // List files in storage
  const { data: files } = await supabase.storage
    .from("user-media")
    .list(prefix, { limit: 500, sortBy: { column: "created_at", order: "desc" } });

  if (!files || files.length === 0) {
    onProgress?.(0, 0);
    return 0;
  }

  const validFiles = files.filter(f => f.name && !f.name.startsWith("."));
  let done = 0;

  for (const f of validFiles) {
    const storagePath = `${prefix}/${f.name}`;
    try {
      const already = await isAudioAssetCached(category, storagePath);
      if (!already) {
        await fetchAudioAssetWithCache(category, storagePath);
      }
      done++;
      onProgress?.(done, validFiles.length);
    } catch (e) {
      console.warn(`[audioAssetCache] Failed to download ${storagePath}:`, e);
      done++;
      onProgress?.(done, validFiles.length);
    }
  }

  return done;
}
