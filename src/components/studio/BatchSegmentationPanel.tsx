import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Loader2, CheckCircle2, XCircle, Sparkles, Play, Square, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAiRoles } from "@/hooks/useAiRoles";
import { ModelPoolManager, type PoolTask, type PoolStats, logPoolStats } from "@/lib/modelPoolManager";
import { enrichBodyWithKeys } from "@/lib/invokeWithFallback";
import { toast } from "sonner";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { readSceneContentFromLocal } from "@/lib/localSceneContent";

interface SceneInfo {
  id: string;
  title: string;
  sceneNumber: number;
  content?: string | null;
}

type SceneStatus = "pending" | "analyzing" | "done" | "error" | "skipped";

interface SceneJob {
  scene: SceneInfo;
  status: SceneStatus;
  error?: string;
  segmentCount?: number;
  /** Which model processed this scene (pool mode) */
  modelUsed?: string;
}

interface BatchSegmentationPanelProps {
  isRu: boolean;
  sceneIds: string[];
  scenes: SceneInfo[];
  bookId: string | null;
  /** User API keys for pool model resolution */
  userApiKeys?: Record<string, string>;
  concurrency?: number;
  onComplete?: () => void;
  onSceneSegmented?: (sceneId: string) => void;
  onClose?: () => void;
}

