/**
 * VcTestPipeline — Test pipeline controls + spectrogram display.
 * Runs TTS → VC pipeline, shows progress, timing, and spectrograms.
 * Extracted from VoiceConversionTab for maintainability.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Zap, Play, Square, Loader2, AlertTriangle, CheckCircle2,
  FlaskConical, ArrowRight, BarChart3,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBookerPro } from "@/hooks/useBookerPro";
import { convertVoiceFull, extractF0Only, type VcPipelineOptions } from "@/lib/vcPipeline";
import { getModelStatus, VC_MODEL_REGISTRY } from "@/lib/vcModelCache";
import type { PitchAlgorithm, SpeechEncoder } from "@/lib/vcModelCache";
import type { RvcOutputSR } from "@/lib/vcSynthesis";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SpectrogramPanel } from "@/components/studio/SpectrogramPanel";
import { readVcReferenceBlob } from "@/lib/vcReferenceCache";
import { loadVcIndex } from "@/lib/vcIndexSearch";
import {
  setForcedBackend, getForcedBackend,
  releaseAllVcSessions, getAvailableBackend,
  type VcBackend,
} from "@/lib/vcInferenceSession";
import type { PitchFrame } from "@/lib/vcCrepe";
import type { VcConfigValues } from "./VcConfigPanel";

type VcStage = "idle" | "tts" | "resample" | "normalize" | "contentvec" | "crepe" | "synthesis" | "done" | "error";

const STAGE_LABELS: Record<VcStage, { ru: string; en: string }> = {
  idle: { ru: "Ожидание", en: "Idle" },
  tts: { ru: "Генерация TTS...", en: "Generating TTS..." },
  resample: { ru: "Ресемплинг 16kHz...", en: "Resampling 16kHz..." },
  normalize: { ru: "Нормализация громкости...", en: "Loudness normalization..." },
  contentvec: { ru: "Извлечение эмбеддингов...", en: "Extracting embeddings..." },
  crepe: { ru: "Извлечение F0 pitch...", en: "F0 pitch extraction..." },
  synthesis: { ru: "RVC v2 синтез...", en: "RVC v2 synthesis..." },
  done: { ru: "Готово", en: "Done" },
  error: { ru: "Ошибка", en: "Error" },
};

interface VcTestPipelineProps {
  isRu: boolean;
  config: VcConfigValues;
  ttsProvider: string;
  buildTtsRequest: () => { url: string; body: Record<string, unknown> } | null;
  /** Expose F0 data to parent for pitch shift suggestions */
  onF0Extracted?: (ttsF0: PitchFrame[], refF0: PitchFrame[] | undefined) => void;
}

