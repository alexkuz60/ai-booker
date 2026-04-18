/**
 * OmniVoiceResultCard — Synthesize/Cancel button, Play/Download, latency, error.
 * Receives all state from parent via props; no business logic here.
 */
import { AlertTriangle, CheckCircle2, Download, Loader2, Play, RotateCcw, Square, Zap } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OmniVoiceAdvancedParams, SynthStage } from "./constants";

interface UsedRunSnapshot {
  params: OmniVoiceAdvancedParams;
  speed: number;
  source?: string | null;
}

interface Props {
  isRu: boolean;
  stage: SynthStage;
  busy: boolean;
  canSynthesize: boolean;
  serverOnline: boolean | null;
  latencyMs: number | null;
  errorMessage: string | null;
  resultUrl: string | null;
  playing: boolean;
  usedRun?: UsedRunSnapshot | null;
  onSynthesize: () => void;
  onReset: () => void;
  onPlay: () => void;
  onDownload: () => void;
}

export function OmniVoiceResultCard({
  isRu, stage, busy, canSynthesize, serverOnline, latencyMs, errorMessage,
  resultUrl, playing, onSynthesize, onReset, onPlay, onDownload,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          onClick={busy ? onReset : onSynthesize}
          variant={busy ? "secondary" : "default"}
          disabled={!busy && !canSynthesize}
          title={serverOnline === false
            ? (isRu
                ? "Сервер недоступен (health-check не прошёл). Можно попробовать всё равно."
                : "Server unreachable (health-check failed). You can try anyway.")
            : undefined}
        >
          {busy ? (
            <>
              <RotateCcw className="w-4 h-4 mr-1" />
              {isRu ? "Отмена" : "Cancel"}
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 mr-1" />
              {isRu ? "Синтезировать" : "Synthesize"}
            </>
          )}
        </Button>

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{isRu ? "Генерация..." : "Generating..."}</span>
          </div>
        )}

        {resultUrl && (
          <>
            <Button size="sm" variant="outline" onClick={onPlay} title={isRu ? "Воспроизвести" : "Play"}>
              {playing ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onDownload}
              title={isRu ? "Скачать как WAV" : "Download as WAV"}
            >
              <Download className="w-3 h-3" />
            </Button>
          </>
        )}

        {stage === "done" && <CheckCircle2 className="w-4 h-4 text-primary" />}
      </div>

      {latencyMs !== null && (
        <p className="text-xs text-muted-foreground">
          {isRu ? "Время ответа" : "Response time"}: {(latencyMs / 1000).toFixed(2)}s
        </p>
      )}

      {stage === "error" && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription className="text-xs">
            {errorMessage ?? (isRu ? "Ошибка синтеза" : "Synthesis error")}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
