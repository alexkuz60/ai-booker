/**
 * localMixerState — OPFS persistence for per-scene mixer + channel plugin state.
 *
 * Combines what was previously two separate localStorage keys:
 *   - mixer-state-{sceneId}  (volume, pan, preFxBypassed, reverbBypassed)
 *   - plugins-state-{sceneId} (EQ, comp, limiter)
 *
 * Written to: chapters/{chapterId}/scenes/{sceneId}/mixer_state.json
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";

// ── Types ───────────────────────────────────────────────────

export interface PersistedTrackMix {
  volume: number;
  pan: number;
  preFxBypassed: boolean;
  reverbBypassed: boolean;
}

export interface PersistedTrackPlugins {
  eq: { low: number; mid: number; high: number; bypassed: boolean };
  comp: { threshold: number; ratio: number; knee: number; attack: number; release: number; bypassed: boolean };
  limiter: { threshold: number; bypassed: boolean };
}

export interface PersistedTrackState {
  mix: PersistedTrackMix;
  plugins?: PersistedTrackPlugins;
}

/** Full mixer snapshot for a scene — keyed by engine track ID */
export type SceneMixerSnapshot = Record<string, PersistedTrackState>;

// ── OPFS I/O ────────────────────────────────────────────────

export async function readMixerState(
  storage: ProjectStorage,
  sceneId: string,
): Promise<SceneMixerSnapshot | null> {
  try {
    const path = paths.mixerState(sceneId);
    if (path.includes("__unresolved__")) return null;
    return await storage.readJSON<SceneMixerSnapshot>(path);
  } catch {
    return null;
  }
}

export async function writeMixerState(
  storage: ProjectStorage,
  sceneId: string,
  state: SceneMixerSnapshot,
  chapterId?: string,
): Promise<void> {
  try {
    const path = paths.mixerState(sceneId, chapterId);
    if (path.includes("__unresolved__")) return;
    await storage.writeJSON(path, state);
  } catch (err) {
    console.warn("[localMixerState] Failed to write:", err);
  }
}

// ── Batch read for restore/deploy ───────────────────────────

export async function readMixerStateForScenes(
  storage: ProjectStorage,
  sceneIds: string[],
): Promise<Map<string, SceneMixerSnapshot>> {
  const result = new Map<string, SceneMixerSnapshot>();
  const reads = sceneIds.map(async (sid) => {
    const data = await readMixerState(storage, sid);
    if (data && Object.keys(data).length > 0) {
      result.set(sid, data);
    }
  });
  await Promise.all(reads);
  return result;
}
