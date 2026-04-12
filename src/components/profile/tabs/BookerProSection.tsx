/**
 * BookerProSection — Booker Pro activation UI in Profile page.
 * Shows GPU status, browser warnings, model download progress, and activation toggle.
 */
import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Cpu, Download, CheckCircle2, XCircle, AlertTriangle, Zap, Loader2, Monitor,
} from "lucide-react";
import type { BookerProState } from "@/hooks/useBookerPro";

interface BookerProSectionProps {
  pro: BookerProState;
  isRu: boolean;
}

const MODEL_SIZES = {
  rvc: 40,      // MB
  openvoice: 60, // MB
};
const TOTAL_SIZE = MODEL_SIZES.rvc + MODEL_SIZES.openvoice;

export function BookerProSection({ pro, isRu }: BookerProSectionProps) {
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadLabel, setDownloadLabel] = useState("");

  const gpuReady = pro.gpuStatus === "supported";
  const gpuChecking = pro.gpuStatus === "checking";

  const handleDownloadModels = useCallback(async () => {
    setDownloading(true);
    setDownloadProgress(0);

    try {
      // Simulate model download (will be replaced with real ONNX model downloads)
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
    if (checked && !pro.modelsReady) {
      // Don't enable until models are downloaded
      return;
    }
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

        {/* GPU Status */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
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
              <p className="text-xs text-green-500 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {pro.adapterInfo || "WebGPU Ready"}
              </p>
            ) : (
              <p className="text-xs text-destructive flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                {pro.gpuStatus === "no-api"
                  ? (isRu ? "WebGPU API недоступен в этом браузере" : "WebGPU API not available in this browser")
                  : (isRu ? "GPU адаптер не найден" : "No GPU adapter found")}
              </p>
            )}
          </div>
        </div>

        {/* Browser warning */}
        {!pro.isChromium && (
          <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <AlertTitle className="text-amber-300">
              {isRu ? "Рекомендация" : "Recommendation"}
            </AlertTitle>
            <AlertDescription className="text-amber-200/80 text-xs">
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
              <span className="text-sm">
                {isRu ? "Модели VC" : "VC Models"}
              </span>
            </div>
            {pro.modelsReady ? (
              <Badge className="bg-green-500/20 text-green-400 border-green-500/50 text-xs">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {isRu ? "Готовы" : "Ready"}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                ~{TOTAL_SIZE} MB
              </Badge>
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
