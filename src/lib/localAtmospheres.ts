/**
 * localAtmospheres — OPFS persistence for scene atmosphere/sfx clips.
 *
 * Path: chapters/{chapterId}/scenes/{sceneId}/atmospheres.json
 * This is the ONLY source of truth for atmosphere clip metadata at runtime.
 * DB (scene_atmospheres) is used only for backup (Push) and restore (Wipe-and-Deploy).
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";
import { readSceneIndex } from "@/lib/sceneIndex";

// ── Types ───────────────────────────────────────────────────

export interface LocalAtmosphereClip {
  id: string;
  layer_type: string; // "ambience" | "sfx" | "music"
  audio_path: string;
  duration_ms: number;
  volume: number;
  fade_in_ms: number;
  fade_out_ms: number;
  offset_ms: number;
  prompt_used: string;
  speed: number;
  created_at: string;
}

export interface LocalAtmosphereData {
  sceneId: string;
  updatedAt: string;
  clips: LocalAtmosphereClip[];
}

// ── Path helper ─────────────────────────────────────────────

function atmoPath(sceneId: string, chapterId?: string): string {
  return paths.storyboard(sceneId, chapterId).replace("storyboard.json", "atmospheres.json");
}

// ── Read ────────────────────────────────────────────────────

export async function readAtmospheresFromLocal(
  storage: ProjectStorage,
  sceneId: string,
  chapterId?: string,
): Promise<LocalAtmosphereData | null> {
  try {
    let p = atmoPath(sceneId, chapterId);
    // If scene index cache is empty, re-read it (same fallback as storyboardSync)
    if (p.includes("__unresolved__")) {
      await readSceneIndex(storage);
      p = atmoPath(sceneId, chapterId);
      if (p.includes("__unresolved__")) return null;
    }
    const data = await storage.readJSON<LocalAtmosphereData>(p);
    return data ?? null;
  } catch {
    return null;
  }
}

// ── Write ───────────────────────────────────────────────────

export async function saveAtmospheresToLocal(
  storage: ProjectStorage,
  sceneId: string,
  clips: LocalAtmosphereClip[],
  chapterId?: string,
): Promise<void> {
  let p = atmoPath(sceneId, chapterId);
  if (p.includes("__unresolved__")) {
    await readSceneIndex(storage);
    p = atmoPath(sceneId, chapterId);
    if (p.includes("__unresolved__")) {
      console.error("[localAtmospheres] Cannot save — unresolved chapterId for scene", sceneId);
      return;
    }
  }
  const data: LocalAtmosphereData = {
    sceneId,
    updatedAt: new Date().toISOString(),
    clips,
  };
  await storage.writeJSON(p, data);
}

// ── Mutations ───────────────────────────────────────────────

export async function addAtmosphereClip(
  storage: ProjectStorage,
  sceneId: string,
  clip: LocalAtmosphereClip,
  chapterId?: string,
): Promise<void> {
  const existing = await readAtmospheresFromLocal(storage, sceneId, chapterId);
  const clips = existing?.clips ?? [];
  clips.push(clip);
  await saveAtmospheresToLocal(storage, sceneId, clips, chapterId);
}

export async function deleteAtmosphereClip(
  storage: ProjectStorage,
  sceneId: string,
  clipId: string,
  chapterId?: string,
): Promise<void> {
  const existing = await readAtmospheresFromLocal(storage, sceneId, chapterId);
  if (!existing) return;
  const clips = existing.clips.filter(c => c.id !== clipId);
  await saveAtmospheresToLocal(storage, sceneId, clips, chapterId);
}

export async function updateAtmosphereClip(
  storage: ProjectStorage,
  sceneId: string,
  clipId: string,
  updates: Partial<LocalAtmosphereClip>,
  chapterId?: string,
): Promise<void> {
  const existing = await readAtmospheresFromLocal(storage, sceneId, chapterId);
  if (!existing) return;
  const clips = existing.clips.map(c =>
    c.id === clipId ? { ...c, ...updates } : c,
  );
  await saveAtmospheresToLocal(storage, sceneId, clips, chapterId);
}

// ── Batch read for multiple scenes ──────────────────────────

/** Clip with scene association for timeline use */
export interface TaggedAtmosphereClip extends LocalAtmosphereClip {
  scene_id: string;
}

export async function readAtmospheresForScenes(
  storage: ProjectStorage,
  sceneIds: string[],
): Promise<TaggedAtmosphereClip[]> {
  const results = await Promise.all(
    sceneIds.map(async sid => {
      const data = await readAtmospheresFromLocal(storage, sid);
      return (data?.clips ?? []).map(c => ({ ...c, scene_id: sid }));
    }),
  );
  return results.flat();
}
