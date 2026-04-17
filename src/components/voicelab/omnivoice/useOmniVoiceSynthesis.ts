/**
 * Hook that orchestrates OmniVoice synthesis + playback + download.
 *  - builds request for /v1/audio/speech (design/auto) or /v1/audio/speech/clone
 *  - tracks stage, latency, error
 *  - manages playback via HTMLAudioElement
 *  - exposes reset/download helpers
 *
 * Pure I/O — UI-specific text-editing stays in `textEditing.ts`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SynthMode, SynthStage } from "./constants";

export interface UseOmniVoiceSynthesisArgs {
  isRu: boolean;
  requestBaseUrl: string;
  mode: SynthMode;
  synthText: string;
  preset: string;
  instructions: string;
  refAudioBlob: Blob | null;
  refAudioName: string;
  refTranscript: string;
  speed: number;
}

export interface UseOmniVoiceSynthesisResult {
  stage: SynthStage;
  busy: boolean;
  latencyMs: number | null;
  errorMessage: string | null;
  resultUrl: string | null;
  playing: boolean;
  handleSynthesize: () => Promise<void>;
  handlePlay: () => void;
  handleDownload: () => Promise<void>;
  handleReset: () => void;
}

export function useOmniVoiceSynthesis(args: UseOmniVoiceSynthesisArgs): UseOmniVoiceSynthesisResult {
  const {
    isRu, requestBaseUrl, mode, synthText, preset, instructions,
    refAudioBlob, refAudioName, refTranscript, speed,
  } = args;

  const [stage, setStage] = useState<SynthStage>("idle");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const busy = stage === "synthesizing";

  const handleSynthesize = useCallback(async () => {
    if (!synthText.trim()) {
      toast.error(isRu ? "Введите текст для синтеза" : "Enter text to synthesize");
      return;
    }
    if (mode === "clone" && (!refAudioBlob || !refTranscript.trim())) {
      toast.error(isRu ? "Загрузите референс и транскрипт" : "Upload reference audio and transcript");
      return;
    }

    setStage("synthesizing");
    setErrorMessage(null);
    setLatencyMs(null);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);

    const t0 = performance.now();
    try {
      let response: Response;

      if (mode === "clone") {
        const form = new FormData();
        form.append("text", synthText.trim());
        form.append("ref_text", refTranscript.trim());
        form.append("ref_audio", refAudioBlob!, refAudioName || "reference.wav");
        response = await fetch(`${requestBaseUrl}/v1/audio/speech/clone`, { method: "POST", body: form });
      } else {
        const body: Record<string, unknown> = {
          model: "omnivoice",
          input: synthText.trim(),
          response_format: "wav",
          speed,
        };
        if (mode === "design") {
          if (instructions.trim()) body.instructions = instructions.trim();
          else body.voice = preset;
        }
        response = await fetch(`${requestBaseUrl}/v1/audio/speech`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      const elapsed = Math.round(performance.now() - t0);
      setLatencyMs(elapsed);

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${errText || "Server error"}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
      setStage("done");

      toast.success(
        isRu
          ? `Синтез завершён за ${(elapsed / 1000).toFixed(1)}с`
          : `Synthesis complete in ${(elapsed / 1000).toFixed(1)}s`,
      );
    } catch (err: any) {
      console.error("[omnivoice] Synthesis error:", err);
      setErrorMessage(err?.message ?? String(err));
      setStage("error");
      toast.error(err?.message ?? String(err));
    }
  }, [
    synthText, mode, refAudioBlob, refAudioName, refTranscript,
    instructions, preset, speed, requestBaseUrl, isRu, resultUrl,
  ]);

  const handlePlay = useCallback(() => {
    if (!resultUrl) return;
    if (playing && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }
    const audio = new Audio(resultUrl);
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    audio.play();
    setPlaying(true);
  }, [resultUrl, playing]);

  const handleDownload = useCallback(async () => {
    if (!resultUrl) return;
    try {
      const res = await fetch(resultUrl);
      const blob = await res.blob();
      const a = document.createElement("a");
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = URL.createObjectURL(blob);
      a.download = `omnivoice_${mode}_${ts}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err: any) {
      console.error("[omnivoice] Download error:", err);
      toast.error(err?.message ?? String(err));
    }
  }, [resultUrl, mode]);

  const handleReset = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
    setStage("idle");
    setLatencyMs(null);
    setErrorMessage(null);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
  }, [resultUrl]);

  // Cleanup on unmount / URL change
  useEffect(() => () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    audioRef.current?.pause();
  }, [resultUrl]);

  return {
    stage, busy, latencyMs, errorMessage, resultUrl, playing,
    handleSynthesize, handlePlay, handleDownload, handleReset,
  };
}
