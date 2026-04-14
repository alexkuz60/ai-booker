/**
 * VoiceConversionTab — Simplified VC settings tab for Narrators page.
 * Voice selection (references/indexes) + synthesis params + test pipeline.
 * Full management (upload, models) lives on the Voice Lab page.
 */
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getModelStatus, VC_MODEL_REGISTRY, VC_PITCH_MODELS, VC_ALL_MODELS, VC_ENCODER_MODELS, PITCH_ALGORITHM_LABELS, SPEECH_ENCODER_LABELS, type PitchAlgorithm, type SpeechEncoder } from "@/lib/vcModelCache";
import { hasModel, downloadModel } from "@/lib/vcModelCache";
import { listVcReferences, type VcReferenceEntry } from "@/lib/vcReferenceCache";
import { listVcIndexes, loadVcIndex, type VcIndexEntry } from "@/lib/vcIndexSearch";
import {
  Zap, Play, Square, Loader2, RotateCcw, AlertTriangle,
  CheckCircle2, Wand2, ArrowRight, FlaskConical, Cpu, Monitor, Download, BarChart3,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBookerPro } from "@/hooks/useBookerPro";
import { convertVoiceFull, type VcPipelineOptions } from "@/lib/vcPipeline";
import { RVC_OUTPUT_SR_OPTIONS, RVC_OUTPUT_SR_DEFAULT, type RvcOutputSR } from "@/lib/vcSynthesis";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SpectrogramPanel } from "@/components/studio/SpectrogramPanel";
import {
  type VcBackend, setForcedBackend, getForcedBackend,
  releaseAllVcSessions, getAvailableBackend,
} from "@/lib/vcInferenceSession";

interface VoiceConversionTabProps {
  isRu: boolean;
  characterName: string;
  characterId: string;
  voiceConfig: Record<string, unknown>;
  onUpdateVcConfig: (patch: Record<string, unknown>) => void;
  ttsProvider: string;
  buildTtsRequest: () => { url: string; body: Record<string, unknown> } | null;
}

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

