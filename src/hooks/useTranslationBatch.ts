/**
 * useTranslationBatch — orchestrates chapter-level batch translation
 * using ModelPoolManager for parallel scene processing through the full pipeline.
 *
 * Now uses single storage + targetLang instead of separate translationStorage.
 */

import { useState, useCallback, useRef } from "react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { Segment } from "@/components/studio/storyboard/types";
import type { LocalStoryboardData } from "@/lib/storyboardSync";
import type { SceneIndexData } from "@/lib/sceneIndex";
import type { AiRoleId } from "@/config/aiRoles";
import { ModelPoolManager, logPoolStats, type PoolTask, type PoolProgress, type PoolStats } from "@/lib/modelPoolManager";
import { runTranslationPipeline, type TranslationSceneResult, type TranslationSegmentResult, type PipelineProgress } from "@/lib/translationPipeline";
import { paths } from "@/lib/projectPaths";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BatchTranslationProgress {
  scenesTotal: number;
  scenesDone: number;
  scenesFailed: number;
  currentStage?: PipelineProgress;
  poolStats?: PoolStats[];
  running: boolean;
}

export interface UseTranslationBatchReturn {
  translateSceneFull: (sceneId: string, chapterId: string) => Promise<TranslationSceneResult | null>;
  translateChapterBatch: (chapterIndex: number, chapterId: string) => Promise<void>;
  progress: BatchTranslationProgress;
  abort: () => void;
}

interface Opts {
  storage: ProjectStorage | null;
  userApiKeys: Record<string, string>;
  sourceLang: string;
  targetLang: string;
  isRu: boolean;
  getModelForRole: (role: AiRoleId) => string;
  getEffectivePool: (role: AiRoleId) => string[];
  onSceneComplete?: (sceneId: string) => void;
  onSegmentComplete?: (segmentId: string, result: TranslationSegmentResult) => void;
}

const EMPTY_PROGRESS: BatchTranslationProgress = {
  scenesTotal: 0, scenesDone: 0, scenesFailed: 0, running: false,
};

