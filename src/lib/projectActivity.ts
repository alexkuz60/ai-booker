/**
 * projectActivity — track freshness of a project in OPFS.
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import { paths, getActiveLayout } from "@/lib/projectPaths";
import { getCachedSceneIndex } from "@/lib/sceneIndex";

interface TimestampedRecord {
  updatedAt?: string | null;
  createdAt?: string | null;
}

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

export async function getProjectActivityMs(storage: ProjectStorage): Promise<number> {
  let latest = 0;

  latest = Math.max(
    latest,
    await readUpdatedAt(storage, paths.projectMeta()),
    await readUpdatedAt(storage, paths.structureToc()),
  );

  if (getActiveLayout() === "v2") {
    // V2: sample a few storyboard files from scene index
    const index = getCachedSceneIndex();
    if (index) {
      const sampleIds = index.storyboarded.slice(0, 5);
      const timestamps = await Promise.all(
        sampleIds.map(sid => readUpdatedAt(storage, paths.storyboard(sid))),
      );
      for (const ts of timestamps) latest = Math.max(latest, ts);
    }
  } else {
    // V1: scan flat directories
    const [storyboardFiles, characterFiles] = await Promise.all([
      storage.listDir("storyboard").catch(() => [] as string[]),
      storage.listDir("characters").catch(() => [] as string[]),
    ]);

    const nestedTimestamps = await Promise.all([
      ...storyboardFiles
        .filter((file) => file.startsWith("scene_") && file.endsWith(".json"))
        .map((file) => readUpdatedAt(storage, `storyboard/${file}`)),
      ...characterFiles
        .filter((file) => file.startsWith("scene_") && file.endsWith(".json"))
        .map((file) => readUpdatedAt(storage, `characters/${file}`)),
    ]);

    for (const ts of nestedTimestamps) latest = Math.max(latest, ts);
  }

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
