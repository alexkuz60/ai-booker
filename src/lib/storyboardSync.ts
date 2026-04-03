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
import { readAudioMeta, writeAudioMeta, type LocalAudioEntry } from "@/lib/localAudioMeta";
import { readClipPlugins, writeClipPlugins, type LocalClipPluginsData } from "@/lib/localClipPlugins";
import { readMixerState, writeMixerState, type SceneMixerSnapshot } from "@/lib/localMixerState";
import { DEFAULT_CLIP_PLUGIN_CONFIG, type ClipPluginConfig } from "@/hooks/useClipPluginConfigs";

const CHARS_PER_SEC = 14;

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

    // Auto-set pipeline flag: storyboard_done when first storyboard is saved
    if (data.segments.length > 0) {
      const { writePipelineStep } = await import("@/hooks/usePipelineProgress");
      await writePipelineStep(storage, "storyboard_done", true);
    }

    // Generate/update audio_meta.json with estimated durations for segments
    // that don't have real TTS audio yet. Preserves existing "ready" entries.
    await generateEstimatedAudioMeta(storage, sceneId, data.segments, chapterId);
  } catch (err) {
    console.warn("[StoryboardSync] Failed to save:", err);
  }
}

/**
 * Generate audio_meta.json with estimated durations from phrase char counts.
 * Preserves entries that already have status "ready" (real TTS audio).
 */
async function generateEstimatedAudioMeta(
  storage: ProjectStorage,
  sceneId: string,
  segments: Segment[],
  chapterId?: string,
): Promise<void> {
  try {
    const existing = await readAudioMeta(storage, sceneId, chapterId);
    const entries: Record<string, LocalAudioEntry> = existing?.entries ?? {};

    for (const seg of segments) {
      // Don't overwrite real TTS data
      if (entries[seg.segment_id]?.status === "ready") continue;

      const totalChars = (seg.phrases ?? []).reduce((sum, p) => sum + p.text.length, 0);
      const estimatedMs = Math.max(500, Math.round((totalChars / CHARS_PER_SEC) * 1000));

      entries[seg.segment_id] = {
        segmentId: seg.segment_id,
        status: "estimated",
        durationMs: estimatedMs,
        audioPath: "",
      };
    }

    // Remove entries for segments that no longer exist
    const segIds = new Set(segments.map(s => s.segment_id));
    for (const key of Object.keys(entries)) {
      if (!segIds.has(key)) delete entries[key];
    }

    await writeAudioMeta(storage, sceneId, entries, chapterId);
  } catch (err) {
    console.warn("[StoryboardSync] Failed to generate audio_meta:", err);
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
    if (!result) return null;

    // INTEGRITY CHECK: reject data if stored sceneId doesn't match requested sceneId.
    // This catches "viral contamination" where one scene's data was written to another's path.
    if (result.sceneId && result.sceneId !== sceneId) {
      console.error(
        `[StoryboardSync] ❌ INTEGRITY VIOLATION: file at ${filePath} contains sceneId=${result.sceneId} but was requested for sceneId=${sceneId}. ` +
        `Rejecting corrupted data. Delete and re-analyze this scene.`
      );
      return null;
    }

    const firstPhrase = result.segments?.[0]?.phrases?.[0]?.text?.slice(0, 60) || "(empty)";
    console.info(`[StoryboardSync] 📖 READ sceneId=${sceneId} path=${filePath} segs=${result.segments?.length ?? 0} first="${firstPhrase}"`);
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
