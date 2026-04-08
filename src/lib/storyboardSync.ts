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
import { readAudioMeta, writeAudioMeta, recalcPositions, type LocalAudioEntry } from "@/lib/localAudioMeta";
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

    // Update existing scene JSON files with segment data.
    // Files MUST already exist from project init (bookTemplateOPFS).
    // Preserves existing user-modified entries.
    await Promise.all([
      updateEstimatedAudioMeta(storage, sceneId, data.segments, chapterId),
      updateClipPlugins(storage, sceneId, data.segments, chapterId),
      updateMixerState(storage, sceneId, chapterId, data.segments, data.typeMappings),
    ]);

    // Recalc positions after audio_meta entries are generated/updated
    await recalcPositions(storage, sceneId, chapterId);
  } catch (err) {
    console.warn("[StoryboardSync] Failed to save:", err);
  }
}

/**
 * Update audio_meta.json with estimated durations from phrase char counts.
 * The file MUST already exist (created at project init from bookTemplateOPFS).
 * Preserves entries that already have status "ready" (real TTS audio).
 */
async function updateEstimatedAudioMeta(
  storage: ProjectStorage,
  sceneId: string,
  segments: Segment[],
  chapterId?: string,
): Promise<void> {
  try {
    const existing = await readAudioMeta(storage, sceneId, chapterId);
    if (!existing) {
      console.warn(`[StoryboardSync] audio_meta.json not found for scene ${sceneId} — skipping update (file should exist from init)`);
      return;
    }
    const entries: Record<string, LocalAudioEntry> = existing.entries ?? {};

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
    console.warn("[StoryboardSync] Failed to update audio_meta:", err);
  }
}

/**
 * Update clip_plugins.json with default-off plugin configs for new segments.
 * The file MUST already exist (created at project init from bookTemplateOPFS).
 * Preserves entries that were already configured by the user.
 */
async function updateClipPlugins(
  storage: ProjectStorage,
  sceneId: string,
  segments: Segment[],
  chapterId?: string,
): Promise<void> {
  try {
    const existing = await readClipPlugins(storage, sceneId, chapterId);
    if (!existing) {
      console.warn(`[StoryboardSync] clip_plugins.json not found for scene ${sceneId} — skipping update (file should exist from init)`);
      return;
    }
    const configs = existing.configs ?? {};

    for (const seg of segments) {
      // Don't overwrite user-configured entries
      if (configs[seg.segment_id]) continue;
      configs[seg.segment_id] = {
        trackId: "",
        config: { ...DEFAULT_CLIP_PLUGIN_CONFIG },
      };
    }

    // Remove entries for segments that no longer exist
    const segIds = new Set(segments.map(s => s.segment_id));
    for (const key of Object.keys(configs)) {
      if (!segIds.has(key)) delete configs[key];
    }

    await writeClipPlugins(storage, sceneId, configs, chapterId);
  } catch (err) {
    console.warn("[StoryboardSync] Failed to update clip_plugins:", err);
  }
}

/**
 * Update mixer_state.json with default track entries if they're missing.
 * The file MUST already exist (created at project init from bookTemplateOPFS).
 * Does NOT overwrite existing mixer state (user may have customized it).
 */
async function updateMixerState(
  storage: ProjectStorage,
  sceneId: string,
  chapterId?: string,
  segments?: Segment[],
  typeMappings?: LocalTypeMappingEntry[],
): Promise<void> {
  try {
    const existing = await readMixerState(storage, sceneId);
    if (!existing) {
      console.warn(`[StoryboardSync] mixer_state.json not found for scene ${sceneId} — skipping update (file should exist from init)`);
      return;
    }
    if (Object.keys(existing).length > 0) return; // already configured by user

    const defaultMix = { volume: 80, pan: 0, preFxBypassed: false, reverbBypassed: true };
    const defaultSnapshot: SceneMixerSnapshot = { ...existing };

    // Voice tracks from type mappings (char-{characterId})
    if (typeMappings) {
      const charIds = new Set(typeMappings.map(m => m.characterId));
      for (const cid of charIds) {
        if (!defaultSnapshot[`char-${cid}`]) {
          defaultSnapshot[`char-${cid}`] = { mix: { ...defaultMix } };
        }
      }
    }

    // Fixed atmosphere + sfx tracks
    if (!defaultSnapshot[`atmo-${sceneId}`]) {
      defaultSnapshot[`atmo-${sceneId}`] = { mix: { ...defaultMix } };
    }
    if (!defaultSnapshot[`sfx-${sceneId}`]) {
      defaultSnapshot[`sfx-${sceneId}`] = { mix: { ...defaultMix } };
    }

    await writeMixerState(storage, sceneId, defaultSnapshot, chapterId);
  } catch (err) {
    console.warn("[StoryboardSync] Failed to update mixer_state:", err);
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
    const { guardedDelete } = await import("@/lib/storageGuard");
    await guardedDelete(storage, filePath, "deleteStoryboardFromLocal");
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
