/**
 * migrateMirrorTranslation — one-time migration utility.
 *
 * Copies translation data from a legacy mirror OPFS project (e.g. "Собачье сердце_EN")
 * into lang-subfolders of the main project (e.g. chapters/{ch}/scenes/{sc}/en/).
 *
 * Files migrated per scene:
 *   storyboard.json → en/storyboard.json
 *   radar-literal.json → en/radar-literal.json
 *   radar-literary.json → en/radar-literary.json
 *   radar-critique.json → en/radar-critique.json
 *   audio_meta.json → en/audio_meta.json
 *   mixer_state.json → en/mixer_state.json
 *   clip_plugins.json → en/clip_plugins.json
 *   audio/tts/*.mp3 → en/audio/tts/*.mp3
 */

import { OPFSStorage, type ProjectMeta } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";
import type { SceneIndexData } from "@/lib/sceneIndex";

export interface MigrationProgress {
  phase: string;
  current: number;
  total: number;
}

export interface MigrationResult {
  scenesProcessed: number;
  filesCopied: number;
  errors: string[];
}

const SCENE_JSON_FILES = [
  "storyboard.json",
  "radar-literal.json",
  "radar-literary.json",
  "radar-critique.json",
  "audio_meta.json",
  "mixer_state.json",
  "clip_plugins.json",
];

export async function migrateMirrorToSubfolders(
  mirrorProjectName: string,
  mainProjectName: string,
  onProgress?: (p: MigrationProgress) => void,
): Promise<MigrationResult> {
  const result: MigrationResult = { scenesProcessed: 0, filesCopied: 0, errors: [] };

  // 1. Open both projects
  const mirrorStore = await OPFSStorage.openExisting(mirrorProjectName);
  if (!mirrorStore) {
    result.errors.push(`Mirror project "${mirrorProjectName}" not found`);
    return result;
  }

  const mainStore = await OPFSStorage.openExisting(mainProjectName);
  if (!mainStore) {
    result.errors.push(`Main project "${mainProjectName}" not found`);
    return result;
  }

  // 2. Determine target language from mirror meta
  const mirrorMeta = await mirrorStore.readJSON<ProjectMeta>("project.json");
  const targetLang = mirrorMeta?.targetLanguage ?? "en";

  // 3. Read scene index from mirror to get chapter→scene mappings
  const mirrorSceneIndex = await mirrorStore.readJSON<SceneIndexData>(paths.sceneIndex());
  if (!mirrorSceneIndex?.entries) {
    result.errors.push("Mirror scene_index.json is empty or missing");
    return result;
  }

  const sceneEntries = Object.entries(mirrorSceneIndex.entries);
  onProgress?.({ phase: "Scanning scenes", current: 0, total: sceneEntries.length });

  // 4. Process each scene
  for (let i = 0; i < sceneEntries.length; i++) {
    const [sceneId, entry] = sceneEntries[i];
    const chapterId = entry.chapterId;
    if (!chapterId) {
      result.errors.push(`Scene ${sceneId}: no chapterId in index`);
      continue;
    }

    onProgress?.({ phase: `Scene ${i + 1}/${sceneEntries.length}`, current: i, total: sceneEntries.length });

    const mirrorSceneBase = `chapters/${chapterId}/scenes/${sceneId}`;
    const mainTargetBase = `chapters/${chapterId}/scenes/${sceneId}/${targetLang}`;

    // Copy JSON files
    for (const fileName of SCENE_JSON_FILES) {
      try {
        const data = await mirrorStore.readJSON(`${mirrorSceneBase}/${fileName}`);
        if (data) {
          await mainStore.writeJSON(`${mainTargetBase}/${fileName}`, data);
          result.filesCopied++;
        }
      } catch (err) {
        // File doesn't exist — skip silently
      }
    }

    // Copy TTS audio files
    try {
      const ttsDir = `${mirrorSceneBase}/audio/tts`;
      const ttsFiles = await mirrorStore.listDir(ttsDir).catch(() => [] as string[]);
      for (const ttsFile of ttsFiles) {
        try {
          const blob = await mirrorStore.readBlob(`${ttsDir}/${ttsFile}`);
          if (blob) {
            await mainStore.writeBlob(`${mainTargetBase}/audio/tts/${ttsFile}`, blob);
            result.filesCopied++;
          }
        } catch {
          result.errors.push(`Scene ${sceneId}: failed to copy TTS ${ttsFile}`);
        }
      }
    } catch {
      // No TTS directory — ok
    }

    result.scenesProcessed++;
  }

  // 5. Update main project meta with translationLanguages
  const mainMeta = await mainStore.readJSON<ProjectMeta>("project.json");
  if (mainMeta) {
    const existing = mainMeta.translationLanguages ?? [];
    if (!existing.includes(targetLang)) {
      await mainStore.writeJSON("project.json", {
        ...mainMeta,
        translationLanguages: [...existing, targetLang],
        updatedAt: new Date().toISOString(),
      });
    }
  }

  onProgress?.({ phase: "Done", current: sceneEntries.length, total: sceneEntries.length });
  return result;
}