export function VoiceConversionTab({
  isRu, characterName, characterId, voiceConfig,
  onUpdateVcConfig, ttsProvider, buildTtsRequest,
}: VoiceConversionTabProps) {
  const pro = useBookerPro();
  const navigate = useNavigate();

  // Per-character VC settings from voice_config
  const vcEnabled = (voiceConfig.vc_enabled as boolean) ?? false;
  const pitchShift = (voiceConfig.vc_pitch_shift as number) ?? 0;
  const vcOutputSR = (voiceConfig.vc_output_sr as RvcOutputSR) || RVC_OUTPUT_SR_DEFAULT;
  const vcReferenceId = (voiceConfig.vc_reference_id as string) || "";
  const indexRate = (voiceConfig.vc_index_rate as number) ?? 0.75;
  const vcIndexId = (voiceConfig.vc_index_id as string) || "";
  const protect = (voiceConfig.vc_protect as number) ?? 0.33;
  const pitchAlgorithm = (voiceConfig.vc_pitch_algorithm as PitchAlgorithm) || "crepe-tiny";
  const vcEncoder = (voiceConfig.vc_encoder as SpeechEncoder) || "contentvec";
  const dryWet = (voiceConfig.vc_dry_wet as number) ?? 1.0;

  // Test pipeline state
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

  // Backend selection: "auto" | "webgpu" | "wasm"
  const [backendChoice, setBackendChoice] = useState<"auto" | VcBackend>(
    getForcedBackend() ?? "auto"
  );
  const [activeBackend, setActiveBackend] = useState<VcBackend | null>(null);

  // Resolve active backend on mount and after change
  useEffect(() => {
    getAvailableBackend().then(setActiveBackend);
  }, [backendChoice]);

  // Handle backend switch — release existing sessions first
  const handleBackendChange = useCallback(async (val: string) => {
    const choice = val as "auto" | VcBackend;
    // Release all cached sessions since they were created with the old backend
    await releaseAllVcSessions();
    setForcedBackend(choice === "auto" ? null : choice);
    setBackendChoice(choice);
    toast.info(
      isRu
        ? `Бэкенд переключён: ${choice === "auto" ? "авто" : choice === "wasm" ? "CPU (WASM)" : "GPU (WebGPU)"}`
        : `Backend switched: ${choice === "auto" ? "auto" : choice === "wasm" ? "CPU (WASM)" : "GPU (WebGPU)"}`
    );
  }, [isRu]);

  // Pitch model download state
  const [pitchModelDownloading, setPitchModelDownloading] = useState(false);
  const [pitchDlProgress, setPitchDlProgress] = useState(0);

  // Available references & indexes (read-only lists from OPFS)
  const [localRefs, setLocalRefs] = useState<VcReferenceEntry[]>([]);
  const [localIndexes, setLocalIndexes] = useState<VcIndexEntry[]>([]);

  const isProcessing = stage !== "idle" && stage !== "done" && stage !== "error";

  /** Handle pitch algorithm change — download model if needed */
  const handlePitchAlgorithmChange = useCallback(async (val: string) => {
    const algo = val as PitchAlgorithm;
    onUpdateVcConfig({ vc_pitch_algorithm: algo });

    // Check if the selected model is already downloaded
    const modelId = algo; // model IDs match algorithm IDs
    const cached = await hasModel(modelId);
    if (cached) return;

    // Need to download the model
    const entry = VC_ALL_MODELS.find(m => m.id === modelId);
    if (!entry) return;

    const confirmed = window.confirm(
      isRu
        ? `Модель "${entry.label}" (${(entry.sizeBytes / 1e6).toFixed(0)} MB) не загружена. Скачать?`
        : `Model "${entry.label}" (${(entry.sizeBytes / 1e6).toFixed(0)} MB) not cached. Download?`
    );
    if (!confirmed) {
      // Revert to crepe-tiny which is always available
      onUpdateVcConfig({ vc_pitch_algorithm: "crepe-tiny" });
      return;
    }

    setPitchModelDownloading(true);
    setPitchDlProgress(0);
    try {
      const ok = await downloadModel(entry, (p) => setPitchDlProgress(Math.round(p.fraction * 100)));
      if (!ok) throw new Error("Download failed");
      toast.success(isRu ? `${entry.label} загружена` : `${entry.label} downloaded`);
    } catch (err: any) {
      toast.error(isRu ? `Ошибка загрузки: ${err.message}` : `Download error: ${err.message}`);
      onUpdateVcConfig({ vc_pitch_algorithm: "crepe-tiny" });
    } finally {
      setPitchModelDownloading(false);
    }
  }, [isRu, onUpdateVcConfig]);

  // Load available refs & indexes
  useEffect(() => {
    listVcReferences().then(setLocalRefs);
    listVcIndexes().then(setLocalIndexes);
  }, []);

  // Cleanup audio on unmount
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
    audio.play().catch(() => { setPlaying(false); toast.error(isRu ? "Браузер заблокировал воспроизведение" : "Browser blocked playback"); });
  }, [resultBlobUrl, handleStop, isRu]);

  const handleTestVc = useCallback(async () => {
    if (playing) { handleStop(); return; }
    setStage("tts");
    setStageProgress(0);
    setTimingInfo("");
    setErrorMsg("");
    setTtsBlob(null);
    setRvcBlob(null);
    try {
      const status = await getModelStatus();
      const missing = VC_MODEL_REGISTRY.filter(m => !status[m.id]);
      if (missing.length > 0) {
        setErrorMsg(isRu
          ? `Модели не загружены: ${missing.map(m => m.label).join(", ")}.`
          : `Models not cached: ${missing.map(m => m.label).join(", ")}.`);
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
      const ttsBlob = await ttsResp.blob();
      setTtsBlob(ttsBlob);
      setStageProgress(100);

      // Load index data if configured
      let indexData: { data: Float32Array; rows: number; cols: number } | undefined;
      if (vcIndexId && indexRate > 0) {
        const loaded = await loadVcIndex(vcIndexId);
        if (loaded) {
          indexData = loaded;
          console.info(`[VcTest] Index loaded: ${loaded.rows} vectors × ${loaded.cols}D`);
        }
      }

      const pipelineOpts: VcPipelineOptions = {
        pitchAlgorithm,
        encoder: vcEncoder,
        dryWet,
        onProgress: (s, p) => { setStage(s as VcStage); setStageProgress(Math.round(p * 100)); },
        synthesis: { pitchShift, outputSampleRate: vcOutputSR, indexRate, protect, indexData },
      };
      const result = await convertVoiceFull(ttsBlob, pipelineOpts);
      const t = result.features.timing;
      const rs = result.resample;
      const srIn = rs.inputSR >= 1000 ? `${(rs.inputSR / 1000).toFixed(rs.inputSR % 1000 === 0 ? 0 : 1)}k` : `${rs.inputSR}`;
      const srOut = rs.outputSR >= 1000 ? `${(rs.outputSR / 1000).toFixed(rs.outputSR % 1000 === 0 ? 0 : 1)}k` : `${rs.outputSR}`;
      const srLabel = result.synthesis.sampleRate === 44_100 ? "44.1" : `${(result.synthesis.sampleRate/1000).toFixed(0)}`;
      const srNote = result.synthesis.srAutoDetected ? " (auto)" : "";
      const backendLabel = activeBackend === "wasm" ? " [CPU/WASM]" : " [GPU/WebGPU]";
      const pitchLabel = result.features.pitchAlgorithm === "rmvpe" ? "RMVPE" : result.features.pitchAlgorithm === "crepe-full" ? "CREPE-Full" : result.features.pitchAlgorithm === "swiftf0" ? "SwiftF0" : "CREPE-Tiny";
      const encLabel = result.features.encoder === "wavlm" ? "WavLM" : "ContentVec";
      setTimingInfo(
        `${result.features.durationSec.toFixed(1)}s → ${encLabel} ${t.encoderMs}ms, ${pitchLabel} ${t.crepeMs}ms, RVC ${result.synthesis.inferenceMs}ms, norm ${t.normalizeMs}ms, total ${result.totalMs}ms @ ${srLabel}kHz${srNote}${backendLabel}\n` +
        `Resample: ${rs.inputSamples.toLocaleString()} @ ${srIn}Hz → ${rs.outputSamples.toLocaleString()} @ ${srOut}Hz (${rs.durationSec.toFixed(2)}s, ${rs.resampleMs}ms)`
      );
      setStage("done");
      // Clean up previous blob URL
      if (resultBlobUrl) URL.revokeObjectURL(resultBlobUrl);
      const url = URL.createObjectURL(result.wav);
      setResultBlobUrl(url);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      audio.onerror = () => { setPlaying(false); };
      setPlaying(true);
      audio.play().catch(() => {
        setPlaying(false);
        console.warn("[VcTest] Autoplay blocked, user can click Play to replay");
      });
    } catch (err: any) {
      console.error("[VoiceConversionTab] Test error:", err);
      setErrorMsg(err.message || String(err));
      setStage("error");
    }
  }, [playing, handleStop, buildTtsRequest, isRu, pitchShift, vcOutputSR, indexRate, protect, vcIndexId, pitchAlgorithm, vcEncoder, dryWet]);

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
        <Button variant="outline" className="gap-2" onClick={() => navigate("/profile")}>
          <ArrowRight className="h-4 w-4" />
          {isRu ? "Перейти в Профиль → Booker Pro" : "Go to Profile → Booker Pro"}
        </Button>
      </div>
    );
  }

  const selectedRef = localRefs.find(r => r.id === vcReferenceId);
  const selectedIndex = localIndexes.find(ix => ix.id === vcIndexId);

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
          <p className="text-sm font-medium">{isRu ? "Применять Voice Conversion" : "Apply Voice Conversion"}</p>
          <p className="text-xs text-muted-foreground">
            {isRu
              ? `TTS → ${vcEncoder === "wavlm" ? "WavLM" : "ContentVec"} → ${PITCH_ALGORITHM_LABELS[pitchAlgorithm]?.en?.split(" ")[0] ?? "CREPE"} → RVC v2 → уникальный тембр`
              : `TTS → ${vcEncoder === "wavlm" ? "WavLM" : "ContentVec"} → ${PITCH_ALGORITHM_LABELS[pitchAlgorithm]?.en?.split(" ")[0] ?? "CREPE"} → RVC v2 → unique timbre`}
          </p>
        </div>
        <Switch checked={vcEnabled} onCheckedChange={v => onUpdateVcConfig({ vc_enabled: v })} />
      </div>

      {/* ─── Pitch Algorithm ─── */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Алгоритм питча (F0)" : "Pitch Algorithm (F0)"}
          </label>
          <Badge variant="outline" className="text-[10px]">
            {PITCH_ALGORITHM_LABELS[pitchAlgorithm]?.size ?? "~2 MB"}
          </Badge>
        </div>
        <Select value={pitchAlgorithm} onValueChange={handlePitchAlgorithmChange} disabled={isProcessing || pitchModelDownloading}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PITCH_ALGORITHM_LABELS) as PitchAlgorithm[]).map(algo => (
              <SelectItem key={algo} value={algo}>
                {isRu ? PITCH_ALGORITHM_LABELS[algo].ru : PITCH_ALGORITHM_LABELS[algo].en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pitchModelDownloading && (
          <div className="space-y-1">
            <Progress value={pitchDlProgress} className="h-1.5" />
            <p className="text-xs text-muted-foreground text-center">
              <Download className="inline h-3 w-3 mr-1" />
              {isRu ? `Загрузка модели: ${pitchDlProgress}%` : `Downloading model: ${pitchDlProgress}%`}
            </p>
          </div>
        )}
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu
            ? "SwiftF0 = молния | Tiny = быстро | Full = чище | RMVPE = золотой стандарт"
            : "SwiftF0 = lightning | Tiny = fast | Full = cleaner | RMVPE = gold standard"}
        </p>
      </div>

      {/* ─── Speech Encoder ─── */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Энкодер речи" : "Speech Encoder"}
          </label>
          <Badge variant="outline" className="text-[10px]">
            {SPEECH_ENCODER_LABELS[vcEncoder]?.size ?? "~378 MB"}
          </Badge>
        </div>
        <Select
          value={vcEncoder}
          onValueChange={async (val: string) => {
            const enc = val as SpeechEncoder;
            onUpdateVcConfig({ vc_encoder: enc });
            if (enc === "wavlm") {
              const cached = await hasModel("wavlm");
              if (!cached) {
                const entry = VC_ENCODER_MODELS.find(m => m.id === "wavlm");
                if (!entry) return;
                const confirmed = window.confirm(
                  isRu
                    ? `Модель "${entry.label}" (${(entry.sizeBytes / 1e6).toFixed(0)} MB) не загружена. Скачать?`
                    : `Model "${entry.label}" (${(entry.sizeBytes / 1e6).toFixed(0)} MB) not cached. Download?`
                );
                if (!confirmed) {
                  onUpdateVcConfig({ vc_encoder: "contentvec" });
                  return;
                }
                setPitchModelDownloading(true);
                setPitchDlProgress(0);
                try {
                  const ok = await downloadModel(entry, (p) => setPitchDlProgress(Math.round(p.fraction * 100)));
                  if (!ok) throw new Error("Download failed");
                  toast.success(isRu ? `${entry.label} загружена` : `${entry.label} downloaded`);
                } catch (err: any) {
                  toast.error(isRu ? `Ошибка загрузки: ${err.message}` : `Download error: ${err.message}`);
                  onUpdateVcConfig({ vc_encoder: "contentvec" });
                } finally {
                  setPitchModelDownloading(false);
                }
              }
            }
          }}
          disabled={isProcessing || pitchModelDownloading}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SPEECH_ENCODER_LABELS) as SpeechEncoder[]).map(enc => (
              <SelectItem key={enc} value={enc}>
                {isRu ? SPEECH_ENCODER_LABELS[enc].ru : SPEECH_ENCODER_LABELS[enc].en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu
            ? SPEECH_ENCODER_LABELS[vcEncoder]?.description.ru
            : SPEECH_ENCODER_LABELS[vcEncoder]?.description.en}
        </p>
      </div>

      <Separator />

      {/* ─── Reference Voice Select ─── */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Референсный голос" : "Reference Voice"}
          </label>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs gap-1" onClick={() => navigate("/voice-lab")}>
            <FlaskConical className="h-3 w-3" />
            {isRu ? "Voice Lab" : "Voice Lab"}
          </Button>
        </div>
        <Select value={vcReferenceId || "__none__"} onValueChange={v => onUpdateVcConfig({ vc_reference_id: v === "__none__" ? "" : v })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={isRu ? "Не выбран" : "Not selected"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{isRu ? "— Без референса —" : "— No reference —"}</SelectItem>
            {localRefs.map(r => (
              <SelectItem key={r.id} value={r.id}>
                {r.name} ({(r.durationMs / 1000).toFixed(1)}s)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {localRefs.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            {isRu ? "Нет референсов. Загрузите в " : "No references. Upload in "}
            <button className="text-primary underline" onClick={() => navigate("/voice-lab")}>Voice Lab</button>.
          </p>
        )}
      </div>

      <Separator />

      {/* ─── Training Index Select ─── */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Индекс обучения" : "Training Index"}
          </label>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs gap-1" onClick={() => navigate("/voice-lab")}>
            <FlaskConical className="h-3 w-3" />
            {isRu ? "Voice Lab" : "Voice Lab"}
          </Button>
        </div>
        <Select value={vcIndexId || "__none__"} onValueChange={v => onUpdateVcConfig({ vc_index_id: v === "__none__" ? "" : v })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={isRu ? "Не выбран" : "Not selected"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{isRu ? "— Без индекса —" : "— No index —"}</SelectItem>
            {localIndexes.map(ix => (
              <SelectItem key={ix.id} value={ix.id}>
                {ix.name} ({ix.vectorCount.toLocaleString()} × {ix.dim}D)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

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
          <Slider min={-12} max={12} step={1} value={[pitchShift]} onValueChange={([v]) => onUpdateVcConfig({ vc_pitch_shift: v })} className="flex-1" />
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onUpdateVcConfig({ vc_pitch_shift: 0 })} disabled={pitchShift === 0}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu ? "♀→♂: −4…−6 | ♂→♀: +4…+6 | Тонкая коррекция: ±1…2" : "♀→♂: −4…−6 | ♂→♀: +4…+6 | Fine-tune: ±1…2"}
        </p>
      </div>

      <Separator />

      {/* Feature Ratio */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Feature Ratio</label>
          <span className="text-xs text-muted-foreground tabular-nums">{indexRate.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Slider min={0} max={1} step={0.05} value={[indexRate]} onValueChange={([v]) => onUpdateVcConfig({ vc_index_rate: v })} className="flex-1" />
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onUpdateVcConfig({ vc_index_rate: 0.75 })} disabled={indexRate === 0.75}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu ? "0 = чистая артикуляция | 1 = макс. сходство с целевым голосом" : "0 = pure articulation | 1 = max target similarity"}
        </p>
      </div>

      <Separator />

      {/* Consonant Protection */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Защита согласных" : "Consonant Protection"}
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">{protect.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Slider min={0} max={0.5} step={0.01} value={[protect]} onValueChange={([v]) => onUpdateVcConfig({ vc_protect: v })} className="flex-1" />
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onUpdateVcConfig({ vc_protect: 0.33 })} disabled={protect === 0.33}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu ? "0 = без защиты | 0.5 = макс. сохранение шипящих/взрывных" : "0 = no protection | 0.5 = max sibilant preservation"}
        </p>
      </div>

      <Separator />

      {/* Dry/Wet Mix */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Микс TTS / RVC" : "TTS / RVC Mix"}
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {dryWet >= 0.999
              ? (isRu ? "100% RVC" : "100% RVC")
              : dryWet <= 0.001
                ? (isRu ? "100% TTS" : "100% TTS")
                : `${((1 - dryWet) * 100).toFixed(0)}% TTS / ${(dryWet * 100).toFixed(0)}% RVC`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground shrink-0">TTS</span>
          <Slider min={0} max={1} step={0.05} value={[dryWet]} onValueChange={([v]) => onUpdateVcConfig({ vc_dry_wet: v })} className="flex-1" />
          <span className="text-[10px] text-muted-foreground shrink-0">RVC</span>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onUpdateVcConfig({ vc_dry_wet: 1.0 })} disabled={dryWet === 1.0}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu
            ? "Смешивание оригинального TTS с конвертированным голосом для сохранения просодии"
            : "Blend original TTS with converted voice to preserve prosody"}
        </p>
      </div>

      <Separator />

      {/* Output Sample Rate */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Sample Rate модели RVC" : "RVC Model Sample Rate"}
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">{vcOutputSR === 44_100 ? "44.1" : (vcOutputSR / 1000).toFixed(0)} kHz</span>
        </div>
        <Select value={String(vcOutputSR)} onValueChange={v => onUpdateVcConfig({ vc_output_sr: Number(v) })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RVC_OUTPUT_SR_OPTIONS.map(sr => (
              <SelectItem key={sr} value={String(sr)}>
                {sr === 44_100 ? "44.1" : (sr / 1000).toFixed(0)} kHz {sr === RVC_OUTPUT_SR_DEFAULT ? (isRu ? "(по умолчанию)" : "(default)") : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* ─── Compute Backend ─── */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Вычислительный бэкенд" : "Compute Backend"}
          </label>
          {activeBackend && (
            <Badge variant="outline" className={`text-[10px] ${activeBackend === "webgpu" ? "border-primary/50 text-primary" : "border-muted-foreground/50 text-muted-foreground"}`}>
              {activeBackend === "webgpu" ? "GPU" : "CPU"}
            </Badge>
          )}
        </div>
        <Select value={backendChoice} onValueChange={handleBackendChange} disabled={isProcessing}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              <span className="flex items-center gap-1.5">
                <Monitor className="h-3 w-3" />
                {isRu ? "Авто (GPU → CPU)" : "Auto (GPU → CPU)"}
              </span>
            </SelectItem>
            <SelectItem value="webgpu">
              <span className="flex items-center gap-1.5">
                <Monitor className="h-3 w-3" />
                {isRu ? "GPU (WebGPU)" : "GPU (WebGPU)"}
              </span>
            </SelectItem>
            <SelectItem value="wasm">
              <span className="flex items-center gap-1.5">
                <Cpu className="h-3 w-3" />
                {isRu ? "CPU (WASM) — без ошибок WebGPU" : "CPU (WASM) — no WebGPU errors"}
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu
            ? "WASM = стабильно, но медленнее в ~3-5× | GPU = быстро, но возможны ошибки валидации"
            : "WASM = stable but ~3-5× slower | GPU = fast but may have validation errors"}
        </p>
      </div>

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
          {stage === "done" && resultBlobUrl && !playing && !isProcessing && (
            <Button onClick={handleReplay} variant="outline" className="gap-2 shrink-0">
              <Play className="h-4 w-4" />
              {isRu ? "Повторить" : "Replay"}
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
      </div>
    </div>
  );
}
