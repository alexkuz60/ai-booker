/**
 * Background analysis context — runs scene segmentation in parallel
 * without blocking UI navigation. Results persist directly to OPFS.
 *
 * Supports two modes:
 * - Queue mode (no pool): up to MAX_CONCURRENCY concurrent jobs via invokeWithFallback
 * - Pool mode: ModelPoolManager with round-robin across multiple models, retry on 429/402
 */

import { createContext, useContext, useCallback, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithFallback, enrichBodyWithKeys, getMissingExplicitProviderError } from "@/lib/invokeWithFallback";
import { fnv1a32 } from "@/lib/contentHash";
import { readSceneContentFromLocal } from "@/lib/localSceneContent";
import { saveStoryboardToLocal, deleteStoryboardFromLocal } from "@/lib/storyboardSync";
import { ModelPoolManager, type PoolTask, type PoolStats, logPoolStats } from "@/lib/modelPoolManager";
import type { Segment } from "@/components/studio/storyboard/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import { toast } from "sonner";

export type AnalysisJobStatus = "pending" | "running" | "done" | "error";

export interface AnalysisJob {
  sceneId: string;
  sceneTitle?: string;
  status: AnalysisJobStatus;
  error?: string;
}

export interface AnalysisJobRequest {
  sceneId: string;
  sceneTitle?: string;
  sceneNumber?: number | null;
  chapterId?: string | null;
}

export interface AnalysisSummary {
  total: number;
  done: number;
  errors: number;
  running: number;
  pending: number;
}

interface BackgroundAnalysisContextValue {
  /** Submit one or more scenes for background analysis */
  submit: (jobs: AnalysisJobRequest[]) => void;
  /** Cancel all pending/running jobs */
  cancelAll: () => void;
  /** Current jobs map */
  jobs: Map<string, AnalysisJob>;
  /** Whether a specific scene is being analyzed */
  isAnalyzing: (sceneId: string) => boolean;
  /** Callback token incremented when any job completes — triggers OPFS reload */
  completionToken: number;
  /** Pool stats (empty when not in pool mode) */
  poolStats: PoolStats[];
  /** Summary counters */
  summary: AnalysisSummary;
  /** Whether pool mode is active for current/last batch */
  isPoolMode: boolean;
}

const BackgroundAnalysisContext = createContext<BackgroundAnalysisContextValue | null>(null);

const MAX_CONCURRENCY = 3;

