/**
 * Helpers to fetch a scene's full text content from a local project storage backend.
 * Prefers exact chapter file when possible, falls back to scanning all scenes.
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import type { LocalChapterData } from "@/lib/localSync";
import { paths, getActiveLayout } from "@/lib/projectPaths";
import { resolveChapterId } from "@/lib/sceneIndex";

export interface LocalSceneContentResult {
  chapterId: string;
  sceneNumber: number;
  title: string;
  content: string;
}

export interface LocalSceneLookup {
  sceneId?: string | null;
  chapterId?: string | null;
  sceneNumber?: number | null;
  title?: string | null;
}

// ─── Matching utilities ──────────────────────────────────────

function normalizeTitle(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function getSceneContent(
  localChapter: LocalChapterData | null,
  lookup: LocalSceneLookup,
): (LocalChapterData["scenes"][number] & { scene_number: number }) | null {
  if (!localChapter?.scenes?.length) return null;

  for (const scene of localChapter.scenes) {
    // Match by sceneId
    if (lookup.sceneId && (scene as any).id === lookup.sceneId) {
      return { ...scene, scene_number: (scene as any).scene_number ?? 1 };
    }
    // Match by sceneNumber + title
    if (
      lookup.sceneNumber != null &&
      (scene as any).scene_number === lookup.sceneNumber &&
      (!lookup.title || normalizeTitle((scene as any).title) === normalizeTitle(lookup.title))
    ) {
      return { ...scene, scene_number: (scene as any).scene_number ?? 1 };
    }
    // Match by title only
    if (lookup.title && normalizeTitle((scene as any).title) === normalizeTitle(lookup.title)) {
      return { ...scene, scene_number: (scene as any).scene_number ?? 1 };
    }
  }
  return null;
}

function toLookup(sceneIdOrLookup: string | LocalSceneLookup): LocalSceneLookup {
  return typeof sceneIdOrLookup === "string" ? { sceneId: sceneIdOrLookup } : sceneIdOrLookup;
}

// ─── Main API ────────────────────────────────────────────────

export async function readSceneContentFromLocal(
  storage: ProjectStorage,
  sceneIdOrLookup: string | LocalSceneLookup,
): Promise<LocalSceneContentResult | null> {
  const lookup = toLookup(sceneIdOrLookup);

  // Try to resolve chapterId from scene index if not provided
  const effectiveChapterId =
    lookup.chapterId ??
    (lookup.sceneId ? resolveChapterId(lookup.sceneId) : undefined) ??
    null;

  if (effectiveChapterId) {
    try {
      const localChapter = await storage.readJSON<LocalChapterData>(
        paths.chapterContent(effectiveChapterId),
      );
      const localScene = getSceneContent(localChapter, lookup);
      const content = localScene?.content;

      if (localChapter && localScene && content?.trim()) {
        return {
          chapterId: localChapter.chapterId,
          sceneNumber: localScene.scene_number,
          title: localScene.title,
          content,
        };
      }
    } catch {
      // Exact chapter file may be absent — fall through to full scan.
    }
  }

  // Full scan fallback
  const isV2 = getActiveLayout() === "v2";

  if (isV2) {
    // V2: scan chapters/ directories
    const chapterDirs = await storage.listDir("chapters").catch(() => []);
    for (const chapterId of chapterDirs) {
      const localChapter = await storage.readJSON<LocalChapterData>(
        `chapters/${chapterId}/content.json`,
      );
      const localScene = getSceneContent(localChapter, lookup);
      const content = localScene?.content;

      if (!localChapter || !localScene || !content?.trim()) continue;

      return {
        chapterId: localChapter.chapterId,
        sceneNumber: localScene.scene_number,
        title: localScene.title,
        content,
      };
    }
  } else {
    // V1: scan scenes/ directory
    const contentDir = paths.chapterContentDir();
    const sceneFiles = await storage.listDir(contentDir);

    for (const file of sceneFiles) {
      if (!paths.isChapterContentFile(file)) continue;

      const localChapter = await storage.readJSON<LocalChapterData>(`${contentDir}/${file}`);
      const localScene = getSceneContent(localChapter, lookup);
      const content = localScene?.content;

      if (!localChapter || !localScene || !content?.trim()) continue;

      return {
        chapterId: localChapter.chapterId,
        sceneNumber: localScene.scene_number,
        title: localScene.title,
        content,
      };
    }
  }

  return null;
}
