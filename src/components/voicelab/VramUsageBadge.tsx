import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Gauge, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getVramUsageSnapshot,
  subscribeVramUsage,
  releaseAllVcSessions,
  type VramUsageSnapshot,
} from "@/lib/vcInferenceSession";

interface VramUsageBadgeProps {
  isRu: boolean;
  className?: string;
}

function formatVram(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function VramUsageBadge({ isRu, className }: VramUsageBadgeProps) {
  const [snapshot, setSnapshot] = useState<VramUsageSnapshot>(() => getVramUsageSnapshot());
  const [releasing, setReleasing] = useState(false);

  useEffect(() => subscribeVramUsage(setSnapshot), []);

  const handleRelease = useCallback(async () => {
    setReleasing(true);
    try {
      await releaseAllVcSessions();
      toast.success(isRu ? "GPU сессии освобождены" : "GPU sessions released");
    } catch (err) {
      console.error("[VramUsageBadge] Release failed:", err);
      toast.error(isRu ? "Ошибка очистки GPU" : "GPU cleanup failed");
    } finally {
      setReleasing(false);
    }
  }, [isRu]);

  return (
    <div
      className={cn("rounded-md border border-border/50 bg-muted/20 p-2", className)}
      title={snapshot.models.length > 0 ? snapshot.models.join(", ") : undefined}
    >
      <div className="flex items-start gap-2">
        <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {isRu ? "VRAM (оценка)" : "VRAM (estimate)"}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="text-xs font-medium tabular-nums text-foreground">
              ~{formatVram(snapshot.estimatedBytes)}
            </span>
            <Badge variant="outline" className="h-4 px-1 text-[9px] tabular-nums">
              {snapshot.gpuSessions}
            </Badge>
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {isRu
              ? `${snapshot.gpuSessions} GPU / ${snapshot.totalSessions} всего`
              : `${snapshot.gpuSessions} GPU / ${snapshot.totalSessions} total`}
          </p>
        </div>
      </div>
      {snapshot.totalSessions > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="mt-1.5 h-6 w-full gap-1 text-[10px]"
          onClick={handleRelease}
          disabled={releasing}
        >
          {releasing
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Trash2 className="h-3 w-3" />}
          {isRu ? "Очистка GPU" : "Release GPU"}
        </Button>
      )}
    </div>
  );
}