export function VcTestPipeline({
  isRu, config, ttsProvider, buildTtsRequest, onF0Extracted,
}: VcTestPipelineProps) {
  const pro = useBookerPro();
  const navigate = useNavigate();

  const {
    pitchShift, vcOutputSR, vcReferenceId, indexRate,
    vcIndexId, protect, pitchAlgorithm, vcEncoder, dryWet,
  } = config;

  // Pipeline state
  const [stage, setStage] = useState<VcStage>("idle");
  const [stageProgress, setStageProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [resultBlobUrl, setResultBlobUrl] = useState<string | null>(null);
  const [timingInfo, setTimingInfo] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showSpectrograms, setShowSpectrograms] = useState(false);
  const [ttsBlob, setTtsBlob] = useState<Blob | null>(null);
  const [rvcBlob, setRvcBlob] = useState<Blob | null>(null);
  const [refBlob, setRefBlob] = useState<Blob | null>(null);
  const [ttsF0, setTtsF0] = useState<PitchFrame[] | undefined>();
  const [refF0, setRefF0] = useState<PitchFrame[] | undefined>();
  const [rvcF0, setRvcF0] = useState<PitchFrame[] | undefined>();
  const [recalcingSlots, setRecalcingSlots] = useState<Set<number>>(new Set());

  // Backend
  const [backendChoice, setBackendChoice] = useState<"auto" | VcBackend>(getForcedBackend() ?? "auto");
  const [activeBackend, setActiveBackend] = useState<VcBackend | null>(null);

  useEffect(() => { getAvailableBackend().then(setActiveBackend); }, [backendChoice]);

  // Load reference blob + F0 when spectrograms open
  useEffect(() => {
    let cancelled = false;
    if (!showSpectrograms || !vcReferenceId) return;
    if (refF0 && refF0.length > 0) return;
    const load = async () => {
      let blob = refBlob;
      if (!blob) {
        blob = await readVcReferenceBlob(vcReferenceId);
        if (!blob || cancelled) return;
        setRefBlob(blob);
      }
      try {
        const frames = await extractF0Only(blob, pitchAlgorithm);
        if (!cancelled) setRefF0(frames);
      } catch (e) {
        console.warn("[VcTest] Failed to extract F0 from reference:", e);
      }
    };
    void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSpectrograms, vcReferenceId]);

  const handleBackendChange = useCallback(async (val: string) => {
    const choice = val as "auto" | VcBackend;
    await releaseAllVcSessions();
    setForcedBackend(choice === "auto" ? null : choice);
    setBackendChoice(choice);
    toast.info(isRu
      ? `Бэкенд переключён: ${choice === "auto" ? "авто" : choice === "wasm" ? "CPU (WASM)" : "GPU (WebGPU)"}`
      : `Backend switched: ${choice === "auto" ? "auto" : choice === "wasm" ? "CPU (WASM)" : "GPU (WebGPU)"}`
    );
  }, [isRu]);

  const isProcessing = stage !== "idle" && stage !== "done" && stage !== "error";

  // Cleanup
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      if (resultBlobUrl) URL.revokeObjectURL(resultBlobUrl);
    };
  }, [resultBlobUrl]);

  const handleStop = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    setPlaying(false);
  }, []);

  const handleReplay = useCallback(() => {
    if (!resultBlobUrl) return;
    handleStop();
    const audio = new Audio(resultBlobUrl);
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => { setPlaying(false); toast.error(isRu ? "Ошибка воспроизведения" : "Playback error"); };
    setPlaying(true);
    audio.play().catch(() => { setPlaying(false); });
  }, [resultBlobUrl, handleStop, isRu]);

  const handleReplayTts = useCallback(() => {
    if (!ttsBlob) return;
    handleStop();
    const url = URL.createObjectURL(ttsBlob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => { setPlaying(false); URL.revokeObjectURL(url); };
    audio.onerror = () => { setPlaying(false); URL.revokeObjectURL(url); };
    setPlaying(true);
    audio.play().catch(() => { setPlaying(false); });
  }, [ttsBlob, handleStop]);

  const handleTestVc = useCallback(async () => {
    if (playing) { handleStop(); return; }
    setStage("tts"); setStageProgress(0); setTimingInfo(""); setErrorMsg("");
    setTtsBlob(null); setRvcBlob(null); setTtsF0(undefined); setRvcF0(undefined);

    if (showSpectrograms && vcReferenceId && !refBlob) {
      readVcReferenceBlob(vcReferenceId).then(b => { if (b) setRefBlob(b); });
    }

    try {
      const status = await getModelStatus();
      const missing = VC_MODEL_REGISTRY.filter(m => !status[m.id]);
      if (missing.length > 0) {
        setErrorMsg(isRu ? `Модели не загружены: ${missing.map(m => m.label).join(", ")}.` : `Models not cached: ${missing.map(m => m.label).join(", ")}.`);
        setStage("error"); return;
      }
      const req = buildTtsRequest();
      if (!req) { setErrorMsg(isRu ? "Не удалось построить TTS-запрос" : "Failed to build TTS request"); setStage("error"); return; }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setErrorMsg(isRu ? "Необходимо авторизоваться" : "Please sign in"); setStage("error"); return; }

      const ttsResp = await fetch(req.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(req.body),
      });
      if (!ttsResp.ok) { const txt = await ttsResp.text().catch(() => ""); throw new Error(`TTS: ${ttsResp.status} ${txt.slice(0, 100)}`); }
      const ttsBlobResult = await ttsResp.blob();
      setTtsBlob(ttsBlobResult);
      setStageProgress(100);

      let indexData: { data: Float32Array; rows: number; cols: number } | undefined;
      if (vcIndexId && indexRate > 0) {
        const loaded = await loadVcIndex(vcIndexId);
        if (loaded) { indexData = loaded; }
      }

      const pipelineOpts: VcPipelineOptions = {
        pitchAlgorithm, encoder: vcEncoder, dryWet,
        onProgress: (s, p) => { setStage(s as VcStage); setStageProgress(Math.round(p * 100)); },
        synthesis: { pitchShift, outputSampleRate: vcOutputSR, indexRate, protect, indexData },
      };
      const result = await convertVoiceFull(ttsBlobResult, pipelineOpts);
      const t = result.features.timing;
      const rs = result.resample;
      const srIn = rs.inputSR >= 1000 ? `${(rs.inputSR / 1000).toFixed(rs.inputSR % 1000 === 0 ? 0 : 1)}k` : `${rs.inputSR}`;
      const srOut = rs.outputSR >= 1000 ? `${(rs.outputSR / 1000).toFixed(rs.outputSR % 1000 === 0 ? 0 : 1)}k` : `${rs.outputSR}`;
      const srLabel = result.synthesis.sampleRate === 44_100 ? "44.1" : `${(result.synthesis.sampleRate / 1000).toFixed(0)}`;
      const srNote = result.synthesis.srAutoDetected ? " (auto)" : "";
      const backendLabel = activeBackend === "wasm" ? " [CPU/WASM]" : " [GPU/WebGPU]";
      const pitchLabel = result.features.pitchAlgorithm === "rmvpe" ? "RMVPE" : result.features.pitchAlgorithm === "crepe-full" ? "CREPE-Full" : result.features.pitchAlgorithm === "swiftf0" ? "SwiftF0" : "CREPE-Tiny";
      const encLabel = result.features.encoder === "wavlm" ? "WavLM" : "ContentVec";
      setTimingInfo(
        `${result.features.durationSec.toFixed(1)}s → ${encLabel} ${t.encoderMs}ms, ${pitchLabel} ${t.crepeMs}ms, RVC ${result.synthesis.inferenceMs}ms, norm ${t.normalizeMs}ms, total ${result.totalMs}ms @ ${srLabel}kHz${srNote}${backendLabel}\n` +
        `Resample: ${rs.inputSamples.toLocaleString()} @ ${srIn}Hz → ${rs.outputSamples.toLocaleString()} @ ${srOut}Hz (${rs.durationSec.toFixed(2)}s, ${rs.resampleMs}ms)`
      );
      setStage("done");
      setRvcBlob(result.wav);
      setTtsF0(result.features.pitchFrames);

      // Notify parent about F0 for pitch shift suggestion
      if (onF0Extracted) {
        let currentRefF0 = refF0;
        if (vcReferenceId) {
          const b = await readVcReferenceBlob(vcReferenceId);
          if (b) {
            setRefBlob(b);
            try {
              currentRefF0 = await extractF0Only(b, pitchAlgorithm);
              setRefF0(currentRefF0);
            } catch {}
          }
        }
        onF0Extracted(result.features.pitchFrames, currentRefF0);
      }

      // Extract F0 from RVC output for spectrogram
      extractF0Only(result.wav, pitchAlgorithm)
        .then(frames => setRvcF0(frames))
        .catch(e => console.warn("[VcTest] Failed to extract F0 from RVC output:", e));

      if (resultBlobUrl) URL.revokeObjectURL(resultBlobUrl);
      const url = URL.createObjectURL(result.wav);
      setResultBlobUrl(url);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      audio.onerror = () => setPlaying(false);
      setPlaying(true);
      audio.play().catch(() => { setPlaying(false); });
    } catch (err: any) {
      console.error("[VcTestPipeline] Test error:", err);
      const isGpuCorrupt = err.name === "WebGPUCorruptError";
      const hint = isGpuCorrupt
        ? (isRu ? "\n⚠️ Рекомендуется переключить бэкенд на CPU (WASM)." : "\n⚠️ Consider switching backend to CPU (WASM).")
        : "";
      setErrorMsg((err.message || String(err)) + hint);
      setStage("error");
    }
  }, [playing, handleStop, buildTtsRequest, isRu, pitchShift, vcOutputSR, indexRate, protect, vcIndexId, pitchAlgorithm, vcEncoder, dryWet, activeBackend, vcReferenceId, onF0Extracted]);

  // Not activated guard
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
        <Button variant="outline" className="gap-2" onClick={() => navigate("/profile")}>
          <ArrowRight className="h-4 w-4" />
          {isRu ? "Перейти в Профиль → Booker Pro" : "Go to Profile → Booker Pro"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 mt-4">
      <Separator />

      {/* Test Pipeline */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {isRu ? "Тест пайплайна" : "Pipeline Test"}
        </p>
        <div className="flex gap-2">
          <Button onClick={handleTestVc} disabled={isProcessing} variant={playing ? "destructive" : "outline"} className="flex-1 gap-2">
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Square className="h-4 w-4" /> : <FlaskConical className="h-4 w-4" />}
            {isProcessing ? (isRu ? STAGE_LABELS[stage].ru : STAGE_LABELS[stage].en) : playing ? (isRu ? "Стоп" : "Stop") : (isRu ? `Тест: ${ttsProvider} → VC` : `Test: ${ttsProvider} → VC`)}
          </Button>
          {stage === "done" && !playing && !isProcessing && ttsBlob && (
            <Button onClick={handleReplayTts} variant="outline" className="gap-2 shrink-0">
              <Play className="h-4 w-4" />TTS
            </Button>
          )}
          {stage === "done" && resultBlobUrl && !playing && !isProcessing && (
            <Button onClick={handleReplay} variant="outline" className="gap-2 shrink-0">
              <Play className="h-4 w-4" />RVC
            </Button>
          )}
        </div>
        {isProcessing && (
          <div className="space-y-1">
            <Progress value={stageProgress} className="h-1.5" />
            <p className="text-xs text-muted-foreground text-center">{isRu ? STAGE_LABELS[stage].ru : STAGE_LABELS[stage].en}</p>
          </div>
        )}
        {stage === "done" && timingInfo && (
          <div className="flex items-start gap-2 text-xs text-primary">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="font-mono text-xs whitespace-pre-line">{timingInfo}</span>
          </div>
        )}
        {stage === "error" && errorMsg && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-all">{errorMsg}</span>
          </div>
        )}

        {/* Spectrogram toggle */}
        {stage === "done" && (ttsBlob || rvcBlob) && (
          <Button variant="outline" size="sm" className="gap-2 w-full" onClick={() => setShowSpectrograms(prev => !prev)}>
            <BarChart3 className="h-3.5 w-3.5" />
            {showSpectrograms ? (isRu ? "Скрыть спектрограммы" : "Hide spectrograms") : (isRu ? "Показать спектрограммы" : "Show spectrograms")}
          </Button>
        )}
      </div>

      {/* Spectrogram panel */}
      {showSpectrograms && (ttsBlob || rvcBlob) && (
        <SpectrogramPanel
          isRu={isRu}
          slots={[
            { label: isRu ? "Вход: TTS" : "Input: TTS", blob: ttsBlob, f0Frames: ttsF0, f0Color: "rgba(0, 0, 0, 0.9)" },
            { label: isRu ? "Референс" : "Reference", blob: refBlob, f0Frames: refF0, f0Color: "rgba(0, 0, 0, 0.9)" },
            { label: isRu ? "Выход: RVC" : "Output: RVC", blob: rvcBlob, f0Frames: rvcF0, f0Color: "rgba(0, 0, 0, 0.9)" },
          ]}
          onClose={() => setShowSpectrograms(false)}
          recalcingSlots={recalcingSlots}
          onRecalcF0={async (slotIndex) => {
            const blobs = [ttsBlob, refBlob, rvcBlob];
            const setters = [setTtsF0, setRefF0, setRvcF0];
            const blob = blobs[slotIndex];
            if (!blob) return;
            setRecalcingSlots(prev => new Set(prev).add(slotIndex));
            try {
              const frames = await extractF0Only(blob, pitchAlgorithm);
              setters[slotIndex](frames);
            } catch (e) {
              console.warn("[SpectrogramPanel] F0 recalc error:", e);
              toast.error(isRu ? "Ошибка пересчёта F0" : "F0 recalculation error");
            } finally {
              setRecalcingSlots(prev => { const next = new Set(prev); next.delete(slotIndex); return next; });
            }
          }}
        />
      )}

      {/* Export backend/choice for parent */}
      <input type="hidden" data-backend-choice={backendChoice} data-active-backend={activeBackend} />
    </div>
  );

  // Expose backend state for parent config panel
  // The parent can read backendChoice/activeBackend via the component's state
}

/** Hook to manage backend state — used by parent to share with VcConfigPanel */
export function useVcBackendState() {
  const [backendChoice, setBackendChoice] = useState<"auto" | VcBackend>(getForcedBackend() ?? "auto");
  const [activeBackend, setActiveBackend] = useState<VcBackend | null>(null);

  useEffect(() => { getAvailableBackend().then(setActiveBackend); }, [backendChoice]);

  const handleBackendChange = useCallback(async (val: string) => {
    const choice = val as "auto" | VcBackend;
    await releaseAllVcSessions();
    setForcedBackend(choice === "auto" ? null : choice);
    setBackendChoice(choice);
  }, []);

  return { backendChoice, activeBackend, handleBackendChange };
}
