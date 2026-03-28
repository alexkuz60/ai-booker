/**
 * TranslationProgressPanel — floating progress indicator for batch translation.
 * Shows scene progress, pipeline stage, and pool worker stats.
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { BatchTranslationProgress } from "@/hooks/useTranslationBatch";
import type { PoolStats } from "@/lib/modelPoolManager";
import { cn } from "@/lib/utils";

interface Props {
  progress: BatchTranslationProgress;
  onAbort: () => void;
  isRu: boolean;
}

export function TranslationProgressPanel({ progress, onAbort, isRu }: Props) {
  if (!progress.running && progress.scenesTotal === 0) return null;

  const { scenesTotal, scenesDone, scenesFailed, currentStage, poolStats, running } = progress;
  const pct = scenesTotal > 0 ? ((scenesDone + scenesFailed) / scenesTotal) * 100 : 0;
  const isDone = !running && scenesTotal > 0;

  return (
    <div className="border rounded-lg bg-card/95 backdrop-blur-sm p-3 space-y-2 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          ) : isDone ? (
            scenesFailed > 0 ? (
              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            )
          ) : null}
          <span className="text-xs font-medium">
            {running
              ? isRu ? "Перевод…" : "Translating…"
              : isDone
                ? isRu ? "Завершено" : "Complete"
                : ""}
          </span>
        </div>
        {running && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onAbort}
            className="h-6 w-6 p-0"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Progress bar */}
      <Progress value={pct} className="h-1.5" />

      {/* Scenes counter */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>
          {isRu ? "Сцены:" : "Scenes:"} {scenesDone}/{scenesTotal}
        </span>
        {scenesFailed > 0 && (
          <Badge variant="destructive" className="text-[9px] px-1 py-0">
            {isRu ? `ошибок: ${scenesFailed}` : `errors: ${scenesFailed}`}
          </Badge>
        )}
      </div>

      {/* Current stage */}
      {currentStage && running && (
        <p className="text-[10px] text-muted-foreground truncate">
          {currentStage.message}
        </p>
      )}

      {/* Pool worker stats */}
      {poolStats && poolStats.length > 1 && (
        <div className="space-y-1 pt-1 border-t border-border/50">
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-medium">
            {isRu ? "Воркеры" : "Workers"}
          </span>
          <div className="grid gap-0.5">
            {poolStats.map((w) => (
              <div
                key={w.model}
                className={cn(
                  "flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 rounded",
                  w.disabled ? "opacity-40" : "",
                )}
              >
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  w.disabled ? "bg-destructive" : w.active > 0 ? "bg-primary animate-pulse" : "bg-emerald-500",
                )} />
                <span className="truncate flex-1 text-muted-foreground">
                  {w.model.split("/").pop()}
                </span>
                <span className="text-muted-foreground/70 tabular-nums">
                  {w.completed}✓ {w.errors > 0 ? `${w.errors}✗` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
