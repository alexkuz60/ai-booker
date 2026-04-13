/**
 * GpuStatusCard — GPU status display with detailed specs and benchmark.
 * Extracted from BookerProSection for maintainability.
 */
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2, XCircle, Loader2, Monitor,
  ChevronDown, ChevronUp, Gauge,
} from "lucide-react";
import type { BookerProState } from "@/hooks/useBookerPro";

interface GpuStatusCardProps {
  isRu: boolean;
  gpuChecking: boolean;
  gpuReady: boolean;
  pro: BookerProState;
  d: BookerProState["gpuDetails"];
  showDetails: boolean;
  onToggleDetails: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function GpuStatusCard({
  isRu, gpuChecking, gpuReady, pro, d, showDetails, onToggleDetails,
}: GpuStatusCardProps) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        <Monitor className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{isRu ? "Статус GPU" : "GPU Status"}</p>
          {gpuChecking ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {isRu ? "Проверка..." : "Checking..."}
            </p>
          ) : gpuReady ? (
            <p className="text-xs text-primary flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {pro.adapterInfo || "WebGPU Ready"}
            </p>
          ) : (
            <p className="text-xs text-destructive flex items-center gap-1">
              <XCircle className="h-3 w-3" />
              {pro.gpuStatus === "no-api"
                ? (isRu ? "WebGPU API недоступен" : "WebGPU API unavailable")
                : (isRu ? "GPU адаптер не найден" : "No GPU adapter")}
            </p>
          )}
        </div>
        {gpuReady && d && (
          <Button variant="ghost" size="sm" className="shrink-0 text-xs gap-1" onClick={onToggleDetails}>
            {isRu ? "Детали" : "Details"}
            {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        )}
      </div>

      {showDetails && d && (
        <div className="border-t border-border/50 px-3 pb-3 pt-2 space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <InfoRow label={isRu ? "Вендор" : "Vendor"} value={d.vendor} />
            <InfoRow label={isRu ? "Архитектура" : "Architecture"} value={d.architecture || "—"} />
            <InfoRow label={isRu ? "Устройство" : "Device"} value={d.description || d.device || "—"} />
            <InfoRow
              label={isRu ? "Режим" : "Mode"}
              value={d.isFallback ? (isRu ? "Программный (fallback)" : "Software (fallback)") : (isRu ? "Аппаратный" : "Hardware")}
              warn={d.isFallback}
            />
          </div>

          <Separator className="opacity-30" />

          {d.limits && (
            <>
              <p className="text-xs font-medium text-muted-foreground">
                {isRu ? "Вычислительные лимиты" : "Compute Limits"}
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <InfoRow label="Max Buffer Size" value={formatBytes(d.limits.maxBufferSize)} />
                <InfoRow label="Max Storage Buffer" value={formatBytes(d.limits.maxStorageBufferBindingSize)} />
                <InfoRow label="Workgroup Size (X)" value={String(d.limits.maxComputeWorkgroupSizeX)} />
                <InfoRow label="Workgroup Size (Y)" value={String(d.limits.maxComputeWorkgroupSizeY)} />
                <InfoRow label="Workgroup Size (Z)" value={String(d.limits.maxComputeWorkgroupSizeZ)} />
                <InfoRow label="Invocations/Workgroup" value={String(d.limits.maxComputeInvocationsPerWorkgroup)} />
                <InfoRow label="Workgroups/Dim" value={d.limits.maxComputeWorkgroupsPerDimension.toLocaleString()} />
                <InfoRow label="Storage Buffers/Stage" value={String(d.limits.maxStorageBuffersPerShaderStage)} />
                <InfoRow label="Bind Groups" value={String(d.limits.maxBindGroups)} />
                <InfoRow label="Max Texture 2D" value={`${d.limits.maxTextureDimension2D}×${d.limits.maxTextureDimension2D}`} />
              </div>
            </>
          )}

          <Separator className="opacity-30" />

          {d.features.length > 0 && (
            <>
              <p className="text-xs font-medium text-muted-foreground">
                {isRu ? "Поддерживаемые расширения" : "Supported Features"}
                <Badge variant="secondary" className="ml-2 text-[10px] px-1.5">{d.features.length}</Badge>
              </p>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {d.features.sort().map(f => (
                  <Badge key={f} variant="outline" className="text-[10px] px-1.5 py-0 font-mono">{f}</Badge>
                ))}
              </div>
            </>
          )}

          <Separator className="opacity-30" />

          <div className="flex items-center gap-3">
            <Button
              variant="outline" size="sm"
              onClick={pro.runBenchmark}
              disabled={pro.benchmarking}
              className="gap-1.5"
            >
              {pro.benchmarking
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Gauge className="h-3.5 w-3.5" />}
              {isRu ? "Тест производительности" : "Run Benchmark"}
            </Button>
            {pro.benchmarkResult !== null && (
              <span className="text-xs font-mono">
                {pro.benchmarkResult === -1
                  ? (isRu ? "Ошибка теста" : "Benchmark failed")
                  : (
                    <span className="flex items-center gap-1">
                      <span className="font-semibold text-primary">{pro.benchmarkResult}</span>
                      <span className="text-muted-foreground">GFLOPS</span>
                      {pro.benchmarkResult >= 50 && (
                        <Badge className="ml-1 text-[10px] bg-primary/20 text-primary border-primary/50">
                          {isRu ? "Отлично" : "Excellent"}
                        </Badge>
                      )}
                      {pro.benchmarkResult >= 10 && pro.benchmarkResult < 50 && (
                        <Badge variant="outline" className="ml-1 text-[10px]">
                          {isRu ? "Достаточно" : "Sufficient"}
                        </Badge>
                      )}
                      {pro.benchmarkResult > 0 && pro.benchmarkResult < 10 && (
                        <Badge variant="destructive" className="ml-1 text-[10px]">
                          {isRu ? "Медленно" : "Slow"}
                        </Badge>
                      )}
                    </span>
                  )}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Small helper row for GPU info display */
function InfoRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className={warn ? "text-amber-400 font-medium" : "text-foreground font-mono"}>{value}</span>
    </>
  );
}
