/**
 * Local-first persistence for storyboard data (segments, phrases, type mappings).
 * Each scene's storyboard lives in `storyboard/scene_{id}.json` inside ProjectStorage.
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import type { Segment, Phrase, CharacterOption } from "@/components/studio/storyboard/types";
import type { PhraseAnnotation, TtsProvider } from "@/components/studio/phraseAnnotations";
import { touchProjectUpdatedAt } from "@/lib/projectActivity";
import { paths } from "@/lib/projectPaths";

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
  },
): Promise<void> {
  try {
    const payload: LocalStoryboardData = {
      sceneId,
      updatedAt: new Date().toISOString(),
      segments: data.segments,
      typeMappings: data.typeMappings,
      audioStatus: Object.fromEntries(data.audioStatus),
      inlineNarrationSpeaker: data.inlineNarrationSpeaker,
    };
    await storage.writeJSON(paths.storyboard(sceneId), payload);
    await touchProjectUpdatedAt(storage);
    console.debug(`[StoryboardSync] Saved scene ${sceneId}: ${data.segments.length} segments`);
  } catch (err) {
    console.warn("[StoryboardSync] Failed to save:", err);
  }
}

// ─── Read ───────────────────────────────────────────────────

export async function readStoryboardFromLocal(
  storage: ProjectStorage,
  sceneId: string,
): Promise<LocalStoryboardData | null> {
  try {
    return await storage.readJSON<LocalStoryboardData>(paths.storyboard(sceneId));
  } catch {
    return null;
  }
}

// ─── Delete (e.g. when scene is re-analyzed) ────────────────

export async function deleteStoryboardFromLocal(
  storage: ProjectStorage,
  sceneId: string,
): Promise<void> {
  try {
    await storage.delete(paths.storyboard(sceneId));
    await touchProjectUpdatedAt(storage);
  } catch {
    // non-critical
  }
}

// ─── List all storyboarded scene IDs ────────────────────────

export async function listStoryboardedScenes(
  storage: ProjectStorage,
): Promise<string[]> {
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