export function useTranslationBatch(opts: Opts): UseTranslationBatchReturn {
  const {
    storage, userApiKeys,
    sourceLang, targetLang, isRu,
    getModelForRole, getEffectivePool, onSceneComplete, onSegmentComplete,
  } = opts;

  const [progress, setProgress] = useState<BatchTranslationProgress>(EMPTY_PROGRESS);
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => { abortRef.current?.abort(); }, []);

  const translateSceneFull = useCallback(async (
    sceneId: string, chapterId: string,
  ): Promise<TranslationSceneResult | null> => {
    if (!storage) return null;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setProgress({
      scenesTotal: 1, scenesDone: 0, scenesFailed: 0,
      currentStage: { stage: "literal", fraction: 0, segmentIndex: 0, totalSegments: 0, message: isRu ? "Подготовка…" : "Preparing…" },
      running: true,
    });

    try {
      const result = await runTranslationPipeline({
        storage, sceneId, chapterId,
        sourceLang: sourceLang as "ru" | "en",
        targetLang: targetLang as "ru" | "en",
        userApiKeys,
        model: getModelForRole("art_translator"),
        literaryModel: getModelForRole("literary_editor"),
        critiqueModel: getModelForRole("translation_critic"),
        skipCompleted: true,
        signal: controller.signal,
        isRu,
        onProgress: (info) => setProgress(prev => ({ ...prev, currentStage: info })),
        onSegmentComplete: (segId, result) => onSegmentComplete?.(segId, result),
      });

      setProgress(prev => ({ ...prev, scenesDone: 1, running: false }));
      onSceneComplete?.(sceneId);
      toast.success(isRu
        ? `Сцена переведена (балл: ${(result.aggregateScore * 100).toFixed(0)}%)`
        : `Scene translated (score: ${(result.aggregateScore * 100).toFixed(0)}%)`);
      return result;
    } catch (err: any) {
      if (err.name === "AbortError") { setProgress(EMPTY_PROGRESS); return null; }
      console.error("[TranslationBatch] scene pipeline error:", err);
      setProgress(prev => ({ ...prev, scenesFailed: 1, running: false }));
      toast.error(isRu ? "Ошибка полного перевода сцены" : "Full scene translation failed");
      return null;
    }
  }, [storage, userApiKeys, sourceLang, targetLang, isRu, getModelForRole, onSceneComplete, onSegmentComplete]);

  const translateChapterBatch = useCallback(async (
    chapterIndex: number, chapterId: string,
  ) => {
    if (!storage) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const sceneIndex = await storage.readJSON<SceneIndexData>(paths.sceneIndex());
    if (!sceneIndex) { toast.error(isRu ? "Индекс сцен не найден" : "Scene index not found"); return; }

    const sceneIds = Object.entries(sceneIndex.entries)
      .filter(([, e]) => e.chapterIndex === chapterIndex)
      .sort(([, a], [, b]) => a.sceneNumber - b.sceneNumber)
      .map(([id]) => id);

    const scenesWithSb: string[] = [];
    for (const sid of sceneIds) {
      const sb = await storage.readJSON<LocalStoryboardData>(paths.storyboard(sid, chapterId));
      if (sb?.segments?.length) scenesWithSb.push(sid);
    }

    if (scenesWithSb.length === 0) { toast.info(isRu ? "Нет сцен с раскадровкой" : "No storyboarded scenes"); return; }

    const total = scenesWithSb.length;
    setProgress({ scenesTotal: total, scenesDone: 0, scenesFailed: 0, running: true });
    toast.info(isRu ? `Батч-перевод: ${total} сцен…` : `Batch translation: ${total} scenes…`);

    const pool = getEffectivePool("art_translator");
    const usePool = pool.length > 1 && total > 1;
    const startTime = Date.now();

    if (usePool) {
      const manager = new ModelPoolManager(pool, userApiKeys, 2);
      const tasks: PoolTask<TranslationSceneResult>[] = scenesWithSb.map(sid => ({
        id: sid,
        execute: async (modelId) => {
          if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
          return runTranslationPipeline({
            storage, sceneId: sid, chapterId,
            sourceLang: sourceLang as "ru" | "en",
            targetLang: targetLang as "ru" | "en",
            userApiKeys,
            model: modelId,
            literaryModel: getModelForRole("literary_editor"),
            critiqueModel: getModelForRole("translation_critic"),
            signal: controller.signal,
            isRu,
          });
        },
      }));

      const results = await manager.runAll(tasks, (poolProgress: PoolProgress) => {
        setProgress(prev => ({ ...prev, scenesDone: poolProgress.done, scenesFailed: poolProgress.failed, poolStats: manager.getStats() }));
      });

      const stats = manager.getStats();
      setProgress(prev => ({ ...prev, poolStats: stats, running: false }));
      await logPoolStats(stats, "translate_chapter", Date.now() - startTime);

      for (const [sid, result] of results) {
        if (!(result instanceof Error)) onSceneComplete?.(sid);
      }

      const doneCount = [...results.values()].filter(r => !(r instanceof Error)).length;
      const failCount = [...results.values()].filter(r => r instanceof Error).length;
      toast.success(isRu
        ? `Глава переведена: ${doneCount}/${total} сцен${failCount ? `, ошибок: ${failCount}` : ""}`
        : `Chapter translated: ${doneCount}/${total} scenes${failCount ? `, errors: ${failCount}` : ""}`);
    } else {
      let done = 0, failed = 0;
      for (const sid of scenesWithSb) {
        if (controller.signal.aborted) break;
        try {
          await runTranslationPipeline({
            storage, sceneId: sid, chapterId,
            sourceLang: sourceLang as "ru" | "en",
            targetLang: targetLang as "ru" | "en",
            userApiKeys,
            model: getModelForRole("art_translator"),
            literaryModel: getModelForRole("literary_editor"),
            critiqueModel: getModelForRole("translation_critic"),
            signal: controller.signal,
            isRu,
            onProgress: (info) => setProgress(prev => ({ ...prev, currentStage: info })),
          });
          done++;
          onSceneComplete?.(sid);
        } catch (err: any) {
          if (err.name === "AbortError") break;
          console.error(`[TranslationBatch] scene ${sid} failed:`, err);
          failed++;
        }
        setProgress(prev => ({ ...prev, scenesDone: done, scenesFailed: failed }));
      }
      setProgress(prev => ({ ...prev, running: false }));
      toast.success(isRu ? `Глава переведена: ${done}/${total} сцен` : `Chapter translated: ${done}/${total} scenes`);
    }
  }, [storage, userApiKeys, sourceLang, targetLang, isRu, getModelForRole, getEffectivePool, onSceneComplete]);

  return { translateSceneFull, translateChapterBatch, progress, abort };
}