export function BackgroundAnalysisProvider({
  children,
  storage,
  getModelForRole,
  getEffectivePool,
  isPoolEnabled,
  userApiKeys,
  isRu,
  onSceneSegmented,
}: {
  children: ReactNode;
  storage: ProjectStorage | null;
  getModelForRole: (role: string) => string;
  getEffectivePool: (role: string) => string[];
  isPoolEnabled: (role: string) => boolean;
  userApiKeys: Record<string, string>;
  isRu: boolean;
  onSceneSegmented?: (sceneId: string) => void;
}) {
  const [jobs, setJobs] = useState<Map<string, AnalysisJob>>(new Map());
  const [completionToken, setCompletionToken] = useState(0);
  const [poolStats, setPoolStats] = useState<PoolStats[]>([]);
  const [isPoolMode, setIsPoolMode] = useState(false);
  const queueRef = useRef<AnalysisJobRequest[]>([]);
  const activeRef = useRef(0);
  const cancelledRef = useRef(false);
  const poolRunningRef = useRef(false);

  // Snapshot refs for stable access in async code
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const modelRef = useRef(getModelForRole);
  modelRef.current = getModelForRole;
  const poolRef = useRef(getEffectivePool);
  poolRef.current = getEffectivePool;
  const isPoolEnabledRef = useRef(isPoolEnabled);
  isPoolEnabledRef.current = isPoolEnabled;
  const keysRef = useRef(userApiKeys);
  keysRef.current = userApiKeys;
  const isRuRef = useRef(isRu);
  isRuRef.current = isRu;
  const onSegmentedRef = useRef(onSceneSegmented);
  onSegmentedRef.current = onSceneSegmented;

  const updateJob = useCallback((sceneId: string, patch: Partial<AnalysisJob>) => {
    setJobs(prev => {
      const next = new Map(prev);
      const existing = next.get(sceneId);
      if (existing) {
        next.set(sceneId, { ...existing, ...patch });
      }
      return next;
    });
  }, []);

  // ── Shared scene processing logic ─────────────────────────────────────

  const processScene = useCallback(async (
    job: AnalysisJobRequest,
    modelId: string,
    useEnrichBody: boolean,
  ): Promise<Segment[]> => {
    const s = storageRef.current;
    if (!s) throw new Error("Storage not available");

    // Read scene content from OPFS
    const localScene = await readSceneContentFromLocal(s, {
      sceneId: job.sceneId,
      chapterId: job.chapterId,
      sceneNumber: job.sceneNumber,
      title: job.sceneTitle,
    });
    const content = localScene?.content ?? null;
    if (!content) throw new Error(isRuRef.current ? "Текст сцены не найден" : "Scene text not found");

    // Diagnostic: log content identity to detect "same content for different scenes" bug
    console.info(`[BgAnalysis] 🔍 sceneId=${job.sceneId} contentLen=${content.length} first80="${content.slice(0, 80).replace(/\n/g, "↵")}"`);

    if (content.trim().length < 50) {
      throw new Error(
        isRuRef.current
          ? `Текст слишком короткий (${content.trim().length} зн.)`
          : `Text too short (${content.trim().length} chars)`,
      );
    }

    // Clear existing storyboard
    await deleteStoryboardFromLocal(s, job.sceneId, job.chapterId ?? undefined);

    // Call AI
    let data: any;
    let error: any;

    if (useEnrichBody) {
      // Pool mode: use enrichBodyWithKeys + direct invoke
      const baseBody: Record<string, unknown> = {
        scene_id: job.sceneId,
        content,
        language: isRuRef.current ? "ru" : "en",
        model: modelId,
      };
      const missingProviderError = getMissingExplicitProviderError(modelId, baseBody, keysRef.current, isRuRef.current);
      if (missingProviderError) throw missingProviderError;
      const enrichedBody = enrichBodyWithKeys(baseBody, modelId, keysRef.current);
      const result = await supabase.functions.invoke("segment-scene", { body: enrichedBody });
      data = result.data;
      error = result.error;
    } else {
      // Queue mode: use invokeWithFallback
      const result = await invokeWithFallback({
        functionName: "segment-scene",
        body: {
          scene_id: job.sceneId,
          content,
          language: isRuRef.current ? "ru" : "en",
          model: modelId,
        },
        userApiKeys: keysRef.current,
        isRu: isRuRef.current,
      });
      data = result.data;
      error = result.error;
    }

    if (error) throw error;

    const result = data as { segments?: Segment[]; coverage?: { lengthPct: number; sourcePct: number; usedFallback: boolean } };
    const newSegments = result.segments || [];
    const totalPhrases = newSegments.reduce((a, s) => a + (s.phrases?.length || 0), 0);
    console.info(`[BgAnalysis] ✅ sceneId=${job.sceneId} → ${newSegments.length} segments, ${totalPhrases} phrases, fallback=${result.coverage?.usedFallback}, coverage: len=${result.coverage?.lengthPct}% src=${result.coverage?.sourcePct}%`);

    // Warn user if server used fallback segmentation (AI truncated)
    if (result.coverage?.usedFallback) {
      console.warn(`[BgAnalysis] Server used fallback segmentation for scene ${job.sceneId}: len=${result.coverage.lengthPct}% source=${result.coverage.sourcePct}%`);
      const { toast } = await import("sonner");
      toast.warning(
        isRuRef.current
          ? `Сцена "${job.sceneTitle || job.sceneId}": модель обрезала результат (${result.coverage.sourcePct}%). Использована грубая нарезка. Попробуйте другую модель.`
          : `Scene "${job.sceneTitle || job.sceneId}": model truncated output (${result.coverage.sourcePct}%). Fallback segmentation used. Try a different model.`
      );
    }

    // Client-side coverage verification (DNI-1: author text integrity)
    if (newSegments.length > 0 && !result.coverage?.usedFallback) {
      const segmentTextLen = newSegments.reduce((sum, s) =>
        sum + s.phrases.reduce((ps, p) => ps + (p.text?.length || 0), 0), 0);
      const clientCoverage = content.length > 0 ? segmentTextLen / content.length : 0;

      if (clientCoverage < 0.5) {
        const pct = Math.round(clientCoverage * 100);
        console.error(`[BgAnalysis] Segment coverage too low: ${pct}% (${segmentTextLen}/${content.length} chars), rejecting`);
        throw new Error(
          isRuRef.current
            ? `Раскадровка покрывает только ${pct}% текста — ИИ обрезал результат. Попробуйте другую модель.`
            : `Segmentation covers only ${pct}% of text — AI truncated output. Try a different model.`
        );
      }

      if (clientCoverage < 0.75) {
        const pct = Math.round(clientCoverage * 100);
        console.warn(`[BgAnalysis] Low segment coverage: ${pct}% for scene ${job.sceneId}`);
      }
    }

    // Persist directly to OPFS with contentHash for dirty detection
    const currentContentHash = fnv1a32(content);
    await saveStoryboardToLocal(s, job.sceneId, {
      segments: newSegments,
      typeMappings: [],
      audioStatus: new Map(),
      inlineNarrationSpeaker: null,
      contentHash: currentContentHash,
    }, job.chapterId ?? undefined);

    // Sync scene index contentHash to match storyboard — prevents false dirty banners
    // (e.g. after Parser re-extract with slightly different whitespace)
    const { getCachedSceneIndex, writeSceneIndex } = await import("@/lib/sceneIndex");
    const cachedIdx = getCachedSceneIndex();
    if (cachedIdx?.entries[job.sceneId] && cachedIdx.entries[job.sceneId].contentHash !== currentContentHash) {
      cachedIdx.entries[job.sceneId].contentHash = currentContentHash;
      await writeSceneIndex(s, cachedIdx);
    }

    // Clear content_dirty in DB (best-effort, not source of truth)
    await supabase.from("book_scenes").update({ content_dirty: false }).eq("id", job.sceneId);

    // Extract speakers to local characters
    if (newSegments.length > 0) {
      try {
        const { readCharacterIndex, upsertSpeakersFromSegments } = await import("@/lib/localCharacters");
        const currentIndex = await readCharacterIndex(s);
        await upsertSpeakersFromSegments(s, job.sceneId, newSegments, currentIndex);
      } catch (e) {
        console.warn("[BgAnalysis] Failed to upsert speakers:", e);
      }
    }

    return newSegments;
  }, []);

  // ── Queue mode (no pool) ──────────────────────────────────────────────

  const processNext = useCallback(async () => {
    if (cancelledRef.current) return;
    if (activeRef.current >= MAX_CONCURRENCY) return;
    const job = queueRef.current.shift();
    if (!job) return;

    activeRef.current++;
    updateJob(job.sceneId, { status: "running" });

    try {
      const model = modelRef.current("screenwriter");
      const newSegments = await processScene(job, model, false);

      if (cancelledRef.current) return;

      updateJob(job.sceneId, { status: "done" });
      onSegmentedRef.current?.(job.sceneId);
      setCompletionToken(t => t + 1);

      toast.success(
        isRuRef.current
          ? `✅ Сцена «${job.sceneTitle || job.sceneId}» — ${newSegments.length} блоков`
          : `✅ Scene "${job.sceneTitle || job.sceneId}" — ${newSegments.length} segments`
      );
    } catch (err: any) {
      if (cancelledRef.current) return;
      const msg = err?.message || String(err);
      console.error(`[BgAnalysis] Scene ${job.sceneId} failed:`, msg);
      updateJob(job.sceneId, { status: "error", error: msg });
      toast.error(
        isRuRef.current
          ? `❌ Сцена «${job.sceneTitle || job.sceneId}»: ${msg}`
          : `❌ Scene "${job.sceneTitle || job.sceneId}": ${msg}`
      );
    } finally {
      activeRef.current--;
      processNext();
    }
  }, [updateJob, processScene]);

  // ── Pool mode ─────────────────────────────────────────────────────────

  const runPoolBatch = useCallback(async (requests: AnalysisJobRequest[]) => {
    const effectivePool = poolRef.current("screenwriter");
    const manager = new ModelPoolManager(effectivePool, keysRef.current, 2);
    poolRunningRef.current = true;
    setPoolStats([]);

    const tasks: PoolTask<{ sceneId: string; count: number }>[] = requests.map(job => ({
      id: job.sceneId,
      execute: async (modelId: string, _apiKey: string | null) => {
        if (cancelledRef.current) throw new Error("Aborted");
        updateJob(job.sceneId, { status: "running" });

        const newSegments = await processScene(job, modelId, true);

        if (cancelledRef.current) throw new Error("Aborted");

        // Immediate per-task completion for UI reactivity
        updateJob(job.sceneId, { status: "done" });
        onSegmentedRef.current?.(job.sceneId);
        setCompletionToken(t => t + 1);

        toast.success(
          isRuRef.current
            ? `✅ Сцена «${job.sceneTitle || job.sceneId}» — ${newSegments.length} блоков`
            : `✅ Scene "${job.sceneTitle || job.sceneId}" — ${newSegments.length} segments`
        );

        return { sceneId: job.sceneId, count: newSegments.length };
      },
    }));

    const poolStartTime = Date.now();

    const results = await manager.runAll(tasks, () => {
      setPoolStats(manager.getStats());
    });

    // Process errors (done cases already handled inside execute)
    for (const [sceneId, result] of results) {
      if (result instanceof Error) {
        const msg = result.message;
        if (msg === "Aborted") continue;
        console.error(`[BgAnalysis:Pool] Scene ${sceneId} failed:`, msg);
        updateJob(sceneId, { status: "error", error: msg });
        const job = requests.find(r => r.sceneId === sceneId);
        toast.error(
          isRuRef.current
            ? `❌ Сцена «${job?.sceneTitle || sceneId}»: ${msg}`
            : `❌ Scene "${job?.sceneTitle || sceneId}": ${msg}`
        );
      }
    }

    const finalStats = manager.getStats();
    setPoolStats(finalStats);
    logPoolStats(finalStats, "segment_scene", Date.now() - poolStartTime);
    poolRunningRef.current = false;

    // Summary toast
    const doneCount = [...results.values()].filter(r => !(r instanceof Error)).length;
    const errCount = [...results.values()].filter(r => r instanceof Error && r.message !== "Aborted").length;
    if (doneCount > 0 || errCount > 0) {
      toast.info(
        isRuRef.current
          ? `Пакетный анализ: ${doneCount} готово${errCount > 0 ? `, ${errCount} ошибок` : ""}`
          : `Batch analysis: ${doneCount} done${errCount > 0 ? `, ${errCount} errors` : ""}`
      );
    }
  }, [updateJob, processScene]);

  // ── Submit ────────────────────────────────────────────────────────────

  const submit = useCallback((requests: AnalysisJobRequest[]) => {
    cancelledRef.current = false;

    // Register jobs in state
    const newRequests: AnalysisJobRequest[] = [];
    setJobs(prev => {
      const next = new Map(prev);
      for (const r of requests) {
        const existing = next.get(r.sceneId);
        if (existing?.status === "running") continue;
        next.set(r.sceneId, {
          sceneId: r.sceneId,
          sceneTitle: r.sceneTitle,
          status: "pending",
        });
        newRequests.push(r);
      }
      return next;
    });

    if (newRequests.length === 0) return;

    const usePool = isPoolEnabledRef.current("screenwriter") && poolRef.current("screenwriter").length > 1;

    if (usePool && newRequests.length > 1 && !poolRunningRef.current) {
      // Pool mode for batch (2+ scenes)
      setIsPoolMode(true);
      runPoolBatch(newRequests);
    } else {
      // Queue mode: single scene or pool already running or no pool
      setIsPoolMode(false);
      queueRef.current.push(...newRequests);
      for (let i = 0; i < MAX_CONCURRENCY; i++) {
        processNext();
      }
    }
  }, [runPoolBatch, processNext]);

  // ── Cancel ────────────────────────────────────────────────────────────

  const cancelAll = useCallback(() => {
    cancelledRef.current = true;
    queueRef.current = [];
    setJobs(prev => {
      const next = new Map(prev);
      for (const [id, job] of next) {
        if (job.status === "pending") next.delete(id);
      }
      return next;
    });
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────

  const isAnalyzingFn = useCallback((sceneId: string) => {
    const job = jobs.get(sceneId);
    return job?.status === "running" || job?.status === "pending";
  }, [jobs]);

  const summary: AnalysisSummary = (() => {
    let total = 0, done = 0, errors = 0, running = 0, pending = 0;
    for (const job of jobs.values()) {
      total++;
      if (job.status === "done") done++;
      else if (job.status === "error") errors++;
      else if (job.status === "running") running++;
      else if (job.status === "pending") pending++;
    }
    return { total, done, errors, running, pending };
  })();

  return (
    <BackgroundAnalysisContext.Provider
      value={{
        submit,
        cancelAll,
        jobs,
        isAnalyzing: isAnalyzingFn,
        completionToken,
        poolStats,
        summary,
        isPoolMode,
      }}
    >
      {children}
    </BackgroundAnalysisContext.Provider>
  );
}

export function useBackgroundAnalysis() {
  const ctx = useContext(BackgroundAnalysisContext);
  if (!ctx) throw new Error("useBackgroundAnalysis must be used within BackgroundAnalysisProvider");
  return ctx;
}
