/**
 * F5TtsLabPanel — Experimental F5-TTS tab in VoiceLab.
 * Allows downloading models, uploading reference audio + transcript, and running synthesis.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Download, Play, Square, Loader2, CheckCircle2, AlertTriangle, Upload, Trash2, Zap,
} from "lucide-react";
import {
  F5_MODEL_REGISTRY, F5_MODEL_CACHE_EVENT,
  getF5ModelStatus, downloadF5Model, areF5ModelsReady, deleteF5Model,
  type F5DownloadProgress,
} from "@/lib/f5tts/modelRegistry";
import type { F5ModelId } from "@/lib/f5tts/types";
import { ensureF5Sessions, releaseF5Sessions, synthesizeF5, f5AudioToWav } from "@/lib/f5tts/pipeline";
import { getVocabCoverage } from "@/lib/f5tts/tokenizer";
import { F5_SAMPLE_RATE } from "@/lib/f5tts/types";
import type { F5Reference } from "@/lib/f5tts/types";
import { toast } from "sonner";

interface F5TtsLabPanelProps {
  isRu: boolean;
}

type SynthStage = "idle" | "loading" | "encoding" | "transforming" | "decoding" | "done" | "error";

export function F5TtsLabPanel({ isRu }: F5TtsLabPanelProps) {
  // ── Model status ──
  const [modelStatus, setModelStatus] = useState<Record<string, boolean>>({});
  const [allReady, setAllReady] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [dlProgress, setDlProgress] = useState(0);

  // ── Reference ──
  const [refAudioBlob, setRefAudioBlob] = useState<Blob | null>(null);
  const [refAudioName, setRefAudioName] = useState("");
  const [refTranscript, setRefTranscript] = useState("");
  const refInputRef = useRef<HTMLInputElement>(null);

  // ── Synthesis ──
  const [synthText, setSynthText] = useState("");
  const [nfeSteps, setNfeSteps] = useState(16);
  const [speed, setSpeed] = useState(1.0);
  const [stage, setStage] = useState<SynthStage>("idle");
  const [nfeProgress, setNfeProgress] = useState(0);
  const [timing, setTiming] = useState<{ encoderMs: number; transformerMs: number; decoderMs: number; totalMs: number } | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  // Load model status
  const refreshStatus = useCallback(async () => {
    const s = await getF5ModelStatus();
    setModelStatus(s);
    setAllReady(Object.values(s).every(Boolean));
  }, []);

  useEffect(() => {
    refreshStatus();
    const handler = () => refreshStatus();
    window.addEventListener(F5_MODEL_CACHE_EVENT, handler);
    return () => window.removeEventListener(F5_MODEL_CACHE_EVENT, handler);
  }, [refreshStatus]);

  // ── Download handler ──
  const handleDownload = useCallback(async (modelId: F5ModelId) => {
    setDownloading(modelId);
    setDlProgress(0);
    try {
      await downloadF5Model(modelId, (p: F5DownloadProgress) => setDlProgress(Math.round(p.progress * 100)));
      toast.success(isRu ? "Модель загружена" : "Model downloaded");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDownloading(null);
      refreshStatus();
    }
  }, [isRu, refreshStatus]);

  const handleDownloadAll = useCallback(async () => {
    for (const entry of F5_MODEL_REGISTRY) {
      if (modelStatus[entry.id]) continue;
      await handleDownload(entry.id);
    }
  }, [modelStatus, handleDownload]);

  const handleDelete = useCallback(async (modelId: F5ModelId) => {
    await deleteF5Model(modelId);
    toast.success(isRu ? "Модель удалена" : "Model deleted");
    refreshStatus();
  }, [isRu, refreshStatus]);

  // ── Reference upload ──
  const handleRefUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRefAudioBlob(file);
    setRefAudioName(file.name);
  }, []);

  // ── Vocab coverage check ──
  const coverageInfo = synthText ? getVocabCoverage(synthText) : null;

  // ── Synthesis ──
  const handleSynthesize = useCallback(async () => {
    if (!refAudioBlob || !refTranscript.trim() || !synthText.trim()) {
      toast.error(isRu ? "Загрузите референс и заполните все поля" : "Upload reference and fill all fields");
      return;
    }

    setStage("loading");
    setTiming(null);
    setResultBlob(null);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setNfeProgress(0);

    try {
      // Decode reference audio to Int16 PCM 24kHz
      const arrayBuf = await refAudioBlob.arrayBuffer();
      const ctx = new AudioContext({ sampleRate: F5_SAMPLE_RATE });
      let decoded: AudioBuffer;
      try {
        decoded = await ctx.decodeAudioData(arrayBuf);
      } finally {
        await ctx.close();
      }

      // Resample to 24kHz mono if needed
      let samples: Float32Array;
      if (decoded.sampleRate !== F5_SAMPLE_RATE) {
        const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * F5_SAMPLE_RATE), F5_SAMPLE_RATE);
        const src = offline.createBufferSource();
        src.buffer = decoded;
        src.connect(offline.destination);
        src.start(0);
        const rendered = await offline.startRendering();
        samples = rendered.getChannelData(0);
      } else {
        samples = decoded.getChannelData(0);
      }

      // Float32 → Int16
      const int16 = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        int16[i] = s < 0 ? s * 32768 : s * 32767;
      }

      const reference: F5Reference = {
        audio: int16,
        text: refTranscript.trim(),
        samples: int16.length,
      };

      // Load sessions
      setStage("loading");
      await ensureF5Sessions();

      // Synthesize
      setStage("transforming");
      const result = await synthesizeF5(reference, synthText.trim(), {
        nfeSteps,
        speed,
        onStep: (step, total) => setNfeProgress(Math.round((step / total) * 100)),
      });

      setTiming(result.timing);
      setStage("done");

      // Create WAV blob
      const wav = f5AudioToWav(result.audio);
      setResultBlob(wav);
      const url = URL.createObjectURL(wav);
      setResultUrl(url);

      toast.success(
        isRu
          ? `Синтез завершён: ${result.durationSec.toFixed(1)}с за ${(result.timing.totalMs / 1000).toFixed(1)}с`
          : `Synthesis complete: ${result.durationSec.toFixed(1)}s in ${(result.timing.totalMs / 1000).toFixed(1)}s`
      );
    } catch (err: any) {
      console.error("[f5tts] Synthesis error:", err);
      setStage("error");
      toast.error(err.message ?? String(err));
    } finally {
      await releaseF5Sessions();
    }
  }, [refAudioBlob, refTranscript, synthText, nfeSteps, speed, isRu, resultUrl]);

  // ── Playback ──
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

  // Cleanup
  useEffect(() => () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    audioRef.current?.pause();
  }, [resultUrl]);

  const busy = stage === "loading" || stage === "encoding" || stage === "transforming" || stage === "decoding";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            {isRu ? "F5-TTS — Zero-Shot Voice Cloning" : "F5-TTS — Zero-Shot Voice Cloning"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {isRu
              ? "Экспериментальный локальный синтез речи на базе Flow Matching (ONNX WebGPU)"
              : "Experimental local speech synthesis via Flow Matching (ONNX WebGPU)"}
          </p>
        </div>
        <Badge variant={allReady ? "default" : "outline"}>
          {allReady
            ? (isRu ? "Модели готовы" : "Models ready")
            : (isRu ? "Требуется загрузка" : "Download required")}
        </Badge>
      </div>

      {/* Models table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            {isRu ? "Модели ONNX" : "ONNX Models"}
            {!allReady && (
              <Button size="sm" variant="outline" onClick={handleDownloadAll} disabled={!!downloading}>
                <Download className="w-3 h-3 mr-1" />
                {isRu ? "Загрузить все" : "Download All"}
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{isRu ? "Модель" : "Model"}</TableHead>
                <TableHead>{isRu ? "Размер" : "Size"}</TableHead>
                <TableHead>{isRu ? "Статус" : "Status"}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {F5_MODEL_REGISTRY.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <div>
                      <span className="font-medium text-sm">{entry.label}</span>
                      <p className="text-xs text-muted-foreground">{entry.description}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    ~{(entry.sizeBytes / 1e6).toFixed(0)} MB
                  </TableCell>
                  <TableCell>
                    {modelStatus[entry.id]
                      ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                      : <AlertTriangle className="w-4 h-4 text-yellow-500" />}
                  </TableCell>
                  <TableCell>
                    {downloading === entry.id ? (
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <Progress value={dlProgress} className="h-1.5 flex-1" />
                        <span className="text-xs">{dlProgress}%</span>
                      </div>
                    ) : modelStatus[entry.id] ? (
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(entry.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => handleDownload(entry.id)} disabled={!!downloading}>
                        <Download className="w-3 h-3 mr-1" />
                        {isRu ? "Загрузить" : "Download"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Reference + Synthesis */}
      {allReady && (
        <>
          {/* Reference audio */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{isRu ? "Голосовой референс" : "Voice Reference"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => refInputRef.current?.click()}>
                  <Upload className="w-3 h-3 mr-1" />
                  {isRu ? "Загрузить аудио" : "Upload audio"}
                </Button>
                {refAudioName && (
                  <span className="text-xs text-muted-foreground">{refAudioName}</span>
                )}
                <input
                  ref={refInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={handleRefUpload}
                />
              </div>
              <div>
                <Label className="text-xs">
                  {isRu ? "Транскрипт референса (что говорит диктор)" : "Reference transcript (what the speaker says)"}
                </Label>
                <Textarea
                  value={refTranscript}
                  onChange={(e) => setRefTranscript(e.target.value)}
                  placeholder={isRu ? "Введите текст, который произносится в референсном аудио..." : "Enter text spoken in the reference audio..."}
                  rows={2}
                  className="mt-1 text-sm"
                />
              </div>
            </CardContent>
          </Card>

          {/* Synthesis */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{isRu ? "Синтез" : "Synthesis"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">{isRu ? "Текст для синтеза" : "Text to synthesize"}</Label>
                <Textarea
                  value={synthText}
                  onChange={(e) => setSynthText(e.target.value)}
                  placeholder={isRu ? "Введите текст для озвучки..." : "Enter text to speak..."}
                  rows={3}
                  className="mt-1 text-sm"
                />
                {coverageInfo && coverageInfo.missing.length > 0 && (
                  <p className="text-xs text-yellow-500 mt-1">
                    {isRu ? "Символы вне словаря:" : "Out-of-vocab chars:"} {coverageInfo.missing.map(c => `'${c}'`).join(", ")}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">{isRu ? "NFE шагов" : "NFE Steps"}: {nfeSteps}</Label>
                  <Slider value={[nfeSteps]} onValueChange={([v]) => setNfeSteps(v)} min={4} max={64} step={1} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{isRu ? "Скорость" : "Speed"}: {speed.toFixed(2)}</Label>
                  <Slider value={[speed]} onValueChange={([v]) => setSpeed(v)} min={0.5} max={2.0} step={0.05} />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSynthesize}
                  disabled={busy || !refAudioBlob || !refTranscript.trim() || !synthText.trim()}
                >
                  {busy ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      {stage === "loading"
                        ? (isRu ? "Загрузка моделей..." : "Loading models...")
                        : (isRu ? `NFE ${nfeProgress}%` : `NFE ${nfeProgress}%`)}
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-1" />
                      {isRu ? "Синтезировать" : "Synthesize"}
                    </>
                  )}
                </Button>

                {resultUrl && (
                  <Button size="sm" variant="outline" onClick={handlePlay}>
                    {playing ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  </Button>
                )}
              </div>

              {/* Progress */}
              {busy && (
                <Progress value={nfeProgress} className="h-2" />
              )}

              {/* Timing */}
              {timing && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>Encoder: {timing.encoderMs}ms | Transformer: {timing.transformerMs}ms ({(timing.transformerMs / nfeSteps).toFixed(0)}ms/step) | Decoder: {timing.decoderMs}ms</p>
                  <p>{isRu ? "Итого" : "Total"}: {(timing.totalMs / 1000).toFixed(2)}s</p>
                </div>
              )}

              {/* Error */}
              {stage === "error" && (
                <Alert variant="destructive">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertDescription>
                    {isRu ? "Ошибка синтеза. Проверьте консоль." : "Synthesis error. Check console."}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
