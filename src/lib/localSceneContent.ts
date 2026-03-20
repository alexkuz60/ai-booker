import type { ProjectStorage } from "@/lib/projectStorage";
import type { LocalChapterData } from "@/lib/localSync";

export interface LocalSceneContentResult {
  chapterId: string;
  sceneNumber: number;
  title: string;
  content: string;
}

export async function readSceneContentFromLocal(
  storage: ProjectStorage,
  sceneId: string,
): Promise<LocalSceneContentResult | null> {
  const sceneFiles = await storage.listDir("scenes");

  for (const file of sceneFiles) {
    if (!file.startsWith("chapter_") || !file.endsWith(".json")) continue;

    const localChapter = await storage.readJSON<LocalChapterData>(`scenes/${file}`);
    const localScene = localChapter?.scenes?.find((scene) => scene.id === sceneId);
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