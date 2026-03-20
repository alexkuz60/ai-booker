import type { ProjectStorage } from "@/lib/projectStorage";
import type { LocalChapterData } from "@/lib/localSync";

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

function normalizeTitle(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function getSceneContent(localChapter: LocalChapterData | null, lookup: LocalSceneLookup) {
  if (!localChapter?.scenes?.length) return null;

  const normalizedTitle = normalizeTitle(lookup.title);

  return localChapter.scenes.find((scene) => {
    if (lookup.sceneId && scene.id === lookup.sceneId) return true;

    if (lookup.sceneNumber !== null && lookup.sceneNumber !== undefined && scene.scene_number === lookup.sceneNumber) {
      if (!normalizedTitle) return true;
      return normalizeTitle(scene.title) === normalizedTitle;
    }

    if (normalizedTitle) {
      return normalizeTitle(scene.title) === normalizedTitle;
    }

    return false;
  }) || null;
}

function toLookup(sceneIdOrLookup: string | LocalSceneLookup): LocalSceneLookup {
  return typeof sceneIdOrLookup === "string"
    ? { sceneId: sceneIdOrLookup }
    : sceneIdOrLookup;
}

export async function readSceneContentFromLocal(
  storage: ProjectStorage,
  sceneIdOrLookup: string | LocalSceneLookup,
): Promise<LocalSceneContentResult | null> {
  const lookup = toLookup(sceneIdOrLookup);

  if (lookup.chapterId) {
    try {
      const localChapter = await storage.readJSON<LocalChapterData>(`scenes/chapter_${lookup.chapterId}.json`);
      const localScene = getSceneContent(localChapter, lookup);
      const content = localScene?.content ?? localScene?.content_preview;

      if (localChapter && localScene && content?.trim()) {
        return {
          chapterId: localChapter.chapterId,
          sceneNumber: localScene.scene_number,
          title: localScene.title,
          content,
        };
      }
    } catch {
      // Exact chapter file may be absent for aggregated/folder chapters — fall through to full scan.
    }
  }

  const sceneFiles = await storage.listDir("scenes");

  for (const file of sceneFiles) {
    if (!file.startsWith("chapter_") || !file.endsWith(".json")) continue;

    const localChapter = await storage.readJSON<LocalChapterData>(`scenes/${file}`);
    const localScene = getSceneContent(localChapter, lookup);
    const content = localScene?.content ?? localScene?.content_preview;

    if (!localChapter || !localScene || !content?.trim()) continue;

    return {
      chapterId: localChapter.chapterId,
      sceneNumber: localScene.scene_number,
      title: localScene.title,
      content,
    };
  }

  return null;
}