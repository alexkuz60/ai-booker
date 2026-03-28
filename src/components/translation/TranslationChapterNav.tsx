/**
 * Scene navigator for Translation page — left sidebar within bilingual panel.
 * Lists scenes for the selected chapter with storyboard status indicators.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { FileText, CheckCircle2 } from "lucide-react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { SceneIndexData, SceneIndexEntry } from "@/lib/sceneIndex";
import { paths } from "@/lib/projectPaths";
import type { Scene } from "@/pages/parser/types";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  storage: ProjectStorage | null;
  chapterId: string | null;
  chapterIndex: number | null;
  selectedSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  isRu: boolean;
}

interface SceneEntry {
  sceneId: string;
  title: string;
  sceneNumber: number;
  isStoryboarded: boolean;
}

export function TranslationChapterNav({
  storage,
  chapterId,
  chapterIndex,
  selectedSceneId,
  onSelectScene,
  isRu,
}: Props) {
  const [scenes, setScenes] = useState<SceneEntry[]>([]);

  useEffect(() => {
    if (!storage || chapterId == null || chapterIndex == null) {
      setScenes([]);
      return;
    }

    let cancelled = false;

    (async () => {
      // Read scene index for storyboard status
      const sceneIndex = await storage.readJSON<SceneIndexData>(paths.sceneIndex());
      const storyboarded = new Set(sceneIndex?.storyboarded ?? []);
      const entries = sceneIndex?.entries ?? {};

      // Get scenes for this chapter
      const chapterScenes: SceneEntry[] = [];
      for (const [sceneId, entry] of Object.entries(entries)) {
        if (entry.chapterIndex !== chapterIndex) continue;
        chapterScenes.push({
          sceneId,
          title: `${isRu ? "Сцена" : "Scene"} ${entry.sceneNumber}`,
          sceneNumber: entry.sceneNumber,
          isStoryboarded: storyboarded.has(sceneId),
        });
      }

      // Try to get scene titles from chapter content
      try {
        const content = await storage.readJSON<{ scenes: Scene[] }>(
          paths.chapterContent(chapterId),
        );
        if (content?.scenes) {
          for (const entry of chapterScenes) {
            const scene = content.scenes.find((s) => s.id === entry.sceneId);
            if (scene?.title) {
              entry.title = scene.title;
            }
          }
        }
      } catch {
        // ignore — fallback to "Scene N"
      }

      chapterScenes.sort((a, b) => a.sceneNumber - b.sceneNumber);
      if (!cancelled) setScenes(chapterScenes);
    })();

    return () => { cancelled = true; };
  }, [storage, chapterId, chapterIndex, isRu]);

  if (!chapterId) {
    return (
      <div className="h-full flex items-center justify-center p-4 text-xs text-muted-foreground">
        {isRu ? "Выберите главу" : "Select a chapter"}
      </div>
    );
  }

  if (scenes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-4 text-xs text-muted-foreground">
        {isRu ? "Нет сцен" : "No scenes"}
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-0.5">
        {scenes.map((scene) => (
          <button
            key={scene.sceneId}
            onClick={() => onSelectScene(scene.sceneId)}
            className={cn(
              "w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors",
              "flex items-center gap-2",
              selectedSceneId === scene.sceneId
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted/50 text-muted-foreground",
            )}
          >
            <FileText className="h-3 w-3 shrink-0" />
            <span className="truncate flex-1">{scene.title}</span>
            {scene.isStoryboarded && (
              <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
            )}
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
