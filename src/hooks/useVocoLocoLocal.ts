/**
 * useVocoLocoLocal — high-level hook for running OmniVoice locally in the
 * browser via the VocoLoco ONNX stack (encoder + LLM + decoder).
 *
 * Responsibilities:
 *   • Track per-model OPFS cache status, react to VOCOLOCO_MODEL_CACHE_EVENT.
 *   • Download / delete individual models with progress.
 *   • Run designVoice / cloneVoice and surface a `resultUrl` consumable by
 *     the existing OmniVoiceResultCard component (zero UI coupling needed).
 *
 * VRAM lifecycle: pipeline.ts already handles staged release + worker
 * termination; this hook just calls it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  cloneVoice,
  designVoice,
  type VocoLocoSynthesisResult,
} from "@/lib/vocoloco/pipeline";
import {
  VOCOLOCO_ALL_MODELS,
  VOCOLOCO_DECODER,
  VOCOLOCO_ENCODER,
  VOCOLOCO_LLM_DEFAULT_ID,
  VOCOLOCO_LLM_VARIANTS,
  totalModelBytes,
  type VocoLocoModelEntry,
} from "@/lib/vocoloco/modelRegistry";
import {
  deleteVocoLocoModel,
  downloadVocoLocoModel,
  getVocoLocoStatus,
  VOCOLOCO_MODEL_CACHE_EVENT,
  type VocoLocoDownloadProgress,
} from "@/lib/vocoloco/modelCache";
import { encodeFloat32ToWav, decodeBlobToMono24kFloat32 } from "@/lib/vocoloco/wavEncoder";
import type { OmniVoiceAdvancedParams } from "@/components/voicelab/omnivoice/constants";

export type VocoLocoStage =
  | "idle"
  | "preparing"
  | "tokenize"
  | "load-encoder"
  | "encode-ref"
  | "load-llm"
  | "diffusion"
  | "load-decoder"
  | "decode"
  | "done"
  | "error";

export interface UseVocoLocoLocalArgs {
  isRu: boolean;
  /** Selected LLM quant variant id. Defaults to INT8. */
  llmModelId?: string;
}

export interface VocoLocoSynthesizeArgs {
  mode: "design" | "clone";
  text: string;
  /** Required when mode === "clone". Any decodable audio blob. */
  refAudioBlob?: Blob | null;
  speed: number;
  advanced: OmniVoiceAdvancedParams;
  /** Approximate target seconds — defaults to 4. */
  targetSeconds?: number;
}

