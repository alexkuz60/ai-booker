/**
 * useTranslationBatch — orchestrates chapter-level batch translation
 * using ModelPoolManager for parallel scene processing through the full pipeline.
 */

import { useState, useCallback, useRef } from "react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { Segment } from "@/components/studio/storyboard/types";
import type { LocalStoryboardData } from "@/lib/storyboardSync";
import type { SceneIndexData } from "@/lib/sceneIndex";
import type { AiRoleId } from "@/config/aiRoles";
import { ModelPoolManager, logPoolStats, type PoolTask, type PoolProgress, type PoolStats } from "@/lib/modelPoolManager";
import { runTranslationPipeline, type TranslationSceneResult, type PipelineProgress } from "@/lib/translationPipeline";
import { paths } from "@/lib/projectPaths";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BatchTranslationProgress {
  /** Overall scenes done / total */
  scenesTotal: number;
  scenesDone: number;
  scenesFailed: number;
  /** Current pipeline stage for the actively visible scene */
  currentStage?: PipelineProgress;
  /** Pool worker stats (when pool mode) */
  poolStats?: PoolStats[];
  /** Is running */
  running: boolean;
}

export interface UseTranslationBatchReturn {
  /** Translate a single scene through full pipeline */
  translateSceneFull: (sceneId: string, chapterId: string) => Promise<TranslationSceneResult | null>;
  /** Translate all scenes of a chapter through pool */
  translateChapterBatch: (chapterIndex: number, chapterId: string) => Promise<void>;
  /** Current progress */
  progress: BatchTranslationProgress;
  /** Abort current operation */
  abort: () => void;
}

interface Opts {
  sourceStorage: ProjectStorage | null;
  translationStorage: ProjectStorage | null;
  userApiKeys: Record<string, string>;
  sourceLang: string;
  targetLang: string;
  isRu: boolean;
  /** Get model for a translation role */
  getModelForRole: (role: AiRoleId) => string;
  /** Get pool of models for a role (if pool enabled) */
  getEffectivePool: (role: AiRoleId) => string[];
  /** Callback after scene translated (e.g. refresh UI) */
  onSceneComplete?: (sceneId: string) => void;
}

const EMPTY_PROGRESS: BatchTranslationProgress = {
  scenesTotal: 0,
  scenesDone: 0,
  scenesFailed: 0,
  running: false,
};

