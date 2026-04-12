/**
 * VoiceConversionTab — Booker Pro Voice Conversion settings tab for Narrators page.
 * Per-character VC enable/disable, pitch shift, speaker ID, test pipeline.
 */
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getModelStatus, VC_MODEL_REGISTRY } from "@/lib/vcModelCache";
import {
  Zap, Play, Square, Loader2, RotateCcw, AlertTriangle,
  CheckCircle2, Wand2, ArrowRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBookerPro } from "@/hooks/useBookerPro";
import { convertVoiceFull, type VcPipelineOptions } from "@/lib/vcPipeline";
import { supabase } from "@/integrations/supabase/client";

interface VoiceConversionTabProps {
  isRu: boolean;
  characterName: string;
  characterId: string;
  /** Current voice_config of the character */
  voiceConfig: Record<string, unknown>;
  /** Callback to update VC fields in voice_config */
  onUpdateVcConfig: (patch: Record<string, unknown>) => void;
  /** Current TTS provider for generating source audio */
  ttsProvider: string;
  /** Build TTS preview body (reuses Narrators TTS logic) */
  buildTtsRequest: () => { url: string; body: Record<string, unknown> } | null;
}

type VcStage = "idle" | "tts" | "resample" | "contentvec" | "crepe" | "synthesis" | "done" | "error";

const STAGE_LABELS: Record<VcStage, { ru: string; en: string }> = {
  idle: { ru: "Ожидание", en: "Idle" },
  tts: { ru: "Генерация TTS...", en: "Generating TTS..." },
  resample: { ru: "Ресемплинг 16kHz...", en: "Resampling 16kHz..." },
  contentvec: { ru: "ContentVec эмбеддинги...", en: "ContentVec embeddings..." },
  crepe: { ru: "CREPE F0 pitch...", en: "CREPE F0 pitch..." },
  synthesis: { ru: "RVC v2 синтез...", en: "RVC v2 synthesis..." },
  done: { ru: "Готово", en: "Done" },
  error: { ru: "Ошибка", en: "Error" },
};