export function useVocoLocoLocal(args: UseVocoLocoLocalArgs) {
  const { isRu, llmModelId = VOCOLOCO_LLM_DEFAULT_ID } = args;

  // ── Model status ──
  const [statuses, setStatuses] = useState<Record<string, boolean>>({});
  const refreshStatuses = useCallback(async () => {
    const s = await getVocoLocoStatus();
    setStatuses(s);
  }, []);

  useEffect(() => {
    void refreshStatuses();
    const handler = () => void refreshStatuses();
    window.addEventListener(VOCOLOCO_MODEL_CACHE_EVENT, handler);
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener(VOCOLOCO_MODEL_CACHE_EVENT, handler);
      window.removeEventListener("focus", handler);
    };
  }, [refreshStatuses]);

  // ── Per-model download UI state ──
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<VocoLocoDownloadProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const downloadModel = useCallback(
    async (entry: VocoLocoModelEntry) => {
      if (downloading) return;
      const ac = new AbortController();
      abortRef.current = ac;
      setDownloading(entry.id);
      setDownloadProgress(null);
      try {
        const ok = await downloadVocoLocoModel(
          entry,
          (p) => setDownloadProgress(p),
          ac.signal,
        );
        if (ok) {
          toast.success(isRu ? `${entry.label} загружен` : `${entry.label} downloaded`);
        } else if (!ac.signal.aborted) {
          toast.error(isRu ? `Ошибка загрузки ${entry.label}` : `Failed to download ${entry.label}`);
        }
      } finally {
        setDownloading(null);
        setDownloadProgress(null);
        abortRef.current = null;
        await refreshStatuses();
      }
    },
    [downloading, isRu, refreshStatuses],
  );

  const cancelDownload = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const deleteModel = useCallback(
    async (entry: VocoLocoModelEntry) => {
      const ok = await deleteVocoLocoModel(entry.id);
      if (ok) {
        toast.success(isRu ? `${entry.label} удалён` : `${entry.label} removed`);
      }
      await refreshStatuses();
    },
    [isRu, refreshStatuses],
  );

  // ── Readiness flags ──
  const decoderReady = !!statuses[VOCOLOCO_DECODER.id];
  const encoderReady = !!statuses[VOCOLOCO_ENCODER.id];
  const llmReady = !!statuses[llmModelId];

  const designReady = decoderReady && llmReady;
  const cloneReady = decoderReady && encoderReady && llmReady;

  // ── Synthesis state ──
  const [stage, setStage] = useState<VocoLocoStage>("idle");
  const [stageMessage, setStageMessage] = useState<string | null>(null);
  const [progressFraction, setProgressFraction] = useState(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const lastResult = useRef<VocoLocoSynthesisResult | null>(null);

  const reset = useCallback(() => {
    audioElRef.current?.pause();
    audioElRef.current = null;
    setPlaying(false);
    setStage("idle");
    setStageMessage(null);
    setProgressFraction(0);
    setLatencyMs(null);
    setErrorMessage(null);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    lastResult.current = null;
  }, [resultUrl]);

  const synthesize = useCallback(
    async (input: VocoLocoSynthesizeArgs) => {
      if (!input.text.trim()) {
        toast.error(isRu ? "Введите текст для синтеза" : "Enter text to synthesize");
        return;
      }
      if (input.mode === "clone" && !input.refAudioBlob) {
        toast.error(isRu ? "Загрузите референс" : "Upload reference audio");
        return;
      }
      const required = input.mode === "clone" ? cloneReady : designReady;
      if (!required) {
        toast.error(
          isRu
            ? "Не все модели загружены — проверьте менеджер моделей"
            : "Not all required models are downloaded — see model manager",
        );
        return;
      }

      reset();
      setStage("preparing");

      const onProgress: NonNullable<Parameters<typeof designVoice>[0]["onProgress"]> = (info) => {
        setStage(info.stage as VocoLocoStage);
        setProgressFraction(info.fraction);
        setStageMessage(info.message ?? null);
      };

      const t0 = performance.now();
      try {
        let result: VocoLocoSynthesisResult;
        if (input.mode === "clone") {
          const refPcm = await decodeBlobToMono24kFloat32(input.refAudioBlob!);
          result = await cloneVoice({
            text: input.text.trim(),
            refAudioPcm: refPcm,
            llmModelId,
            targetSeconds: input.targetSeconds ?? 4.0,
            params: {
              numSteps: Math.round(input.advanced.num_step),
              temperature: input.advanced.class_temperature,
              topP: 0.95,
              cfgScale: input.advanced.guidance_scale,
              tShift: input.advanced.t_shift,
            },
            onProgress,
          });
        } else {
          result = await designVoice({
            text: input.text.trim(),
            llmModelId,
            targetSeconds: input.targetSeconds ?? 4.0,
            params: {
              numSteps: Math.round(input.advanced.num_step),
              temperature: input.advanced.class_temperature,
              topP: 0.95,
              cfgScale: input.advanced.guidance_scale,
              tShift: input.advanced.t_shift,
            },
            onProgress,
          });
        }

        lastResult.current = result;
        const wav = encodeFloat32ToWav(result.audio, result.sampleRate);
        const url = URL.createObjectURL(wav);
        setResultUrl(url);
        setStage("done");
        const elapsed = Math.round(performance.now() - t0);
        setLatencyMs(elapsed);
        toast.success(
          isRu
            ? `Локальный синтез готов за ${(elapsed / 1000).toFixed(1)}с`
            : `Local synthesis done in ${(elapsed / 1000).toFixed(1)}s`,
        );
      } catch (err: any) {
        console.error("[useVocoLocoLocal] Synthesis failed:", err);
        setErrorMessage(err?.message ?? String(err));
        setStage("error");
        toast.error(err?.message ?? String(err));
      }
    },
    [cloneReady, designReady, isRu, llmModelId, reset],
  );

  const play = useCallback(() => {
    if (!resultUrl) return;
    if (playing && audioElRef.current) {
      audioElRef.current.pause();
      setPlaying(false);
      return;
    }
    const audio = new Audio(resultUrl);
    audioElRef.current = audio;
    audio.onended = () => setPlaying(false);
    audio.play();
    setPlaying(true);
  }, [resultUrl, playing]);

  const download = useCallback(async () => {
    if (!resultUrl) return;
    try {
      const res = await fetch(resultUrl);
      const blob = await res.blob();
      const a = document.createElement("a");
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = URL.createObjectURL(blob);
      a.download = `vocoloco_${ts}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err: any) {
      console.error("[useVocoLocoLocal] Download error:", err);
      toast.error(err?.message ?? String(err));
    }
  }, [resultUrl]);

  // Cleanup blob URL on unmount.
  useEffect(() => () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    audioElRef.current?.pause();
  }, [resultUrl]);

  const totalSize = useMemo(
    () => VOCOLOCO_ALL_MODELS.reduce((s, m) => s + totalModelBytes(m), 0),
    [],
  );

  return {
    // models
    statuses,
    decoderReady,
    encoderReady,
    llmReady,
    designReady,
    cloneReady,
    downloading,
    downloadProgress,
    downloadModel,
    cancelDownload,
    deleteModel,
    refreshStatuses,
    totalSize,
    // synthesis
    stage,
    stageMessage,
    progressFraction,
    busy: stage !== "idle" && stage !== "done" && stage !== "error",
    latencyMs,
    errorMessage,
    resultUrl,
    playing,
    synthesize,
    play,
    download,
    reset,
    // registry passthrough for UI
    encoderEntry: VOCOLOCO_ENCODER,
    decoderEntry: VOCOLOCO_DECODER,
    llmVariants: VOCOLOCO_LLM_VARIANTS,
  };
}
