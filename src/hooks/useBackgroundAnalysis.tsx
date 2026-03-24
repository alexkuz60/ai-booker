/**
 * Background analysis context — runs scene segmentation in parallel
 * without blocking UI navigation. Results persist directly to OPFS.
 */

import { createContext, useContext, useCallback, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithFallback } from "@/lib/invokeWithFallback";
import { readSceneContentFromLocal } from "@/lib/localSceneContent";
import { saveStoryboardToLocal, deleteStoryboardFromLocal } from "@/lib/storyboardSync";
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

interface BackgroundAnalysisContextValue {
  /** Submit one or more scenes for background analysis */
  submit: (jobs: AnalysisJobRequest[]) => void;
  /** Cancel a specific job (if still pending) or all */
  cancelAll: () => void;
  /** Current jobs map */
  jobs: Map<string, AnalysisJob>;
  /** Whether a specific scene is being analyzed */
  isAnalyzing: (sceneId: string) => boolean;
  /** Callback token incremented when any job completes — triggers OPFS reload */
  completionToken: number;
}

const BackgroundAnalysisContext = createContext<BackgroundAnalysisContextValue | null>(null);

const MAX_CONCURRENCY = 3;

export function BackgroundAnalysisProvider({
  children,
  storage,
  getModelForRole,
  userApiKeys,
  isRu,
  onSceneSegmented,
}: {
  children: ReactNode;
  storage: ProjectStorage | null;
  getModelForRole: (role: string) => string;
  userApiKeys: Record<string, string>;
  isRu: boolean;
  onSceneSegmented?: (sceneId: string) => void;
}) {
  const [jobs, setJobs] = useState<Map<string, AnalysisJob>>(new Map());
  const [completionToken, setCompletionToken] = useState(0);
  const queueRef = useRef<AnalysisJobRequest[]>([]);
  const activeRef = useRef(0);
  const cancelledRef = useRef(false);
  // Snapshot refs for stable access in async code
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const modelRef = useRef(getModelForRole);
  modelRef.current = getModelForRole;
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

  const processNext = useCallback(async () => {
    if (cancelledRef.current) return;
    if (activeRef.current >= MAX_CONCURRENCY) return;
    const job = queueRef.current.shift();
    if (!job) return;

    activeRef.current++;
    updateJob(job.sceneId, { status: "running" });

    try {
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

      // Clear existing storyboard
      await deleteStoryboardFromLocal(s, job.sceneId, job.chapterId ?? undefined);

      // Call AI
      const { data, error } = await invokeWithFallback({
        functionName: "segment-scene",
        body: {
          scene_id: job.sceneId,
          content,
          language: isRuRef.current ? "ru" : "en",
          model: modelRef.current("screenwriter"),
        },
        userApiKeys: keysRef.current,
        isRu: isRuRef.current,
      });
      if (error) throw error;

      if (cancelledRef.current) return;

      const result = data as { segments?: Segment[] };
      const newSegments = result.segments || [];

      // Persist directly to OPFS
      await saveStoryboardToLocal(s, job.sceneId, {
        segments: newSegments,
        typeMappings: [],
        audioStatus: new Map(),
        inlineNarrationSpeaker: null,
      }, job.chapterId ?? undefined);

      // Clear content_dirty
      supabase.from("book_scenes").update({ content_dirty: false }).eq("id", job.sceneId);

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

      updateJob(job.sceneId, { status: "done" });
      onSegmentedRef.current?.(job.sceneId);
      setCompletionToken(t => t + 1);

      toast.success(
        isRuRef.current
          ? `✅ Сцена «${job.sceneTitle || job.sceneId}» проанализирована`
          : `✅ Scene "${job.sceneTitle || job.sceneId}" analyzed`
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
      // Process next in queue
      processNext();
    }
  }, [updateJob]);

  const submit = useCallback((requests: AnalysisJobRequest[]) => {
    cancelledRef.current = false;
    setJobs(prev => {
      const next = new Map(prev);
      for (const r of requests) {
        // Don't re-submit if already running
        const existing = next.get(r.sceneId);
        if (existing?.status === "running") continue;
        next.set(r.sceneId, {
          sceneId: r.sceneId,
          sceneTitle: r.sceneTitle,
          status: "pending",
        });
        queueRef.current.push(r);
      }
      return next;
    });
    // Kick off processing
    for (let i = 0; i < MAX_CONCURRENCY; i++) {
      processNext();
    }
  }, [processNext]);

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

  const isAnalyzingFn = useCallback((sceneId: string) => {
    const job = jobs.get(sceneId);
    return job?.status === "running" || job?.status === "pending";
  }, [jobs]);

  return (
    <BackgroundAnalysisContext.Provider value={{ submit, cancelAll, jobs, isAnalyzing: isAnalyzingFn, completionToken }}>
      {children}
    </BackgroundAnalysisContext.Provider>
  );
}

export function useBackgroundAnalysis() {
  const ctx = useContext(BackgroundAnalysisContext);
  if (!ctx) throw new Error("useBackgroundAnalysis must be used within BackgroundAnalysisProvider");
  return ctx;
}
