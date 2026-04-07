/**
 * localAtmospheres — OPFS persistence for scene atmosphere/sfx clips.
 *
 * Path: chapters/{chapterId}/scenes/{sceneId}/atmospheres.json
 * This is the ONLY source of truth for atmosphere clip metadata at runtime.
 * DB (scene_atmospheres) is used only for backup (Push) and restore (Wipe-and-Deploy).
 *
 * Structure: { sceneId, updatedAt, atmo: [...], sfx: [...] }
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
  atmo: LocalAtmosphereClip[];
  sfx: LocalAtmosphereClip[];
}

// ── Path helper ─────────────────────────────────────────────

function atmoPath(sceneId: string, chapterId?: string): string {
  return paths.storyboard(sceneId, chapterId).replace("storyboard.json", "atmospheres.json");
}

// ── Helpers ─────────────────────────────────────────────────

/** Get all clips as a flat array (convenience for consumers that don't care about sections) */
export function allClips(data: LocalAtmosphereData): LocalAtmosphereClip[] {
  return [...data.atmo, ...data.sfx];
}

/** Determine which section a clip belongs to based on layer_type */
function sectionKey(clip: Pick<LocalAtmosphereClip, "layer_type">): "atmo" | "sfx" {
  return clip.layer_type === "sfx" ? "sfx" : "atmo";
}

// ── Read ────────────────────────────────────────────────────

export async function readAtmospheresFromLocal(
  storage: ProjectStorage,
  sceneId: string,
  chapterId?: string,
): Promise<LocalAtmosphereData | null> {
  try {
    let p = atmoPath(sceneId, chapterId);
    if (p.includes("__unresolved__")) {
      await readSceneIndex(storage);
      p = atmoPath(sceneId, chapterId);
      if (p.includes("__unresolved__")) return null;
    }
    const raw = await storage.readJSON<Record<string, unknown>>(p);
    if (!raw) return null;

    // Migration: old format had flat `clips[]` — convert to {atmo, sfx}
    if (Array.isArray((raw as any).clips)) {
      const clips = (raw as any).clips as LocalAtmosphereClip[];
      return {
        sceneId: (raw as any).sceneId ?? sceneId,
        updatedAt: (raw as any).updatedAt ?? new Date().toISOString(),
        atmo: clips.filter(c => sectionKey(c) === "atmo"),
        sfx: clips.filter(c => sectionKey(c) === "sfx"),
      };
    }

    return raw as unknown as LocalAtmosphereData;
  } catch {
    return null;
  }
}

// ── Write ───────────────────────────────────────────────────

export async function saveAtmospheresToLocal(
  storage: ProjectStorage,
  sceneId: string,
  atmo: LocalAtmosphereClip[],
  sfx: LocalAtmosphereClip[],
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
    atmo,
    sfx,
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
  const atmo = existing?.atmo ?? [];
  const sfx = existing?.sfx ?? [];
  const key = sectionKey(clip);
  if (key === "sfx") sfx.push(clip);
  else atmo.push(clip);
  await saveAtmospheresToLocal(storage, sceneId, atmo, sfx, chapterId);
}

export async function deleteAtmosphereClip(
  storage: ProjectStorage,
  sceneId: string,
  clipId: string,
  chapterId?: string,
): Promise<void> {
  const existing = await readAtmospheresFromLocal(storage, sceneId, chapterId);
  if (!existing) return;
  await saveAtmospheresToLocal(
    storage, sceneId,
    existing.atmo.filter(c => c.id !== clipId),
    existing.sfx.filter(c => c.id !== clipId),
    chapterId,
  );
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
  const updater = (c: LocalAtmosphereClip) =>
    c.id === clipId ? { ...c, ...updates } : c;
  await saveAtmospheresToLocal(
    storage, sceneId,
    existing.atmo.map(updater),
    existing.sfx.map(updater),
    chapterId,
  );
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
      if (!data) return [];
      return allClips(data).map(c => ({ ...c, scene_id: sid }));
    }),
  );
  return results.flat();
}
