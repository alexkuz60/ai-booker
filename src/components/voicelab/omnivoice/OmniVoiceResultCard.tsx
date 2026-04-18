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
  resultUrl, playing, usedRun, onSynthesize, onReset, onPlay, onDownload,
}: Props) {
  const chips = usedRun
    ? [
        { k: "guidance", v: usedRun.params.guidance_scale.toFixed(1), title: isRu ? "CFG / consistency" : "CFG / consistency" },
        { k: "steps",    v: String(usedRun.params.num_step),           title: isRu ? "Кол-во шагов диффузии" : "Diffusion steps" },
        { k: "t_shift",  v: usedRun.params.t_shift.toFixed(2),         title: isRu ? "Сдвиг расписания шума" : "Noise schedule shift" },
        { k: "pos_t",    v: usedRun.params.position_temperature.toFixed(2), title: isRu ? "Разнообразие интонации" : "Intonation diversity" },
        { k: "cls_t",    v: usedRun.params.class_temperature.toFixed(2),    title: isRu ? "«Живость» сэмплинга" : "Sampling liveliness" },
        { k: "denoise",  v: usedRun.params.denoise ? "on" : "off",     title: isRu ? "Шумоподавление на сервере" : "Server-side denoise" },
        { k: "speed",    v: `${usedRun.speed.toFixed(2)}×`,            title: isRu ? "Скорость" : "Speed" },
      ]
    : [];

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

      {resultUrl && usedRun && (
        <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>{isRu ? "Параметры этого прогона" : "Params used for this run"}</span>
            {usedRun.source && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                {usedRun.source}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {chips.map((c) => (
              <Badge
                key={c.k}
                variant="secondary"
                className="text-[10px] font-mono px-1.5 py-0 h-5 gap-1"
                title={c.title}
              >
                <span className="text-muted-foreground">{c.k}</span>
                <span>{c.v}</span>
              </Badge>
            ))}
          </div>
        </div>
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
