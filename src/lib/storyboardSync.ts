/**
 * Local-first persistence for storyboard data (segments, phrases, type mappings).
 * V1: storyboard/scene_{id}.json
 * V2: chapters/{chapterId}/scenes/{sceneId}/storyboard.json
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import type { Segment, Phrase, CharacterOption } from "@/components/studio/storyboard/types";
import type { PhraseAnnotation, TtsProvider } from "@/components/studio/phraseAnnotations";
import { touchProjectUpdatedAt } from "@/lib/projectActivity";
import { paths, getActiveLayout } from "@/lib/projectPaths";
import { markStoryboarded, unmarkStoryboarded, getCachedSceneIndex, readSceneIndex } from "@/lib/sceneIndex";

// ─── Types ──────────────────────────────────────────────────

export interface LocalTypeMappingEntry {
  segmentType: string;
  characterId: string;
  characterName: string;
}

export interface LocalAudioStatus {
  status: string;        // "ready" | "pending" | "error"
  durationMs: number;
}

export interface LocalStoryboardData {
  sceneId: string;
  updatedAt: string;
  /** Ordered segments with phrases */
  segments: Segment[];
  /** segment_type → character mapping */
  typeMappings: LocalTypeMappingEntry[];
  /** segment_id → audio status */
  audioStatus: Record<string, LocalAudioStatus>;
  /** speaker for inline narration segments */
  inlineNarrationSpeaker: string | null;
  /** Content hash at time of analysis (for dirty detection) */
  contentHash?: number;
}

async function resolveStoryboardPath(
  storage: ProjectStorage,
  sceneId: string,
  chapterId?: string,
): Promise<string | null> {
  let filePath = paths.storyboard(sceneId, chapterId);
  if (!filePath.includes("__unresolved__")) return filePath;

  if (getActiveLayout() === "v2") {
    await readSceneIndex(storage);
    filePath = paths.storyboard(sceneId, chapterId);
    if (!filePath.includes("__unresolved__")) return filePath;
  }

  return null;
}

// ─── Write ──────────────────────────────────────────────────

export async function saveStoryboardToLocal(
  storage: ProjectStorage,
  sceneId: string,
  data: {
    segments: Segment[];
    typeMappings: LocalTypeMappingEntry[];
    audioStatus: Map<string, { status: string; durationMs: number }>;
    inlineNarrationSpeaker: string | null;
    contentHash?: number;
  },
  chapterId?: string,
): Promise<void> {
  try {
    const payload: LocalStoryboardData = {
      sceneId,
      updatedAt: new Date().toISOString(),
      segments: data.segments,
      typeMappings: data.typeMappings,
      audioStatus: Object.fromEntries(data.audioStatus),
      inlineNarrationSpeaker: data.inlineNarrationSpeaker,
      contentHash: data.contentHash,
    };
    const filePath = await resolveStoryboardPath(storage, sceneId, chapterId);
    if (!filePath) {
      console.error(`[StoryboardSync] REFUSING to save to unresolved path for scene ${sceneId}. ChapterId missing.`);
      return;
    }
    await storage.writeJSON(filePath, payload);
    await markStoryboarded(storage, sceneId);
    await touchProjectUpdatedAt(storage);
    console.debug(`[StoryboardSync] Saved scene ${sceneId} → ${filePath}: ${data.segments.length} segments`);
  } catch (err) {
    console.warn("[StoryboardSync] Failed to save:", err);
  }
}

// ─── Read ───────────────────────────────────────────────────

export async function readStoryboardFromLocal(
  storage: ProjectStorage,
  sceneId: string,
  chapterId?: string,
): Promise<LocalStoryboardData | null> {
  try {
    const filePath = await resolveStoryboardPath(storage, sceneId, chapterId);
    if (!filePath) {
      console.warn(`[StoryboardSync] Cannot read storyboard: chapterId unresolved for scene ${sceneId}`);
      return null;
    }
    return await storage.readJSON<LocalStoryboardData>(filePath);
  } catch {
    return null;
  }
}

// ─── Delete (e.g. when scene is re-analyzed) ────────────────

export async function deleteStoryboardFromLocal(
  storage: ProjectStorage,
  sceneId: string,
  chapterId?: string,
): Promise<void> {
  try {
    const filePath = await resolveStoryboardPath(storage, sceneId, chapterId);
    if (!filePath) return;
    await storage.delete(filePath);
    await unmarkStoryboarded(storage, sceneId);
    await touchProjectUpdatedAt(storage);
  } catch {
    // non-critical
  }
}

// ─── List all storyboarded scene IDs ────────────────────────

export async function listStoryboardedScenes(
  storage: ProjectStorage,
): Promise<string[]> {
  if (getActiveLayout() === "v2") {
    const index = getCachedSceneIndex() ?? await readSceneIndex(storage);
    return index ? [...index.storyboarded] : [];
  }

  try {
    const dir = paths.storyboardDir();
    const files = await storage.listDir(dir);
    return files
      .filter((f) => {
        const sid = paths.sceneIdFromStoryboardFile(f);
        return sid !== null;
      })
      .map((f) => paths.sceneIdFromStoryboardFile(f)!);
  } catch {
    return [];
  }
}
