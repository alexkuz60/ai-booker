/**
 * useTranslationActions — extracted handlers for the Translation page.
 *
 * Now uses single storage + targetLang for all operations.
 * No more separate translation OPFS project.
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { Segment } from "@/components/studio/storyboard/types";
import type { ProjectStorage, ProjectMeta } from "@/lib/projectStorage";
import type { TranslationReadiness } from "@/lib/translationProject";
import type { SelectedSegmentData } from "@/components/translation/BilingualSegmentsView";
import type { BilingualSegmentsHandle } from "@/components/translation/BilingualSegmentsView";
import { paths } from "@/lib/projectPaths";

interface Deps {
  storage: ProjectStorage | null;
  meta: ProjectMeta | null;
  isRu: boolean;
  targetLang: string;
  selectedSceneId: string | null;
  selectedChapter: { index: number; chapterId: string; title: string } | null;
  readiness: TranslationReadiness | null;
  selectedSegment: SelectedSegmentData | null;
  setSelectedSegment: React.Dispatch<React.SetStateAction<SelectedSegmentData | null>>;
  bilingualRef: React.RefObject<BilingualSegmentsHandle | null>;
  onQualityUpdate?: () => void;
  doTranslateSegments: (segments: Segment[], sceneId: string, chapterId: string) => Promise<any>;
  editSegment: (seg: Segment, sceneId: string, chapterId: string, originalText: string) => Promise<any>;
  critiqueSegment: (seg: Segment, sceneId: string, chapterId: string, originalText: string) => Promise<any>;
  translateSceneFull: (sceneId: string, chapterId: string) => Promise<any>;
  translateChapterBatch: (chapterIndex: number, chapterId: string) => Promise<any>;
}

export function useTranslationActions(deps: Deps) {
  const {
    storage, meta, isRu, targetLang,
    selectedSceneId, selectedChapter,
    readiness, selectedSegment, setSelectedSegment,
    bilingualRef, onQualityUpdate,
    doTranslateSegments, editSegment, critiqueSegment,
    translateSceneFull, translateChapterBatch,
  } = deps;

  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState<string | null>(null);

  const handleTranslateSegments = useCallback(async (segments: Segment[]) => {
    if (!selectedSceneId || !selectedChapter?.chapterId) return;
    const result = await doTranslateSegments(segments, selectedSceneId, selectedChapter.chapterId);
    if (result?.translations) {
      for (const [segId, text] of result.translations) {
        bilingualRef.current?.patchSegment(segId, text, "literal");
      }
      onQualityUpdate?.();
    }
  }, [doTranslateSegments, selectedSceneId, selectedChapter, bilingualRef, onQualityUpdate]);

  const handleLiteraryEdit = useCallback(async (seg: Segment) => {
    if (!selectedSceneId || !selectedChapter?.chapterId || !storage) return;
    // Read original text from source storyboard
    const srcSbPath = paths.storyboard(selectedSceneId, selectedChapter.chapterId);
    const srcData = await storage.readJSON<any>(srcSbPath);
    const srcSeg = srcData?.segments?.find((s: any) => s.segment_id === seg.segment_id);
    const originalText = srcSeg?.phrases?.map((p: any) => p.text).join(" ") ?? "";
    const result = await editSegment(seg, selectedSceneId, selectedChapter.chapterId, originalText);
    if (result) {
      bilingualRef.current?.patchSegment(seg.segment_id, result.text, "literary");
      if (selectedSegment?.segmentId === seg.segment_id) {
        setSelectedSegment({ ...selectedSegment, translatedText: result.text });
      }
      onQualityUpdate?.();
    }
  }, [editSegment, selectedSceneId, selectedChapter, storage, selectedSegment, setSelectedSegment, bilingualRef, onQualityUpdate]);

  const handleCritique = useCallback(async (seg: Segment) => {
    if (!selectedSceneId || !selectedChapter?.chapterId || !storage) return;
    const srcSbPath = paths.storyboard(selectedSceneId, selectedChapter.chapterId);
    const srcData = await storage.readJSON<any>(srcSbPath);
    const srcSeg = srcData?.segments?.find((s: any) => s.segment_id === seg.segment_id);
    const originalText = srcSeg?.phrases?.map((p: any) => p.text).join(" ") ?? "";
    const result = await critiqueSegment(seg, selectedSceneId, selectedChapter.chapterId, originalText);
    if (result) {
      bilingualRef.current?.patchSegment(seg.segment_id, selectedSegment?.translatedText ?? "", "critique");
      if (selectedSegment?.segmentId === seg.segment_id) {
        setSelectedSegment(prev => prev ? { ...prev } : null);
      }
      onQualityUpdate?.();
    }
  }, [critiqueSegment, selectedSceneId, selectedChapter, storage, selectedSegment, setSelectedSegment, bilingualRef, onQualityUpdate]);

  const handleTranslateSceneFull = useCallback(async () => {
    if (!selectedSceneId || !selectedChapter?.chapterId) return;
    await translateSceneFull(selectedSceneId, selectedChapter.chapterId);
  }, [translateSceneFull, selectedSceneId, selectedChapter]);

  const handleTranslateChapter = useCallback(async () => {
    if (!selectedChapter) return;
    await translateChapterBatch(selectedChapter.index, selectedChapter.chapterId);
  }, [translateChapterBatch, selectedChapter]);

  /** Initialize translation by marking the target language in project.json */
  const handleCreateTranslation = useCallback(async () => {
    if (!storage || !meta || !readiness) return;
    const readyIndices = Array.from(readiness.readyChapters.keys());
    if (readyIndices.length === 0) {
      toast.error(isRu
        ? "Нет глав, готовых к переводу. Выполните раскадровку в Студии."
        : "No chapters ready for translation. Complete storyboarding in Studio.");
      return;
    }

    setCreating(true);
    setCreateProgress(isRu ? "Подготовка…" : "Preparing…");
    try {
      // Simply mark translation language in project.json
      const currentMeta = await storage.readJSON<Record<string, unknown>>(paths.projectMeta());
      if (!currentMeta) throw new Error("Cannot read project.json");

      const existingLangs = (currentMeta.translationLanguages as string[]) ?? [];
      if (!existingLangs.includes(targetLang)) {
        await storage.writeJSON(paths.projectMeta(), {
          ...currentMeta,
          translationLanguages: [...existingLangs, targetLang],
          updatedAt: new Date().toISOString(),
        });
      }

      toast.success(
        isRu
          ? `Перевод на ${targetLang.toUpperCase()} активирован (${readyIndices.length} глав)`
          : `Translation to ${targetLang.toUpperCase()} activated (${readyIndices.length} chapters)`,
      );
    } catch (err) {
      console.error("[Translation] create error:", err);
      toast.error(isRu ? "Ошибка инициализации перевода" : "Failed to initialize translation");
    } finally {
      setCreating(false);
      setCreateProgress(null);
    }
  }, [storage, meta, readiness, isRu, targetLang]);

  return {
    creating,
    createProgress,
    handleTranslateSegments,
    handleLiteraryEdit,
    handleCritique,
    handleTranslateSceneFull,
    handleTranslateChapter,
    handleCreateTranslation,
  };
}