export function BatchSegmentationPanel({
  isRu,
  sceneIds,
  scenes,
  bookId,
  userApiKeys = {},
  concurrency = 3,
  onComplete,
  onSceneSegmented,
  onClose,
}: BatchSegmentationPanelProps) {
  const { getModelForRole, getEffectivePool, isPoolEnabled } = useAiRoles(userApiKeys);
  const { storage } = useProjectStorageContext();
  const [jobs, setJobs] = useState<SceneJob[]>([]);
  const [running, setRunning] = useState(false);
  const [poolStats, setPoolStats] = useState<PoolStats[]>([]);
  const abortRef = useRef(false);
  const startedRef = useRef(false);
  const managerRef = useRef<ModelPoolManager | null>(null);

  const poolActive = isPoolEnabled("screenwriter");
  const effectivePool = useMemo(() => getEffectivePool("screenwriter"), [getEffectivePool]);

  // Initialize jobs
  useEffect(() => {
    const ordered = sceneIds
      .map(id => scenes.find(s => s.id === id))
      .filter(Boolean) as SceneInfo[];
    setJobs(ordered.map(scene => ({ scene, status: "pending" })));
  }, [sceneIds.join(",")]);

  const updateJob = useCallback((sceneId: string, update: Partial<SceneJob>) => {
    setJobs(prev => prev.map(j => j.scene.id === sceneId ? { ...j, ...update } : j));
  }, []);

  // OPFS-ONLY: always read authoritative content from local project storage.
  // Never trust in-memory scene.content/session state. Never fall back to DB.
  const resolveFreshSceneContent = useCallback(async (scene: SceneInfo) => {
    if (!storage) {
      throw new Error(isRu ? "Локальный проект не открыт" : "Local project is not open");
    }

    const localScene = await readSceneContentFromLocal(storage, scene.id);
    if (!localScene?.content) {
      throw new Error(
        isRu
          ? `Сцена #${scene.sceneNumber} не найдена в локальном проекте`
          : `Scene #${scene.sceneNumber} was not found in the local project`,
      );
    }

    return localScene.content;
  }, [storage, isRu]);

  // ── Pool-based batch ──────────────────────────────────────────────────

  const runPoolBatch = useCallback(async (pendingJobs: SceneJob[]) => {
    const manager = new ModelPoolManager(effectivePool, userApiKeys, 2);
    managerRef.current = manager;

    const tasks: PoolTask<{ sceneId: string; count: number }>[] = pendingJobs.map(job => ({
      id: job.scene.id,
      execute: async (modelId: string, _apiKey: string | null) => {
        if (abortRef.current) throw new Error("Aborted");
        updateJob(job.scene.id, { status: "analyzing" });

        const freshContent = await resolveFreshSceneContent(job.scene);

        const baseBody: Record<string, unknown> = {
            scene_id: job.scene.id,
            content: freshContent,
            language: isRu ? "ru" : "en",
            model: modelId,
          };
        const enrichedBody = enrichBodyWithKeys(baseBody, modelId, userApiKeys);
        const { data, error } = await supabase.functions.invoke("segment-scene", {
          body: enrichedBody,
        });
        if (error) throw error;
        const count = data?.segments?.length ?? 0;
        return { sceneId: job.scene.id, count };
      },
    }));

    const poolStartTime = Date.now();
    const results = await manager.runAll(tasks, (progress) => {
      setPoolStats(manager.getStats());
    });

    // Apply results
    for (const [sceneId, result] of results) {
      if (result instanceof Error) {
        updateJob(sceneId, { status: "error", error: result.message });
      } else {
        updateJob(sceneId, {
          status: "done",
          segmentCount: result.count,
        });
        onSceneSegmented?.(sceneId);
      }
    }

    const finalStats = manager.getStats();
    setPoolStats(finalStats);
    logPoolStats(finalStats, "segment_scene", Date.now() - poolStartTime);
    managerRef.current = null;
  }, [effectivePool, userApiKeys, isRu, updateJob, onSceneSegmented, resolveFreshSceneContent]);

  // ── Classic fixed-concurrency batch ───────────────────────────────────

  const runClassicBatch = useCallback(async (pendingJobs: SceneJob[]) => {
    const model = getModelForRole("screenwriter");
    const queue = [...pendingJobs];
    let idx = 0;

    const worker = async () => {
      while (idx < queue.length && !abortRef.current) {
        const job = queue[idx++];
        if (!job) break;
        updateJob(job.scene.id, { status: "analyzing" });
        try {
          const freshContent = await resolveFreshSceneContent(job.scene);
          const baseBody: Record<string, unknown> = {
              scene_id: job.scene.id,
              content: freshContent,
              language: isRu ? "ru" : "en",
              model,
            };
          const enrichedBody = enrichBodyWithKeys(baseBody, model, userApiKeys);
          const { data, error } = await supabase.functions.invoke("segment-scene", {
            body: enrichedBody,
          });
          if (error) throw error;
          const count = data?.segments?.length ?? 0;
          updateJob(job.scene.id, { status: "done", segmentCount: count });
          onSceneSegmented?.(job.scene.id);
        } catch (err: any) {
          updateJob(job.scene.id, { status: "error", error: err?.message || String(err) });
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, queue.length) },
      () => worker(),
    );
    await Promise.all(workers);
  }, [getModelForRole, concurrency, isRu, updateJob, onSceneSegmented, resolveFreshSceneContent, userApiKeys]);

  // ── Orchestrator ──────────────────────────────────────────────────────

  const runBatch = useCallback(async () => {
    if (running) return;
    setRunning(true);
    abortRef.current = false;
    setPoolStats([]);

    const pending = jobs.filter(j => j.status === "pending" || j.status === "error");

    if (poolActive && effectivePool.length > 1) {
      await runPoolBatch(pending);
    } else {
      await runClassicBatch(pending);
    }

    setRunning(false);
    if (!abortRef.current) {
      onComplete?.();
      toast.success(isRu ? "Пакетный анализ завершён" : "Batch analysis complete");
    }
  }, [jobs, running, poolActive, effectivePool, runPoolBatch, runClassicBatch, onComplete, isRu]);

  const handleStop = useCallback(() => {
    abortRef.current = true;
  }, []);

  // Auto-start on mount
  useEffect(() => {
    if (jobs.length > 0 && !startedRef.current) {
      startedRef.current = true;
      setTimeout(() => runBatch(), 100);
    }
  }, [jobs.length]);

  const doneCount = jobs.filter(j => j.status === "done").length;
  const errorCount = jobs.filter(j => j.status === "error").length;
  const skippedCount = jobs.filter(j => j.status === "skipped").length;
  const totalCount = jobs.length;
  const progressPct = totalCount > 0 ? ((doneCount + errorCount + skippedCount) / totalCount) * 100 : 0;

  const statusIcon = (status: SceneStatus) => {
    switch (status) {
      case "analyzing":
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />;
      case "done":
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
      case "error":
        return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
      case "skipped":
        return <XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
      default:
        return <span className="h-3.5 w-3.5 rounded-full border border-border shrink-0" />;
    }
  };

  const statusLabel = (status: SceneStatus) => {
    const labels: Record<SceneStatus, [string, string]> = {
      pending: ["Ожидание", "Pending"],
      analyzing: ["Анализ…", "Analyzing…"],
      done: ["Готово", "Done"],
      error: ["Ошибка", "Error"],
      skipped: ["Пропущено", "Skipped"],
    };
    return isRu ? labels[status][0] : labels[status][1];
  };

  const totalWorkers = poolActive ? effectivePool.length * 2 : concurrency;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium font-body">
            {isRu ? "Пакетный анализ" : "Batch Analysis"}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            {doneCount}/{totalCount}
            {errorCount > 0 && <span className="text-destructive ml-1">({errorCount} err)</span>}
          </span>
          {poolActive && (
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 gap-0.5">
              <Layers className="h-2.5 w-2.5" />
              {isRu ? `${totalWorkers} потоков` : `${totalWorkers} workers`}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {running ? (
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleStop}>
              <Square className="h-3 w-3" />
              {isRu ? "Стоп" : "Stop"}
            </Button>
          ) : (
            <>
              {(errorCount > 0 || jobs.some(j => j.status === "pending")) && (
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={runBatch}>
                  <Play className="h-3 w-3" />
                  {isRu ? "Продолжить" : "Resume"}
                </Button>
              )}
              {onClose && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
                  {isRu ? "Закрыть" : "Close"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 py-2 shrink-0">
        <Progress value={progressPct} className="h-2" />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[11px] text-muted-foreground font-body">
            {poolActive
              ? (isRu
                ? `Пул: ${effectivePool.length} моделей × 2 потока`
                : `Pool: ${effectivePool.length} models × 2 workers`)
              : (isRu
                ? `Параллельность: ${concurrency} потока`
                : `Concurrency: ${concurrency} workers`)}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono">
            {Math.round(progressPct)}%
          </span>
        </div>
      </div>

      {/* Pool stats — shown only when pool is active and running/completed */}
      {poolActive && poolStats.length > 0 && (
        <div className="px-4 py-1.5 border-b border-border shrink-0">
          <div className="flex flex-wrap gap-2">
            {poolStats.map((s) => (
              <div
                key={s.model}
                className={cn(
                  "text-[10px] font-mono px-2 py-0.5 rounded-md border",
                  s.disabled
                    ? "border-destructive/30 text-destructive bg-destructive/5"
                    : s.active > 0
                      ? "border-primary/30 text-primary bg-primary/5"
                      : "border-border text-muted-foreground bg-card/50",
                )}
              >
                <span className="truncate max-w-[120px] inline-block align-middle">
                  {s.model.split("/").pop()}
                </span>
                <span className="ml-1.5">
                  ✓{s.completed}
                  {s.errors > 0 && <span className="text-destructive ml-0.5">✗{s.errors}</span>}
                  {s.active > 0 && <span className="text-primary ml-0.5">⟳{s.active}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scene list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-2 space-y-1">
          {jobs.map((job) => (
            <div
              key={job.scene.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-body transition-colors",
                job.status === "analyzing"
                  ? "bg-primary/5 border border-primary/20"
                  : job.status === "done"
                    ? "bg-emerald-500/5"
                    : job.status === "error"
                      ? "bg-destructive/5"
                      : "bg-card/50"
              )}
            >
              {statusIcon(job.status)}
              <span className="flex-1 truncate">
                <span className="text-xs text-muted-foreground mr-1.5">#{job.scene.sceneNumber}</span>
                {job.scene.title}
              </span>
              <span className="text-[11px] text-muted-foreground shrink-0">
                {job.status === "done" && job.segmentCount !== undefined
                  ? `${job.segmentCount} ${isRu ? "сегм." : "seg."}`
                  : statusLabel(job.status)}
              </span>
              {job.status === "error" && job.error && (
                <span className="text-[10px] text-destructive truncate max-w-[150px]" title={job.error}>
                  {job.error.slice(0, 50)}
                </span>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
