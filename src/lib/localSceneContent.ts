/**
 * Helpers to fetch a scene's full text content from local project storage (V2 layout).
 * Prefers exact chapter file when possible, falls back to scanning all chapters.
 *
 * IMPORTANT: when a sceneId is provided, we must NEVER degrade into fuzzy title-only
 * matching for another scene. Wrong content is worse than an empty result.
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import type { LocalChapterData } from "@/lib/localSync";
import { paths } from "@/lib/projectPaths";
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

type LocalSceneRecord = LocalChapterData["scenes"][number] & { scene_number: number };

function normalizeTitle(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function withSceneNumber(scene: LocalChapterData["scenes"][number]): LocalSceneRecord {
  return { ...scene, scene_number: (scene as any).scene_number ?? 1 };
}

function findBySceneId(
  localChapter: LocalChapterData | null,
  sceneId: string,
): LocalSceneRecord | null {
  if (!localChapter?.scenes?.length) return null;
  for (const scene of localChapter.scenes) {
    if ((scene as any).id === sceneId) return withSceneNumber(scene);
  }
  return null;
}

function findBySceneNumber(
  localChapter: LocalChapterData | null,
  sceneNumber: number,
): LocalSceneRecord | null {
  if (!localChapter?.scenes?.length) return null;
  for (const scene of localChapter.scenes) {
    if ((scene as any).scene_number === sceneNumber) return withSceneNumber(scene);
  }
  return null;
}

function findByTitle(
  localChapter: LocalChapterData | null,
  title: string,
): LocalSceneRecord | null {
  if (!localChapter?.scenes?.length) return null;
  const normalized = normalizeTitle(title);
  if (!normalized) return null;

  for (const scene of localChapter.scenes) {
    if (normalizeTitle((scene as any).title) === normalized) {
      return withSceneNumber(scene);
    }
  }
  return null;
}

function getSceneContent(
  localChapter: LocalChapterData | null,
  lookup: LocalSceneLookup,
): LocalSceneRecord | null {
  if (!localChapter?.scenes?.length) return null;

  // 1) Exact sceneId always wins.
  if (lookup.sceneId) {
    const exact = findBySceneId(localChapter, lookup.sceneId);
    if (exact) return exact;

    // 2) If sceneId is stale but chapterId/sceneNumber still point to the same chapter,
    // allow only exact sceneNumber fallback (optionally validated by title).
    if (lookup.sceneNumber != null) {
      const byNumber = findBySceneNumber(localChapter, lookup.sceneNumber);
      if (
        byNumber &&
        (!lookup.title || normalizeTitle(byNumber.title) === normalizeTitle(lookup.title))
      ) {
        return byNumber;
      }
    }

    // IMPORTANT: never title-scan another scene when sceneId was supplied.
    return null;
  }

  // 3) Number-based lookup is safe inside a known chapter.
  if (lookup.sceneNumber != null) {
    const byNumber = findBySceneNumber(localChapter, lookup.sceneNumber);
    if (
      byNumber &&
      (!lookup.title || normalizeTitle(byNumber.title) === normalizeTitle(lookup.title))
    ) {
      return byNumber;
    }
    return null;
  }

  // 4) Title-only lookup is last resort and used only when no sceneId was supplied.
  if (lookup.title) {
    return findByTitle(localChapter, lookup.title);
  }

  return null;
}

function toLookup(sceneIdOrLookup: string | LocalSceneLookup): LocalSceneLookup {
  return typeof sceneIdOrLookup === "string" ? { sceneId: sceneIdOrLookup } : sceneIdOrLookup;
}

async function readChapterScene(
  storage: ProjectStorage,
  chapterId: string,
  lookup: LocalSceneLookup,
): Promise<LocalSceneContentResult | null> {
  try {
    const localChapter = await storage.readJSON<LocalChapterData>(paths.chapterContent(chapterId));
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
    // Missing chapter file — caller may choose a broader lookup strategy.
  }

  return null;
}

async function scanAllChapters(
  storage: ProjectStorage,
  lookup: LocalSceneLookup,
): Promise<LocalSceneContentResult | null> {
  const chapterDirs = await storage.listDir("chapters").catch(() => []);
  for (const chapterId of chapterDirs) {
    const resolved = await readChapterScene(storage, chapterId, lookup);
    if (resolved) return resolved;
  }
  return null;
}

export async function readSceneContentFromLocal(
  storage: ProjectStorage,
  sceneIdOrLookup: string | LocalSceneLookup,
): Promise<LocalSceneContentResult | null> {
  const lookup = toLookup(sceneIdOrLookup);

  const effectiveChapterId =
    lookup.chapterId ??
    (lookup.sceneId ? resolveChapterId(lookup.sceneId) : undefined) ??
    null;

  // First: read from the intended chapter only.
  if (effectiveChapterId) {
    const direct = await readChapterScene(storage, effectiveChapterId, lookup);
    if (direct) return direct;

    // If we have a sceneId and direct chapter lookup failed, only try exact sceneId globally.
    // Never downgrade into fuzzy title matching across other chapters.
    if (lookup.sceneId) {
      return scanAllChapters(storage, { sceneId: lookup.sceneId });
    }
  }

  // If no chapter could be resolved, exact sceneId scan is still safe.
  if (lookup.sceneId) {
    const exact = await scanAllChapters(storage, { sceneId: lookup.sceneId });
    if (exact) return exact;

    // As a last safe fallback, allow chapter-local number/title matching only if no sceneId path worked.
    if (lookup.sceneNumber != null && lookup.chapterId) {
      return readChapterScene(storage, lookup.chapterId, {
        chapterId: lookup.chapterId,
        sceneNumber: lookup.sceneNumber,
        title: lookup.title,
      });
    }

    return null;
  }

  return scanAllChapters(storage, lookup);
}
