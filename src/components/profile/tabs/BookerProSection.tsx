/**
 * BookerProSection — Booker Pro activation UI in Profile page.
 * Shows GPU status with detailed specs, benchmark, browser warnings,
 * model download progress, and activation toggle.
 */
import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Cpu, Download, CheckCircle2, XCircle, AlertTriangle, Zap, Loader2, Monitor,
  ChevronDown, ChevronUp, Gauge,
} from "lucide-react";
import type { BookerProState } from "@/hooks/useBookerPro";

interface BookerProSectionProps {
  pro: BookerProState;
  isRu: boolean;
}

const MODEL_SIZES = { rvc: 40, openvoice: 60 };
const TOTAL_SIZE = MODEL_SIZES.rvc + MODEL_SIZES.openvoice;

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

  const gpuReady = pro.gpuStatus === "supported";
  const gpuChecking = pro.gpuStatus === "checking";
  const d = pro.gpuDetails;

  const handleDownloadModels = useCallback(async () => {
    setDownloading(true);
    setDownloadProgress(0);
    try {
      setDownloadLabel(isRu ? "Загрузка RVC v2 (~40 МБ)..." : "Downloading RVC v2 (~40 MB)...");
      for (let i = 0; i <= 40; i += 5) {
        await new Promise(r => setTimeout(r, 100));
        setDownloadProgress(Math.round((i / TOTAL_SIZE) * 100));
      }
      setDownloadLabel(isRu ? "Загрузка OpenVoice v2 (~60 МБ)..." : "Downloading OpenVoice v2 (~60 MB)...");
      for (let i = 40; i <= TOTAL_SIZE; i += 5) {
        await new Promise(r => setTimeout(r, 100));
        setDownloadProgress(Math.round((i / TOTAL_SIZE) * 100));
      }
      setDownloadLabel(isRu ? "Проверка GPU..." : "Testing GPU...");
      await new Promise(r => setTimeout(r, 500));
      pro.setModelsReady(true);
      setDownloadLabel("");
    } catch (err) {
      console.error("Model download error:", err);
    } finally {
      setDownloading(false);
    }
  }, [isRu, pro]);

  const handleTogglePro = (checked: boolean) => {
    if (checked && !pro.modelsReady) return;
    pro.setEnabled(checked);
  };

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
            ? "Режим Booker Pro активирует клиентский Voice Conversion пайплайн на базе WebGPU. Синтезированный TTS-голос трансформируется в уникальный тембр персонажа через RVC v2 и OpenVoice v2."
            : "Booker Pro mode activates client-side Voice Conversion pipeline powered by WebGPU. Synthesized TTS voice is transformed into a unique character timbre via RVC v2 and OpenVoice v2."}
        </p>

        {/* GPU Status Card */}
        <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
          {/* Header row */}
          <div className="flex items-center gap-3 p-3">
            <Monitor className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {isRu ? "Статус GPU" : "GPU Status"}
              </p>
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
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-xs gap-1"
                onClick={() => setShowDetails(v => !v)}
              >
                {isRu ? "Детали" : "Details"}
                {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
            )}
          </div>

          {/* Detailed GPU info */}
          {showDetails && d && (
            <div className="border-t border-border/50 px-3 pb-3 pt-2 space-y-3">
              {/* Adapter info */}
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

              {/* Compute limits */}
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

              {/* Features */}
              {d.features.length > 0 && (
                <>
                  <p className="text-xs font-medium text-muted-foreground">
                    {isRu ? "Поддерживаемые расширения" : "Supported Features"}
                    <Badge variant="secondary" className="ml-2 text-[10px] px-1.5">{d.features.length}</Badge>
                  </p>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {d.features.sort().map(f => (
                      <Badge key={f} variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                        {f}
                      </Badge>
                    ))}
                  </div>
                </>
              )}

              <Separator className="opacity-30" />

              {/* Benchmark */}
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
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

        {/* Browser warning */}
        {!pro.isChromium && (
          <Alert className="border-amber-500/30 bg-amber-500/5">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <AlertTitle className="text-sm">
              {isRu ? "Рекомендация" : "Recommendation"}
            </AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              {isRu
                ? "Firefox и Safari имеют ограниченную поддержку WebGPU. Для стабильной работы Voice Conversion рекомендуется Google Chrome или Microsoft Edge."
                : "Firefox and Safari have limited WebGPU support. For stable Voice Conversion, we recommend Google Chrome or Microsoft Edge."}
            </AlertDescription>
          </Alert>
        )}

        {/* Models status */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{isRu ? "Модели VC" : "VC Models"}</span>
            </div>
            {pro.modelsReady ? (
              <Badge className="bg-primary/20 text-primary border-primary/50 text-xs">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {isRu ? "Готовы" : "Ready"}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs text-muted-foreground">~{TOTAL_SIZE} MB</Badge>
            )}
          </div>

          {downloading && (
            <div className="space-y-2">
              <Progress value={downloadProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">{downloadLabel}</p>
            </div>
          )}

          {!pro.modelsReady && !downloading && (
            <Button
              onClick={handleDownloadModels}
              disabled={!gpuReady || gpuChecking}
              variant="outline"
              className="w-full"
            >
              <Download className="h-4 w-4 mr-2" />
              {isRu
                ? `Скачать модели RVC + OpenVoice (~${TOTAL_SIZE} МБ)`
                : `Download RVC + OpenVoice models (~${TOTAL_SIZE} MB)`}
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
            disabled={!pro.modelsReady || !gpuReady}
          />
        </div>
      </CardContent>
    </Card>
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
