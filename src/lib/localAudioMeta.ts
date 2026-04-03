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
  status: string;         // "ready" | "pending" | "error" | "estimated"
  durationMs: number;
  audioPath: string;
  voiceConfig?: Record<string, unknown>;
  /** Absolute start position on scene timeline (seconds) — persisted, not computed */
  startSec?: number;
}

export interface LocalAudioMeta {
  sceneId: string;
  updatedAt: string;
  entries: Record<string, LocalAudioEntry>; // keyed by segmentId
  /** Scene-level silence gap before first clip (seconds) */
  silenceSec?: number;
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
  silenceSec?: number,
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
    silenceSec,
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
  await writeAudioMeta(storage, sceneId, entries, chapterId, existing?.silenceSec);
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

// ─── Position recalculation ─────────────────────────────────

const DEFAULT_SILENCE_SEC = 2;

/**
 * Recalculate startSec for all entries in a scene's audio_meta.json.
 * Uses segment ordering from storyboard.json to determine sequence.
 * Call after: storyboard save, silence_sec change, TTS synthesis,
 * merge/split, split_silence_ms change, inline edits.
 */
export async function recalcPositions(
  storage: ProjectStorage,
  sceneId: string,
  chapterId?: string,
  silenceSecOverride?: number,
): Promise<void> {
  // Read storyboard for segment ordering
  const { readStoryboardFromLocal } = await import("@/lib/storyboardSync");
  const storyboard = await readStoryboardFromLocal(storage, sceneId, chapterId);
  if (!storyboard || storyboard.segments.length === 0) return;

  let meta = await readAudioMeta(storage, sceneId, chapterId);

  // Auto-generate estimated audio_meta if it doesn't exist yet (legacy storyboards)
  if (!meta) {
    const CHARS_PER_SEC = 14;
    const entries: Record<string, LocalAudioEntry> = {};
    for (const seg of storyboard.segments) {
      const totalChars = (seg.phrases ?? []).reduce((sum: number, p: { text: string }) => sum + p.text.length, 0);
      const estimatedMs = Math.max(500, Math.round((totalChars / CHARS_PER_SEC) * 1000));
      entries[seg.segment_id] = {
        segmentId: seg.segment_id,
        status: "estimated",
        durationMs: estimatedMs,
        audioPath: "",
      };
    }
    const silSec = silenceSecOverride ?? DEFAULT_SILENCE_SEC;
    await writeAudioMeta(storage, sceneId, entries, chapterId, silSec);
    meta = await readAudioMeta(storage, sceneId, chapterId);
    if (!meta) return;
    console.info(`[recalcPositions] Auto-generated audio_meta for scene ${sceneId} (${Object.keys(entries).length} entries)`);
  }

  const silenceSec = silenceSecOverride ?? meta.silenceSec ?? DEFAULT_SILENCE_SEC;
  let offset = silenceSec;

  // Sort segments by segment_number (same order as storyboard)
  const orderedSegments = [...storyboard.segments].sort(
    (a, b) => a.segment_number - b.segment_number,
  );

  for (const seg of orderedSegments) {
    const entry = meta.entries[seg.segment_id];
    if (!entry) continue;

    // split_silence_ms gap before this segment
    const splitSilenceMs = typeof seg.split_silence_ms === "number" ? seg.split_silence_ms : 0;
    if (splitSilenceMs > 0) {
      offset += splitSilenceMs / 1000;
    }

    entry.startSec = offset;
    offset += entry.durationMs / 1000;
  }

  // Persist updated silenceSec along with recalculated positions
  await writeAudioMeta(storage, sceneId, meta.entries, chapterId, silenceSec);
}
