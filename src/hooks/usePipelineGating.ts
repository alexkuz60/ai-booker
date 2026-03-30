/**
 * usePipelineGating — checks if pipeline stages are unlocked for navigation.
 *
 * Rules:
 * - Parser: always accessible (first work stage after Library)
 * - Studio: requires parser complete (toc_extracted + scenes_analyzed + characters_extracted)
 * - Montage: requires at least one scene rendered (scene_render)
 * - Translation: requires storyboard_done
 */

import { usePipelineProgress } from "@/hooks/usePipelineProgress";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import type { PipelineProgress } from "@/lib/projectStorage";

export interface GatingResult {
  /** Is a project currently open? */
  hasProject: boolean;
  /** Per-route lock status */
  isLocked: (route: string) => boolean;
  /** Reason string (ru/en) for why a route is locked */
  lockReason: (route: string, isRu: boolean) => string | null;
  /** Raw progress */
  progress: PipelineProgress;
  loading: boolean;
}

function parserDone(p: PipelineProgress): boolean {
  return !!p.toc_extracted && !!p.scenes_analyzed && !!p.characters_extracted;
}

function studioDone(p: PipelineProgress): boolean {
  return !!p.scene_render;
}

function storyboardReady(p: PipelineProgress): boolean {
  return !!p.storyboard_done;
}

export function usePipelineGating(): GatingResult {
  const { storage, isOpen } = useProjectStorageContext();
  const { progress, loading } = usePipelineProgress(isOpen ? storage : null);

  const hasProject = !!isOpen;

  const isLocked = (route: string): boolean => {
    if (!hasProject) {
      // Without a project, only Library/Home/Profile/Admin are accessible
      return ["/parser", "/studio", "/montage", "/translation", "/narrators", "/soundscape"].includes(route);
    }
    switch (route) {
      case "/studio":
        return !parserDone(progress);
      case "/montage":
        return !studioDone(progress);
      case "/translation":
        return !storyboardReady(progress);
      default:
        return false;
    }
  };

  const lockReason = (route: string, isRu: boolean): string | null => {
    if (!hasProject) {
      return isRu ? "Сначала откройте проект в Библиотеке" : "Open a project in the Library first";
    }
    switch (route) {
      case "/studio":
        if (!parserDone(progress)) {
          return isRu
            ? "Завершите этап Парсера (TOC, сцены, персонажи)"
            : "Complete the Parser stage (TOC, scenes, characters)";
        }
        return null;
      case "/montage":
        if (!studioDone(progress)) {
          return isRu
            ? "Завершите рендер хотя бы одной сцены в Студии"
            : "Render at least one scene in the Studio first";
        }
        return null;
      case "/translation":
        if (!storyboardReady(progress)) {
          return isRu
            ? "Раскадровка должна быть готова"
            : "Storyboard must be completed first";
        }
        return null;
      default:
        return null;
    }
  };

  return { hasProject, isLocked, lockReason, progress, loading };
}
