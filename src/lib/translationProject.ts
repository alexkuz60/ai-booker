/**
 * translationProject — readiness check for art-translation.
 *
 * With the unified storage architecture, translation data lives in
 * lang-subfolders within each scene (e.g. chapters/{ch}/scenes/{sc}/en/).
 * No separate OPFS mirror project is needed.
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";
import type { SceneIndexData } from "@/lib/sceneIndex";

// ─── Types ──────────────────────────────────────────────────

export interface TranslationReadiness {
  /** Chapter index → list of scene IDs that are storyboarded */
  readyChapters: Map<number, string[]>;
  /** Chapter index → list of scene IDs NOT storyboarded */
  notReadyChapters: Map<number, string[]>;
  /** Total storyboarded scenes */
  totalReady: number;
  /** Total scenes */
  totalScenes: number;
}

/** Check which chapters are ready for translation (all scenes storyboarded). */
export async function checkTranslationReadiness(
  storage: ProjectStorage,
): Promise<TranslationReadiness> {
  const sceneIndex = await storage.readJSON<SceneIndexData>(paths.sceneIndex());
  const storyboarded = new Set(sceneIndex?.storyboarded ?? []);
  const entries = sceneIndex?.entries ?? {};

  const readyChapters = new Map<number, string[]>();
  const notReadyChapters = new Map<number, string[]>();

  // Group scenes by chapterIndex
  const byChapter = new Map<number, string[]>();
  for (const [sceneId, entry] of Object.entries(entries)) {
    const list = byChapter.get(entry.chapterIndex) ?? [];
    list.push(sceneId);
    byChapter.set(entry.chapterIndex, list);
  }

  let totalReady = 0;
  let totalScenes = 0;

  for (const [chapterIndex, sceneIds] of byChapter) {
    const ready = sceneIds.filter((id) => storyboarded.has(id));
    const notReady = sceneIds.filter((id) => !storyboarded.has(id));
    totalReady += ready.length;
    totalScenes += sceneIds.length;

    if (notReady.length === 0 && ready.length > 0) {
      readyChapters.set(chapterIndex, ready);
    } else {
      notReadyChapters.set(chapterIndex, notReady);
    }
  }

  return { readyChapters, notReadyChapters, totalReady, totalScenes };
}
