/**
 * BookerProSection — Booker Pro activation UI in Profile page.
 * Shows GPU status with detailed specs, benchmark, browser warnings,
 * real ONNX model download progress, and activation toggle.
 */
import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Cpu, Download, CheckCircle2, XCircle, AlertTriangle, Zap, Loader2, Monitor,
  ChevronDown, ChevronUp, Gauge, Trash2,
} from "lucide-react";
import type { BookerProState } from "@/hooks/useBookerPro";
import { useGpuDevices } from "@/hooks/useGpuDevices";
import { MyDevicesPanel } from "@/components/profile/tabs/MyDevicesPanel";
import {
  VC_MODEL_REGISTRY, VC_PITCH_MODELS, VC_ALL_MODELS, downloadAllModels, getModelStatus,
  getTotalModelSize, clearAllModels, VC_MODEL_CACHE_EVENT,
  type ModelDownloadProgress,
} from "@/lib/vcModelCache";

interface BookerProSectionProps {
  pro: BookerProState;
  isRu: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function BookerProSection({ pro, isRu }: BookerProSectionProps) {
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadLabel, setDownloadLabel] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [modelStatuses, setModelStatuses] = useState<Record<string, boolean>>({});
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const gpuReady = pro.gpuStatus === "supported";
  const gpuChecking = pro.gpuStatus === "checking";
  const d = pro.gpuDetails;
  const totalSize = getTotalModelSize();

  const { devices, renameDevice, removeDevice } = useGpuDevices(
    pro.gpuStatus, pro.adapterInfo, pro.gpuDetails, pro.benchmarkResult,
  );

