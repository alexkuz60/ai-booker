import { useState, useCallback, useEffect, useRef } from "react";
import { Loader2, CheckCircle2, XCircle, Sparkles, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAiRoles } from "@/hooks/useAiRoles";
import { toast } from "sonner";

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
}

interface BatchSegmentationPanelProps {
  isRu: boolean;
  sceneIds: string[];
  scenes: SceneInfo[];
  bookId: string | null;
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
  concurrency = 3,
  onComplete,
  onSceneSegmented,
  onClose,
}: BatchSegmentationPanelProps) {
  const { getModelForRole } = useAiRoles();
  const [jobs, setJobs] = useState<SceneJob[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef(false);
  const startedRef = useRef(false);

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

  const processScene = useCallback(async (job: SceneJob): Promise<void> => {
    if (abortRef.current) return;
    const { scene } = job;

    updateJob(scene.id, { status: "analyzing" });

    try {
      const { data, error } = await supabase.functions.invoke("segment-scene", {
        body: {
          scene_id: scene.id,
          language: isRu ? "ru" : "en",
          model: getModelForRole("screenwriter"),
        },
      });
      if (error) throw error;
      const count = data?.segments?.length ?? 0;
      updateJob(scene.id, { status: "done", segmentCount: count });
      onSceneSegmented?.(scene.id);
    } catch (err: any) {
      const msg = err?.message || String(err);
      updateJob(scene.id, { status: "error", error: msg });
    }
  }, [isRu, getModelForRole, updateJob, onSceneSegmented]);

  const runBatch = useCallback(async () => {
    if (running) return;
    setRunning(true);
    abortRef.current = false;

    const queue = [...jobs.filter(j => j.status === "pending" || j.status === "error")];
    let idx = 0;

    const worker = async () => {
      while (idx < queue.length && !abortRef.current) {
        const job = queue[idx++];
        if (!job) break;
        await processScene(job);
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
    await Promise.all(workers);

    setRunning(false);
    if (!abortRef.current) {
      onComplete?.();
      toast.success(isRu ? "Пакетный анализ завершён" : "Batch analysis complete");
    }
  }, [jobs, running, concurrency, processScene, onComplete, isRu]);

  const handleStop = useCallback(() => {
    abortRef.current = true;
  }, []);

  // Auto-start on mount
  useEffect(() => {
    if (jobs.length > 0 && !startedRef.current) {
      startedRef.current = true;
      // Small delay to allow render
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
            {isRu
              ? `Параллельность: ${concurrency} потока`
              : `Concurrency: ${concurrency} workers`}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono">
            {Math.round(progressPct)}%
          </span>
        </div>
      </div>

      {/* Scene list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-2 space-y-1">
          {jobs.map((job) => (
            <div
              key={job.scene.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-body transition-colors",
                job.status === "analyzing" || job.status === "loading"
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