export function useTranslationBatch(opts: Opts): UseTranslationBatchReturn {
  const {
    sourceStorage, translationStorage, userApiKeys,
    sourceLang, targetLang, isRu,
    getModelForRole, getEffectivePool, onSceneComplete,
  } = opts;

  const [progress, setProgress] = useState<BatchTranslationProgress>(EMPTY_PROGRESS);
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── Single scene full pipeline ──────────────────────────────────────────
  const translateSceneFull = useCallback(async (
    sceneId: string,
    chapterId: string,
  ): Promise<TranslationSceneResult | null> => {
    if (!sourceStorage || !translationStorage) return null;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setProgress({
      scenesTotal: 1,
      scenesDone: 0,
      scenesFailed: 0,
      running: true,
    });

    try {
      const result = await runTranslationPipeline({
        sourceStorage,
        targetStorage: translationStorage,
        sceneId,
        chapterId,
        sourceLang: sourceLang as "ru" | "en",
        targetLang: targetLang as "ru" | "en",
        userApiKeys,
        model: getModelForRole("art_translator"),
        literaryModel: getModelForRole("literary_editor"),
        critiqueModel: getModelForRole("translation_critic"),
        signal: controller.signal,
        isRu,
        onProgress: (info) => {
          setProgress(prev => ({ ...prev, currentStage: info }));
        },
      });

      setProgress(prev => ({ ...prev, scenesDone: 1, running: false }));
      onSceneComplete?.(sceneId);
      toast.success(isRu
        ? `Сцена переведена (балл: ${(result.aggregateScore * 100).toFixed(0)}%)`
        : `Scene translated (score: ${(result.aggregateScore * 100).toFixed(0)}%)`);
      return result;
    } catch (err: any) {
      if (err.name === "AbortError") {
        setProgress(EMPTY_PROGRESS);
        return null;
      }
      console.error("[TranslationBatch] scene pipeline error:", err);
      setProgress(prev => ({ ...prev, scenesFailed: 1, running: false }));
      toast.error(isRu ? "Ошибка полного перевода сцены" : "Full scene translation failed");
      return null;
    }
  }, [sourceStorage, translationStorage, userApiKeys, sourceLang, targetLang, isRu, getModelForRole, onSceneComplete]);

  // ── Chapter batch with pool ─────────────────────────────────────────────
  const translateChapterBatch = useCallback(async (
    chapterIndex: number,
    chapterId: string,
  ) => {
    if (!sourceStorage || !translationStorage) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Gather scenes for this chapter
    const sceneIndex = await sourceStorage.readJSON<SceneIndexData>(paths.sceneIndex());
    if (!sceneIndex) {
      toast.error(isRu ? "Индекс сцен не найден" : "Scene index not found");
      return;
    }

    const sceneIds = Object.entries(sceneIndex.entries)
      .filter(([, e]) => e.chapterIndex === chapterIndex)
      .sort(([, a], [, b]) => a.sceneNumber - b.sceneNumber)
      .map(([id]) => id);

    // Filter to scenes that have storyboards
    const scenesWithSb: string[] = [];
    for (const sid of sceneIds) {
      const sb = await sourceStorage.readJSON<LocalStoryboardData>(
        paths.storyboard(sid, chapterId),
      );
      if (sb?.segments?.length) scenesWithSb.push(sid);
    }

    if (scenesWithSb.length === 0) {
      toast.info(isRu ? "Нет сцен с раскадровкой" : "No storyboarded scenes");
      return;
    }

    const total = scenesWithSb.length;
    setProgress({ scenesTotal: total, scenesDone: 0, scenesFailed: 0, running: true });

    toast.info(isRu
      ? `Батч-перевод: ${total} сцен…`
      : `Batch translation: ${total} scenes…`);

    const pool = getEffectivePool("art_translator");
    const usePool = pool.length > 1 && total > 1;
    const startTime = Date.now();

    if (usePool) {
      // ── Pool mode: parallel scenes ──
      const manager = new ModelPoolManager(pool, userApiKeys, 2);

      const tasks: PoolTask<TranslationSceneResult>[] = scenesWithSb.map(sid => ({
        id: sid,
        execute: async (modelId) => {
          if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
          return runTranslationPipeline({
            sourceStorage,
            targetStorage: translationStorage,
            sceneId: sid,
            chapterId,
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
        setProgress(prev => ({
          ...prev,
          scenesDone: poolProgress.done,
          scenesFailed: poolProgress.failed,
          poolStats: manager.getStats(),
        }));
      });

      // Log pool stats
      const stats = manager.getStats();
      setProgress(prev => ({ ...prev, poolStats: stats, running: false }));
      await logPoolStats(stats, "translate_chapter", Date.now() - startTime);

      // Notify per-scene
      for (const [sid, result] of results) {
        if (!(result instanceof Error)) {
          onSceneComplete?.(sid);
        }
      }

      const doneCount = [...results.values()].filter(r => !(r instanceof Error)).length;
      const failCount = [...results.values()].filter(r => r instanceof Error).length;
      toast.success(isRu
        ? `Глава переведена: ${doneCount}/${total} сцен${failCount ? `, ошибок: ${failCount}` : ""}`
        : `Chapter translated: ${doneCount}/${total} scenes${failCount ? `, errors: ${failCount}` : ""}`);

    } else {
      // ── Sequential mode ──
      let done = 0;
      let failed = 0;

      for (const sid of scenesWithSb) {
        if (controller.signal.aborted) break;

        try {
          await runTranslationPipeline({
            sourceStorage,
            targetStorage: translationStorage,
            sceneId: sid,
            chapterId,
            sourceLang: sourceLang as "ru" | "en",
            targetLang: targetLang as "ru" | "en",
            userApiKeys,
            model: getModelForRole("art_translator"),
            literaryModel: getModelForRole("literary_editor"),
            critiqueModel: getModelForRole("translation_critic"),
            signal: controller.signal,
            isRu,
            onProgress: (info) => {
              setProgress(prev => ({ ...prev, currentStage: info }));
            },
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
      toast.success(isRu
        ? `Глава переведена: ${done}/${total} сцен`
        : `Chapter translated: ${done}/${total} scenes`);
    }
  }, [sourceStorage, translationStorage, userApiKeys, sourceLang, targetLang, isRu, getModelForRole, getEffectivePool, onSceneComplete]);

  return { translateSceneFull, translateChapterBatch, progress, abort };
}
