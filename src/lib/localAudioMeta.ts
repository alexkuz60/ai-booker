/**
 * localAudioMeta — OPFS persistence for segment audio metadata.
 *
 * Replaces runtime reads from `segment_audio` DB table.
 * DB remains backup-only (Push to Server / Restore).
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";
import { readSceneIndex } from "@/lib/sceneIndex";

// ─── Types ──────────────────────────────────────────────────

export interface LocalAudioEntry {
  segmentId: string;
  status: string;         // "ready" | "pending" | "error"
  durationMs: number;
  audioPath: string;
  voiceConfig?: Record<string, unknown>;
}

export interface LocalAudioMeta {
  sceneId: string;
  updatedAt: string;
  entries: Record<string, LocalAudioEntry>; // keyed by segmentId
}

// ─── Path resolution ────────────────────────────────────────

async function resolvedPath(
  storage: ProjectStorage,
  sceneId: string,
  chapterId?: string,
): Promise<string | null> {
  const p = paths.audioMeta(sceneId, chapterId);
  if (!p.includes("__unresolved__")) return p;
  // Attempt cache rebuild
  await readSceneIndex(storage);
  const p2 = paths.audioMeta(sceneId, chapterId);
  return p2.includes("__unresolved__") ? null : p2;
}

// ─── Read / Write ───────────────────────────────────────────

export async function readAudioMeta(
  storage: ProjectStorage,
  sceneId: string,
  chapterId?: string,
): Promise<LocalAudioMeta | null> {
  const p = await resolvedPath(storage, sceneId, chapterId);
  if (!p) return null;
  try {
    return await storage.readJSON<LocalAudioMeta>(p);
  } catch {
    return null;
  }
}

export async function writeAudioMeta(
  storage: ProjectStorage,
  sceneId: string,
  entries: Record<string, LocalAudioEntry>,
  chapterId?: string,
): Promise<void> {
  const p = await resolvedPath(storage, sceneId, chapterId);
  if (!p) {
    console.error(`[localAudioMeta] Cannot resolve path for scene ${sceneId}`);
    return;
  }
  const data: LocalAudioMeta = {
    sceneId,
    updatedAt: new Date().toISOString(),
    entries,
  };
  await storage.writeJSON(p, data);
}

/**
 * Update a single segment's audio entry (merge into existing).
 */
export async function upsertAudioEntry(
  storage: ProjectStorage,
  sceneId: string,
  entry: LocalAudioEntry,
  chapterId?: string,
): Promise<void> {
  const existing = await readAudioMeta(storage, sceneId, chapterId);
  const entries = existing?.entries ?? {};
  entries[entry.segmentId] = entry;
  await writeAudioMeta(storage, sceneId, entries, chapterId);
}

/**
 * Batch-read audio metadata for multiple scenes.
 * Returns a flat map: segmentId → entry (both "ready" and "estimated").
 */
export async function readAudioMetaForScenes(
  storage: ProjectStorage,
  sceneIds: string[],
): Promise<Map<string, LocalAudioEntry>> {
  const result = new Map<string, LocalAudioEntry>();
  const reads = sceneIds.map(async (sceneId) => {
    const meta = await readAudioMeta(storage, sceneId);
    if (!meta) return;
    for (const [segId, entry] of Object.entries(meta.entries)) {
      result.set(segId, entry);
    }
  });
  await Promise.all(reads);
  return result;
}
