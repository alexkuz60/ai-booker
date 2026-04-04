/**
 * irCache — Global OPFS-based cache for impulse response audio files.
 *
 * Architecture:
 * - Global cache: OPFS root `ir-cache/{impulseId}.bin` — shared across all books
 * - Per-book manifest: `project.json.usedImpulseIds: string[]` — tracks which IRs a book uses
 *
 * When a user applies an IR in ConvolverPanel:
 * 1. Check global OPFS cache → return if hit
 * 2. Fetch from Supabase Storage signed URL
 * 3. Write to global OPFS cache
 * 4. Add impulseId to current book's manifest
 */

import { supabase } from "@/integrations/supabase/client";
import type { ProjectStorage } from "@/lib/projectStorage";

const IR_CACHE_DIR = "ir-cache";

// ── OPFS global cache ────────────────────────────────────────

async function getIrCacheDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(IR_CACHE_DIR, { create: true });
  } catch {
    return null;
  }
}

/**
 * Get cached IR audio from global OPFS cache.
 * Returns ArrayBuffer or null if not cached.
 */
export async function getIrFromCache(impulseId: string): Promise<ArrayBuffer | null> {
  try {
    const dir = await getIrCacheDir();
    if (!dir) return null;
    const fh = await dir.getFileHandle(`${impulseId}.bin`);
    const file = await fh.getFile();
    return await file.arrayBuffer();
  } catch {
    return null; // Not cached
  }
}

/**
 * Store IR audio in global OPFS cache.
 */
export async function putIrToCache(impulseId: string, data: ArrayBuffer): Promise<void> {
  try {
    const dir = await getIrCacheDir();
    if (!dir) return;
    const fh = await dir.getFileHandle(`${impulseId}.bin`, { create: true });
    const writable = await fh.createWritable();
    await writable.write(data);
    await writable.close();
  } catch (e) {
    console.warn("[irCache] Failed to write:", impulseId, e);
  }
}

/**
 * Check if an IR is cached without reading the full file.
 */
export async function isIrCached(impulseId: string): Promise<boolean> {
  try {
    const dir = await getIrCacheDir();
    if (!dir) return false;
    await dir.getFileHandle(`${impulseId}.bin`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove specific IR from cache.
 */
export async function removeIrFromCache(impulseId: string): Promise<void> {
  try {
    const dir = await getIrCacheDir();
    if (!dir) return;
    await dir.removeEntry(`${impulseId}.bin`);
  } catch { /* not found — fine */ }
}

/**
 * List all cached impulse IDs.
 */
export async function listCachedIrIds(): Promise<string[]> {
  try {
    const dir = await getIrCacheDir();
    if (!dir) return [];
    const ids: string[] = [];
    for await (const [name] of (dir as any).entries()) {
      if (typeof name === "string" && name.endsWith(".bin")) {
        ids.push(name.replace(/\.bin$/, ""));
      }
    }
    return ids;
  } catch {
    return [];
  }
}

// ── Fetch with cache ─────────────────────────────────────────

/**
 * Fetch IR audio with OPFS cache-first strategy.
 * Falls back to Supabase Storage signed URL if not cached.
 */
export async function fetchIrWithCache(
  impulseId: string,
  filePath: string,
): Promise<ArrayBuffer> {
  // 1. Check OPFS cache
  const cached = await getIrFromCache(impulseId);
  if (cached) {
    console.log(`[irCache] HIT: ${impulseId}`);
    return cached;
  }

  // 2. Fetch from server
  console.log(`[irCache] MISS, fetching: ${impulseId}`);
  const { data: urlData } = await supabase.storage
    .from("impulse-responses")
    .createSignedUrl(filePath, 600);
  if (!urlData?.signedUrl) {
    throw new Error(`No signed URL for IR: ${filePath}`);
  }

  const response = await fetch(urlData.signedUrl);
  if (!response.ok) {
    throw new Error(`IR fetch failed: ${response.status}`);
  }

  const arrayBuf = await response.arrayBuffer();

  // 3. Store in OPFS cache (fire-and-forget)
  putIrToCache(impulseId, arrayBuf).catch(() => {});

  return arrayBuf;
}

// ── Per-book manifest ────────────────────────────────────────

/**
 * Read the list of impulse IDs used by this book project.
 */
export async function readBookImpulseManifest(
  storage: ProjectStorage,
): Promise<string[]> {
  try {
    const meta = await storage.readJSON<{ usedImpulseIds?: string[] }>("project.json");
    return meta?.usedImpulseIds ?? [];
  } catch {
    return [];
  }
}

/**
 * Add an impulse ID to the book's manifest (deduped).
 */
export async function addToBookImpulseManifest(
  storage: ProjectStorage,
  impulseId: string,
): Promise<void> {
  try {
    const meta = await storage.readJSON<Record<string, unknown>>("project.json");
    if (!meta) return;
    const existing: string[] = (meta.usedImpulseIds as string[]) ?? [];
    if (existing.includes(impulseId)) return;
    const { sanitizeProjectMeta } = await import("@/lib/projectStorage");
    await storage.writeJSON("project.json", sanitizeProjectMeta(meta as Record<string, unknown>));
  } catch (e) {
    console.warn("[irCache] Failed to update manifest:", e);
  }
}

/**
 * Batch-download IRs by their IDs into the global OPFS cache.
 * Returns count of successfully downloaded files.
 */
export async function downloadIrBatch(
  impulseIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  if (impulseIds.length === 0) return 0;

  // Fetch file_paths for all needed impulse IDs
  const { data: impulses } = await supabase
    .from("convolution_impulses")
    .select("id, file_path")
    .in("id", impulseIds);

  if (!impulses || impulses.length === 0) return 0;

  let done = 0;
  for (const imp of impulses) {
    try {
      const already = await isIrCached(imp.id);
      if (!already) {
        await fetchIrWithCache(imp.id, imp.file_path);
      }
      done++;
      onProgress?.(done, impulses.length);
    } catch (e) {
      console.warn(`[irCache] Failed to download IR ${imp.id}:`, e);
      done++;
      onProgress?.(done, impulses.length);
    }
  }

  return done;
}