  // Check cached model status on mount and when cache changes elsewhere
  useEffect(() => {
    let cancelled = false;

    const refreshStatuses = async () => {
      const status = await getModelStatus();
      if (cancelled) return;

      setModelStatuses(status);
      const allReady = VC_MODEL_REGISTRY.every(m => status[m.id]);
      if (allReady !== pro.modelsReady) {
        pro.setModelsReady(allReady);
      }
    };

    const handleCacheChange = () => {
      void refreshStatuses();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshStatuses();
      }
    };

    void refreshStatuses();
    window.addEventListener(VC_MODEL_CACHE_EVENT, handleCacheChange);
    window.addEventListener("focus", handleCacheChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener(VC_MODEL_CACHE_EVENT, handleCacheChange);
      window.removeEventListener("focus", handleCacheChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pro.modelsReady, pro.setModelsReady]);

  const handleDownloadModels = useCallback(async () => {
    const ac = new AbortController();
    setAbortController(ac);
    setDownloading(true);
    setDownloadProgress(0);

    // Track cumulative progress across all models
    let completedBytes = 0;
    const completedModels = new Set<string>();

    const onProgress = (p: ModelDownloadProgress) => {
      if (p.phase === "done" && !completedModels.has(p.modelId)) {
        completedModels.add(p.modelId);
        completedBytes += p.bytesTotal;
      }

      const currentBytes = p.phase === "done"
        ? completedBytes
        : completedBytes + p.bytesLoaded;

      setDownloadProgress(Math.round((currentBytes / totalSize) * 100));

      if (p.phase === "downloading") {
        const pct = Math.round(p.fraction * 100);
        setDownloadLabel(
          isRu
            ? `${p.label} — ${pct}% (${formatBytes(p.bytesLoaded)})`
            : `${p.label} — ${pct}% (${formatBytes(p.bytesLoaded)})`,
        );
      } else if (p.phase === "writing") {
        setDownloadLabel(isRu ? `${p.label} — запись в кэш...` : `${p.label} — caching...`);
      } else if (p.phase === "done") {
        setModelStatuses(prev => ({ ...prev, [p.modelId]: true }));
      } else if (p.phase === "error") {
        setDownloadLabel(
          isRu
            ? `Ошибка: ${p.label} — ${p.error}`
            : `Error: ${p.label} — ${p.error}`,
        );
      }
    };

    try {
      const allOk = await downloadAllModels(onProgress, ac.signal);
      if (allOk) {
        pro.setModelsReady(true);
        setDownloadLabel("");
      }
    } catch (err) {
      console.error("Model download error:", err);
    } finally {
      setDownloading(false);
      setAbortController(null);
    }
  }, [isRu, pro, totalSize]);

  const handleCancelDownload = useCallback(() => {
    abortController?.abort();
    setDownloading(false);
    setDownloadLabel(isRu ? "Отменено" : "Cancelled");
  }, [abortController, isRu]);

  const handleClearModels = useCallback(async () => {
    await clearAllModels();
    setModelStatuses({});
    pro.setModelsReady(false);
    pro.setEnabled(false);
  }, [pro]);

  const handleTogglePro = (checked: boolean) => {
    if (checked && !pro.modelsReady) return;
    pro.setEnabled(checked);
  };

  const cachedCount = Object.values(modelStatuses).filter(Boolean).length;

  return (
    <Card className="border-primary/30 bg-card/50 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <Zap className="h-5 w-5 text-primary" />
        <CardTitle className="font-display">Booker Pro</CardTitle>
        <Badge variant="outline" className="ml-auto text-xs border-primary/50 text-primary">
          Voice Conversion
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Description */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          {isRu
            ? "Режим Booker Pro активирует клиентский Voice Conversion пайплайн на базе WebGPU + ONNX Runtime. Синтезированный TTS-голос трансформируется в уникальный тембр персонажа через ContentVec → CREPE → RVC v2."
            : "Booker Pro mode activates client-side Voice Conversion pipeline powered by WebGPU + ONNX Runtime. Synthesized TTS voice is transformed into a unique character timbre via ContentVec → CREPE → RVC v2."}
        </p>

        {/* GPU Status Card */}
        <GpuStatusCard
          isRu={isRu}
          gpuChecking={gpuChecking}
          gpuReady={gpuReady}
          pro={pro}
          d={d}
          showDetails={showDetails}
          onToggleDetails={() => setShowDetails(v => !v)}
        />

        {/* Browser compatibility note */}
        {!pro.isChromium && pro.gpuStatus !== "supported" && (
          <Alert className="border-blue-500/30 bg-blue-500/5">
            <AlertTriangle className="h-4 w-4 text-blue-500" />
            <AlertTitle className="text-sm">
              {isRu ? "Совместимость браузера" : "Browser Compatibility"}
            </AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground space-y-2">
              <p>
                {isRu
                  ? "WebGPU поддерживается в Firefox (141+) и Safari (26+). Для максимальной производительности рекомендуем Google Chrome или Microsoft Edge."
                  : "WebGPU is supported in Firefox (141+) and Safari (26+). For best performance, we recommend Google Chrome or Microsoft Edge."}
              </p>
              <p className="font-medium">
                {isRu ? "Firefox — about:config (обязательные):" : "Firefox — about:config (required):"}
              </p>
              <ul className="list-disc pl-4 space-y-0.5 font-mono text-[11px]">
                <li>dom.webgpu.enabled → true <span className="font-sans opacity-60">— {isRu ? "WebGPU для ONNX-инференса" : "WebGPU for ONNX inference"}</span></li>
                <li>gfx.webgpu.ignore-blocklist → true <span className="font-sans opacity-60">— {isRu ? "разблокировка GPU" : "unblock GPU"}</span></li>
                <li>javascript.options.wasm_simd_avx → true <span className="font-sans opacity-60">— {isRu ? "SIMD/AVX-ускорение WASM (×2-3)" : "SIMD/AVX acceleration (×2-3)"}</span></li>
                <li>javascript.options.wasm_memory_control → true <span className="font-sans opacity-60">— {isRu ? "управление памятью для моделей" : "memory control for models"}</span></li>
                <li>javascript.options.wasm_threads → true <span className="font-sans opacity-60">— {isRu ? "многопоточность ONNX Runtime" : "ONNX Runtime multi-threading"}</span></li>
              </ul>
              <p className="font-medium mt-1">
                {isRu ? "Опционально:" : "Optional:"}
              </p>
              <ul className="list-disc pl-4 space-y-0.5 font-mono text-[11px]">
                <li>gfx.webrender.all → true <span className="font-sans opacity-60">— {isRu ? "плавность UI при нагрузке" : "smoother UI under load"}</span></li>
              </ul>
              <p className="text-[11px] opacity-70">
                {isRu
                  ? "После изменений перезапустите Firefox."
                  : "Restart Firefox after changes."}
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Models status */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{isRu ? "ONNX модели" : "ONNX Models"}</span>
              <span className="text-xs text-muted-foreground">
                ({cachedCount}/{VC_MODEL_REGISTRY.length})
              </span>
            </div>
            {pro.modelsReady ? (
              <div className="flex items-center gap-2">
                <Badge className="bg-primary/20 text-primary border-primary/50 text-xs">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {isRu ? "Готовы" : "Ready"}
                </Badge>
                <Button
                  variant="ghost" size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  onClick={handleClearModels}
                  title={isRu ? "Удалить модели" : "Clear models"}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                ~{formatBytes(totalSize)}
              </Badge>
            )}
          </div>

          {/* Per-model status list */}
          <div className="space-y-1">
            {VC_MODEL_REGISTRY.map(m => (
              <div key={m.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-muted/20">
                <span className="text-muted-foreground font-mono">{m.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{formatBytes(m.sizeBytes)}</span>
                  {modelStatuses[m.id]
                    ? <CheckCircle2 className="h-3 w-3 text-primary" />
                    : <XCircle className="h-3 w-3 text-muted-foreground/50" />
                  }
                </div>
              </div>
            ))}
          </div>

          {downloading && (
            <div className="space-y-2">
              <Progress value={downloadProgress} className="h-2" />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{downloadLabel}</p>
                <Button
                  variant="ghost" size="sm"
                  className="h-6 text-xs text-destructive"
                  onClick={handleCancelDownload}
                >
                  {isRu ? "Отмена" : "Cancel"}
                </Button>
              </div>
            </div>
          )}

          {!pro.modelsReady && !downloading && (
            <Button
              onClick={handleDownloadModels}
              disabled={gpuChecking}
              variant="outline"
              className="w-full"
            >
              <Download className="h-4 w-4 mr-2" />
              {isRu
                ? `Скачать ONNX модели (~${formatBytes(totalSize)})`
                : `Download ONNX models (~${formatBytes(totalSize)})`}
            </Button>
          )}
        </div>

        {/* Activation toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
          <div>
            <p className="text-sm font-medium">
              {isRu ? "Активировать Booker Pro" : "Activate Booker Pro"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isRu
                ? "Откроет расширенные голосовые инструменты в Дикторах и Студии"
                : "Unlocks advanced voice tools in Narrators and Studio"}
            </p>
          </div>
          <Switch
            checked={pro.enabled}
            onCheckedChange={handleTogglePro}
            disabled={!pro.modelsReady}
          />
        </div>
        {/* My Devices */}
        {devices.length > 0 && (
          <MyDevicesPanel
            devices={devices}
            isRu={isRu}
            onRename={renameDevice}
            onRemove={removeDevice}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ---------- GPU Status sub-component ----------

function GpuStatusCard({
  isRu, gpuChecking, gpuReady, pro, d, showDetails, onToggleDetails,
}: {
  isRu: boolean;
  gpuChecking: boolean;
  gpuReady: boolean;
  pro: BookerProState;
  d: BookerProState["gpuDetails"];
  showDetails: boolean;
  onToggleDetails: () => void;
}) {
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