export function VoiceConversionTab({
  isRu, characterName, characterId, voiceConfig,
  onUpdateVcConfig, ttsProvider, buildTtsRequest,
}: VoiceConversionTabProps) {
  const pro = useBookerPro();
  const navigate = useNavigate();

  // Per-character VC settings from voice_config
  const vcEnabled = (voiceConfig.vc_enabled as boolean) ?? false;
  const pitchShift = (voiceConfig.vc_pitch_shift as number) ?? 0;
  const speakerId = (voiceConfig.vc_speaker_id as number) ?? 0;

  // Test pipeline state
  const [stage, setStage] = useState<VcStage>("idle");
  const [stageProgress, setStageProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);
  const [timingInfo, setTimingInfo] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState("");

  const isProcessing = stage !== "idle" && stage !== "done" && stage !== "error";

  const handleStop = useCallback(() => {
    if (audioRef) {
      audioRef.pause();
      audioRef.currentTime = 0;
    }
    setPlaying(false);
  }, [audioRef]);

  const handleTestVc = useCallback(async () => {
    if (playing) { handleStop(); return; }

    setStage("tts");
    setStageProgress(0);
    setTimingInfo("");
    setErrorMsg("");

    try {
      // Pre-flight: verify all models are cached
      const status = await getModelStatus();
      const missing = VC_MODEL_REGISTRY.filter(m => !status[m.id]);
      if (missing.length > 0) {
        setErrorMsg(
          isRu
            ? `Модели не загружены: ${missing.map(m => m.label).join(", ")}. Скачайте в Профиле → Booker Pro.`
            : `Models not cached: ${missing.map(m => m.label).join(", ")}. Download in Profile → Booker Pro.`
        );
        setStage("error");
        return;
      }

      // Step 1: Generate TTS source audio
      const req = buildTtsRequest();
      if (!req) {
        setErrorMsg(isRu ? "Не удалось построить TTS-запрос" : "Failed to build TTS request");
        setStage("error");
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setErrorMsg(isRu ? "Необходимо авторизоваться" : "Please sign in");
        setStage("error");
        return;
      }

      const ttsResp = await fetch(req.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(req.body),
      });

      if (!ttsResp.ok) {
        const txt = await ttsResp.text().catch(() => "");
        throw new Error(`TTS failed: ${ttsResp.status} ${txt.slice(0, 100)}`);
      }

      const ttsBlob = await ttsResp.blob();
      setStageProgress(100);

      // Step 2: Run VC pipeline
      const pipelineOpts: VcPipelineOptions = {
        onProgress: (s, p) => {
          setStage(s);
          setStageProgress(Math.round(p * 100));
        },
        synthesis: {
          pitchShift,
          speakerId,
        },
      };

      const result = await convertVoiceFull(ttsBlob, pipelineOpts);

      // Show timing
      const t = result.features.timing;
      setTimingInfo(
        `${result.features.durationSec.toFixed(1)}s → ` +
        `CV ${t.contentvecMs}ms, CREPE ${t.crepeMs}ms, ` +
        `RVC ${result.synthesis.inferenceMs}ms, ` +
        `total ${result.totalMs}ms`
      );

      // Play result
      setStage("done");
      const url = URL.createObjectURL(result.wav);
      const audio = new Audio(url);
      audio.onended = () => { setPlaying(false); URL.revokeObjectURL(url); };
      setAudioRef(audio);
      setPlaying(true);
      await audio.play();
    } catch (err: any) {
      console.error("[VoiceConversionTab] Test error:", err);
      setErrorMsg(err.message || String(err));
      setStage("error");
    }
  }, [playing, handleStop, buildTtsRequest, isRu, pitchShift, speakerId]);

  // ─── Not activated ───
  if (!pro.enabled || !pro.modelsReady) {
    return (
      <div className="space-y-4 mt-4">
        <Alert className="border-primary/30 bg-primary/5">
          <Zap className="h-4 w-4 text-primary" />
          <AlertDescription className="text-sm">
            {isRu
              ? "Voice Conversion требует активации Booker Pro в Профиле. Необходимы WebGPU и загруженные ONNX модели (~491 MB)."
              : "Voice Conversion requires Booker Pro activation in Profile. WebGPU and downloaded ONNX models (~491 MB) are needed."}
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => navigate("/profile")}
        >
          <ArrowRight className="h-4 w-4" />
          {isRu ? "Перейти в Профиль → Booker Pro" : "Go to Profile → Booker Pro"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 mt-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Wand2 className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">
          {isRu ? "Voice Conversion для" : "Voice Conversion for"}{" "}
          <span className="text-primary">{characterName}</span>
        </span>
        <Badge variant="outline" className="text-[10px] border-primary/50 text-primary ml-auto">
          Booker Pro
        </Badge>
      </div>

      {/* Enable VC toggle */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
        <div>
          <p className="text-sm font-medium">
            {isRu ? "Применять Voice Conversion" : "Apply Voice Conversion"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isRu
              ? "TTS → ContentVec → CREPE → RVC v2 → уникальный тембр"
              : "TTS → ContentVec → CREPE → RVC v2 → unique timbre"}
          </p>
        </div>
        <Switch
          checked={vcEnabled}
          onCheckedChange={v => onUpdateVcConfig({ vc_enabled: v })}
        />
      </div>

      {/* Pitch shift */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Сдвиг тона" : "Pitch Shift"}
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {pitchShift > 0 ? "+" : ""}{pitchShift} {isRu ? "полутонов" : "semitones"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Slider
            min={-12} max={12} step={1}
            value={[pitchShift]}
            onValueChange={([v]) => onUpdateVcConfig({ vc_pitch_shift: v })}
            className="flex-1"
          />
          <Button
            variant="ghost" size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => onUpdateVcConfig({ vc_pitch_shift: 0 })}
            disabled={pitchShift === 0}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/60">
          {isRu
            ? "♀→♂: −4…−6 | ♂→♀: +4…+6 | Тонкая коррекция: ±1…2"
            : "♀→♂: −4…−6 | ♂→♀: +4…+6 | Fine-tune: ±1…2"}
        </p>
      </div>

      {/* Speaker ID */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Speaker ID
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">{speakerId}</span>
        </div>
        <div className="flex items-center gap-2">
          <Slider
            min={0} max={4} step={1}
            value={[speakerId]}
            onValueChange={([v]) => onUpdateVcConfig({ vc_speaker_id: v })}
            className="flex-1"
          />
          <Button
            variant="ghost" size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => onUpdateVcConfig({ vc_speaker_id: 0 })}
            disabled={speakerId === 0}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/60">
          {isRu
            ? "ID целевого спикера в мульти-спикерных RVC моделях (0 = основной)"
            : "Target speaker in multi-speaker RVC models (0 = primary)"}
        </p>
      </div>

      <Separator />

      {/* Test Pipeline */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {isRu ? "Тест пайплайна" : "Pipeline Test"}
        </p>

        <Button
          onClick={handleTestVc}
          disabled={isProcessing}
          variant={playing ? "destructive" : "outline"}
          className="w-full gap-2"
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : playing ? (
            <Square className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {isProcessing
            ? (isRu ? STAGE_LABELS[stage].ru : STAGE_LABELS[stage].en)
            : playing
              ? (isRu ? "Стоп" : "Stop")
              : (isRu ? `Тест: ${ttsProvider} → VC` : `Test: ${ttsProvider} → VC`)}
        </Button>

        {isProcessing && (
          <div className="space-y-1">
            <Progress value={stageProgress} className="h-1.5" />
            <p className="text-[10px] text-muted-foreground text-center">
              {isRu ? STAGE_LABELS[stage].ru : STAGE_LABELS[stage].en}
            </p>
          </div>
        )}

        {stage === "done" && timingInfo && (
          <div className="flex items-center gap-2 text-xs text-primary">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono text-[10px]">{timingInfo}</span>
          </div>
        )}

        {stage === "error" && errorMsg && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-all">{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="rounded-md border border-border bg-muted/30 p-2.5">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {isRu
            ? "🎙️ Voice Conversion преобразует TTS-аудио в уникальный тембр через ContentVec → CREPE → RVC v2. Обработка полностью на стороне клиента (WebGPU/WASM)."
            : "🎙️ Voice Conversion transforms TTS audio into a unique timbre via ContentVec → CREPE → RVC v2. Processing is fully client-side (WebGPU/WASM)."}
        </p>
      </div>
    </div>
  );
}
