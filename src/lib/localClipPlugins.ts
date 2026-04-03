/**
 * localClipPlugins — OPFS persistence for per-clip plugin configurations.
 *
 * Replaces runtime reads from `clip_plugin_configs` DB table.
 * DB remains backup-only (Push to Server / Restore).
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";
import { readSceneIndex } from "@/lib/sceneIndex";
import type { ClipPluginConfig, SceneClipConfigs } from "@/hooks/useClipPluginConfigs";

// ─── Types ──────────────────────────────────────────────────

export interface LocalClipPluginsData {
  sceneId: string;
  updatedAt: string;
  configs: Record<string, { trackId: string; config: ClipPluginConfig }>;
}

// ─── Path resolution ────────────────────────────────────────

async function resolvedPath(
  storage: ProjectStorage,
  sceneId: string,
  chapterId?: string,
): Promise<string | null> {
  const p = paths.clipPlugins(sceneId, chapterId);
  if (!p.includes("__unresolved__")) return p;
  await readSceneIndex(storage);
  const p2 = paths.clipPlugins(sceneId, chapterId);
  return p2.includes("__unresolved__") ? null : p2;
}

// ─── Read / Write ───────────────────────────────────────────

export async function readClipPlugins(
  storage: ProjectStorage,
  sceneId: string,
  chapterId?: string,
): Promise<LocalClipPluginsData | null> {
  const p = await resolvedPath(storage, sceneId, chapterId);
  if (!p) return null;
  try {
    return await storage.readJSON<LocalClipPluginsData>(p);
  } catch {
    return null;
  }
}

export async function writeClipPlugins(
  storage: ProjectStorage,
  sceneId: string,
  configs: Record<string, { trackId: string; config: ClipPluginConfig }>,
  chapterId?: string,
): Promise<void> {
  const p = await resolvedPath(storage, sceneId, chapterId);
  if (!p) {
    console.error(`[localClipPlugins] Cannot resolve path for scene ${sceneId}`);
    return;
  }
  const data: LocalClipPluginsData = {
    sceneId,
    updatedAt: new Date().toISOString(),
    configs,
  };
  await storage.writeJSON(p, data);
}

/**
 * Convert LocalClipPluginsData → SceneClipConfigs (for hook consumption).
 */
export function toSceneClipConfigs(data: LocalClipPluginsData | null): SceneClipConfigs {
  if (!data) return {};
  const result: SceneClipConfigs = {};
  for (const [clipId, { config }] of Object.entries(data.configs)) {
    result[clipId] = config;
  }
  return result;
}
