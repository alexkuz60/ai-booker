/**
 * projectActivity — track freshness of a project in OPFS (V2 layout).
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";

interface TimestampedRecord {
  updatedAt?: string | null;
  createdAt?: string | null;
}

interface StoredSceneIndex {
  entries?: Record<string, { chapterId?: string | null }>;
  storyboarded?: string[];
}

const SCENE_SAMPLE_LIMIT = 3;
const TRANSLATION_SAMPLE_LIMIT = 2;
const SYNOPSIS_SAMPLE_LIMIT = 5;
const LANG_DIR_RE = /^[a-z]{2}$/i;
const TRANSLATION_RADAR_STAGES = ["literal", "literary", "critique"] as const;

function toMs(value?: string | null): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

async function readUpdatedAt(storage: ProjectStorage, path: string): Promise<number> {
  try {
    const data = await storage.readJSON<TimestampedRecord>(path);
    return Math.max(toMs(data?.updatedAt), toMs(data?.createdAt));
  } catch {
    return 0;
  }
}

async function readLatestFromPaths(
  storage: ProjectStorage,
  filePaths: string[],
): Promise<number> {
  if (filePaths.length === 0) return 0;
  const timestamps = await Promise.all(filePaths.map((path) => readUpdatedAt(storage, path)));
  return timestamps.reduce((max, ts) => Math.max(max, ts), 0);
}

export async function getProjectActivityMs(storage: ProjectStorage): Promise<number> {
  const [projectMetaTs, structureTs, sceneIndex] = await Promise.all([
    readUpdatedAt(storage, paths.projectMeta()),
    readUpdatedAt(storage, paths.structureToc()),
    storage.readJSON<StoredSceneIndex>(paths.sceneIndex()).catch(() => null),
  ]);

  let latest = Math.max(projectMetaTs, structureTs);

  const sceneEntries = sceneIndex?.entries ?? {};
  const sampledSceneIds = (
    Array.isArray(sceneIndex?.storyboarded) && sceneIndex.storyboarded.length > 0
      ? sceneIndex.storyboarded
      : Object.keys(sceneEntries)
  ).slice(0, SCENE_SAMPLE_LIMIT);

  for (const sceneId of sampledSceneIds) {
    const chapterId = sceneEntries[sceneId]?.chapterId;
    if (!chapterId) continue;

    latest = Math.max(
      latest,
      await readLatestFromPaths(storage, [
        paths.storyboard(sceneId, chapterId),
        paths.audioMeta(sceneId, chapterId),
        paths.clipPlugins(sceneId, chapterId),
        paths.mixerState(sceneId, chapterId),
      ]),
    );

    const sceneDir = `chapters/${chapterId}/scenes/${sceneId}`;
    const langDirs = (await storage.listDir(sceneDir).catch(() => [] as string[]))
      .filter((item) => LANG_DIR_RE.test(item))
      .slice(0, TRANSLATION_SAMPLE_LIMIT);

    for (const lang of langDirs) {
      latest = Math.max(
        latest,
        await readLatestFromPaths(storage, [
          paths.translationStoryboard(sceneId, lang, chapterId),
          paths.translationAudioMeta(sceneId, lang, chapterId),
          paths.translationClipPlugins(sceneId, lang, chapterId),
          paths.translationMixerState(sceneId, lang, chapterId),
          ...TRANSLATION_RADAR_STAGES.map((stage) =>
            paths.translationRadar(sceneId, lang, stage, chapterId),
          ),
        ]),
      );
    }
  }

  const synopsisFiles = await storage.listDir("synopsis").catch(() => [] as string[]);
  latest = Math.max(
    latest,
    await readLatestFromPaths(
      storage,
      synopsisFiles.slice(0, SYNOPSIS_SAMPLE_LIMIT).map((fileName) => `synopsis/${fileName}`),
    ),
  );

  return latest;
}

export async function touchProjectUpdatedAt(storage: ProjectStorage): Promise<void> {
  try {
    const projectMeta = await storage.readJSON<Record<string, unknown>>(paths.projectMeta());
    if (!projectMeta) return;
    await storage.writeJSON(paths.projectMeta(), {
      ...projectMeta,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[projectActivity] Failed to update project timestamp:", err);
  }
}
