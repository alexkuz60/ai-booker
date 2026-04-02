/**
 * useTranslationActions — extracted handlers for the Translation page.
 *
 * Consolidates translate/literary/critique per-segment and per-scene actions,
 * translation project creation, and batch chapter translation.
 *
 * Single-segment operations use `bilingualRef.patchSegment()` for flicker-free
 * in-place updates. Bulk operations (scene/chapter) call `bilingualRef.reload()`.
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { Segment } from "@/components/studio/storyboard/types";
import type { ProjectStorage, ProjectMeta } from "@/lib/projectStorage";
import type { TranslationReadiness } from "@/lib/translationProject";
import { createTranslationProject, translationProjectExists } from "@/lib/translationProject";
import type { SelectedSegmentData } from "@/components/translation/BilingualSegmentsView";
import type { BilingualSegmentsHandle } from "@/components/translation/BilingualSegmentsView";

interface Deps {
  storage: ProjectStorage | null;
  meta: ProjectMeta | null;
  isRu: boolean;
  /** Currently selected scene */
  selectedSceneId: string | null;
  /** Currently selected chapter */
  selectedChapter: { index: number; chapterId: string; title: string } | null;
  /** Readiness data */
  readiness: TranslationReadiness | null;
  /** Currently selected segment */
  selectedSegment: SelectedSegmentData | null;
  setSelectedSegment: React.Dispatch<React.SetStateAction<SelectedSegmentData | null>>;
  /** Ref to BilingualSegmentsView for granular updates */
  bilingualRef: React.RefObject<BilingualSegmentsHandle | null>;
  /** Callback to bump quality chart refresh */
  onQualityUpdate?: () => void;
  /** Hooks */
  doTranslateSegments: (segments: Segment[], sceneId: string, chapterId: string) => Promise<any>;
  editSegment: (seg: Segment, sceneId: string, chapterId: string, originalText: string) => Promise<any>;
  critiqueSegment: (seg: Segment, sceneId: string, chapterId: string, originalText: string) => Promise<any>;
  translateSceneFull: (sceneId: string, chapterId: string) => Promise<any>;
  translateChapterBatch: (chapterIndex: number, chapterId: string) => Promise<any>;
  refreshTransStorage: () => void;
}

export function useTranslationActions(deps: Deps) {
  const {
    storage, meta, isRu,
    selectedSceneId, selectedChapter,
    readiness, selectedSegment, setSelectedSegment,
    bilingualRef, onQualityUpdate,
    doTranslateSegments, editSegment, critiqueSegment,
    translateSceneFull, translateChapterBatch,
    refreshTransStorage,
  } = deps;

  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState<string | null>(null);

  const handleTranslateSegments = useCallback(async (segments: Segment[]) => {
    if (!selectedSceneId || !selectedChapter?.chapterId) return;
    const result = await doTranslateSegments(segments, selectedSceneId, selectedChapter.chapterId);
    if (result?.translations) {
      // Patch each translated segment in-place
      for (const [segId, text] of result.translations) {
        bilingualRef.current?.patchSegment(segId, text, "literal");
      }
      onQualityUpdate?.();
    }
  }, [doTranslateSegments, selectedSceneId, selectedChapter, bilingualRef, onQualityUpdate]);

  const handleLiteraryEdit = useCallback(async (seg: Segment) => {
    if (!selectedSceneId || !selectedChapter?.chapterId || !storage) return;
    const srcSbPath = `chapters/${selectedChapter.chapterId}/scenes/${selectedSceneId}/storyboard.json`;
    const srcData = await storage.readJSON<any>(srcSbPath);
    const srcSeg = srcData?.segments?.find((s: any) => s.segment_id === seg.segment_id);
    const originalText = srcSeg?.phrases?.map((p: any) => p.text).join(" ") ?? "";
    const result = await editSegment(seg, selectedSceneId, selectedChapter.chapterId, originalText);
    if (result) {
      // Patch in-place
      bilingualRef.current?.patchSegment(seg.segment_id, result.text, "literary");
      if (selectedSegment?.segmentId === seg.segment_id) {
        setSelectedSegment({ ...selectedSegment, translatedText: result.text });
      }
      onQualityUpdate?.();
    }
  }, [editSegment, selectedSceneId, selectedChapter, storage, selectedSegment, setSelectedSegment, bilingualRef, onQualityUpdate]);

  const handleCritique = useCallback(async (seg: Segment) => {
    if (!selectedSceneId || !selectedChapter?.chapterId || !storage) return;
    const srcSbPath = `chapters/${selectedChapter.chapterId}/scenes/${selectedSceneId}/storyboard.json`;
    const srcData = await storage.readJSON<any>(srcSbPath);
    const srcSeg = srcData?.segments?.find((s: any) => s.segment_id === seg.segment_id);
    const originalText = srcSeg?.phrases?.map((p: any) => p.text).join(" ") ?? "";
    const result = await critiqueSegment(seg, selectedSceneId, selectedChapter.chapterId, originalText);
    if (result) {
      // Patch stage only — text stays as literary
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

  const handleCreateTranslation = useCallback(async () => {
    if (!storage || !meta || !readiness) return;
    const readyIndices = Array.from(readiness.readyChapters.keys());
    if (readyIndices.length === 0) {
      toast.error(isRu
        ? "Нет глав, готовых к переводу. Выполните раскадровку в Студии."
        : "No chapters ready for translation. Complete storyboarding in Studio.");
      return;
    }

    const tLang = (meta.language === "ru" ? "en" : "ru") as "en" | "ru";

    const exists = await translationProjectExists(storage, meta);
    if (exists) {
      toast.error(isRu
        ? `Проект перевода "${storage.projectName}_${tLang.toUpperCase()}" уже существует`
        : `Translation project "${storage.projectName}_${tLang.toUpperCase()}" already exists`);
      return;
    }

    setCreating(true);
    setCreateProgress(isRu ? "Подготовка…" : "Preparing…");
    try {
      await createTranslationProject({
        sourceStorage: storage,
        sourceMeta: meta,
        targetLanguage: tLang,
        chapterIndices: readyIndices,
        onProgress: (label) => setCreateProgress(label),
      });
      toast.success(
        isRu
          ? `Проект перевода создан (${readyIndices.length} глав)`
          : `Translation project created (${readyIndices.length} chapters)`,
      );
      refreshTransStorage();
    } catch (err) {
      console.error("[Translation] create error:", err);
      toast.error(isRu ? "Ошибка создания проекта перевода" : "Failed to create translation project");
    } finally {
      setCreating(false);
      setCreateProgress(null);
    }
  }, [storage, meta, readiness, isRu, refreshTransStorage]);

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
