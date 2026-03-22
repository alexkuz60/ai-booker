import type { ProjectStorage } from "@/lib/projectStorage";

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
    await readUpdatedAt(storage, "project.json"),
    await readUpdatedAt(storage, "structure/toc.json"),
  );

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

  for (const ts of nestedTimestamps) {
    latest = Math.max(latest, ts);
  }

  return latest;
}

export async function touchProjectUpdatedAt(storage: ProjectStorage): Promise<void> {
  try {
    const projectMeta = await storage.readJSON<Record<string, unknown>>("project.json");
    if (!projectMeta) return;
    await storage.writeJSON("project.json", {
      ...projectMeta,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[projectActivity] Failed to update project timestamp:", err);
  }
}