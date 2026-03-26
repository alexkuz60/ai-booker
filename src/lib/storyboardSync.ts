/**
 * Local-first persistence for storyboard data (segments, phrases, type mappings).
 * V2: chapters/{chapterId}/scenes/{sceneId}/storyboard.json
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import type { Segment, Phrase, CharacterOption } from "@/components/studio/storyboard/types";
import type { PhraseAnnotation, TtsProvider } from "@/components/studio/phraseAnnotations";
import { touchProjectUpdatedAt } from "@/lib/projectActivity";
import { paths } from "@/lib/projectPaths";
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

  // Try re-reading scene index to resolve
  await readSceneIndex(storage);
  filePath = paths.storyboard(sceneId, chapterId);
  if (!filePath.includes("__unresolved__")) return filePath;

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
    const firstPhrase = data.segments[0]?.phrases?.[0]?.text?.slice(0, 60) || "(empty)";
    console.info(`[StoryboardSync] 💾 WRITE sceneId=${sceneId} path=${filePath} segs=${data.segments.length} first="${firstPhrase}"`);
    await storage.writeJSON(filePath, payload);
    await markStoryboarded(storage, sceneId);
    await touchProjectUpdatedAt(storage);
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
    const result = await storage.readJSON<LocalStoryboardData>(filePath);
    const firstPhrase = result?.segments?.[0]?.phrases?.[0]?.text?.slice(0, 60) || "(empty)";
    console.info(`[StoryboardSync] 📖 READ sceneId=${sceneId} path=${filePath} segs=${result?.segments?.length ?? 0} first="${firstPhrase}"`);
    return result;
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
  const index = getCachedSceneIndex() ?? await readSceneIndex(storage);
  return index ? [...index.storyboarded] : [];
}
