/**
 * OmniVoiceLabPanel — Experimental OmniVoice tab in VoiceLab.
 * Connects to a local OmniVoice server (OpenAI-compatible /v1/audio/speech API).
 * Supports: Voice Design (instructions), Voice Cloning (ref audio + ref text), and Auto Voice.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Play, Square, Loader2, AlertTriangle, CheckCircle2, Upload, Zap, RotateCcw, Wifi, WifiOff, Globe,
} from "lucide-react";
import { toast } from "sonner";
import { useCloudSettings } from "@/hooks/useCloudSettings";

/* ─── Types ─────────────────────────────────────── */

interface OmniVoiceLabPanelProps {
  isRu: boolean;
}

type SynthMode = "design" | "clone" | "auto";
type SynthStage = "idle" | "synthesizing" | "done" | "error";

const OPENAI_PRESETS = [
  "alloy", "ash", "ballad", "cedar", "coral", "echo",
  "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse",
] as const;

const NON_VERBAL_TAGS = [
  "[laughter]", "[sigh]", "[confirmation-en]", "[question-en]",
  "[question-ah]", "[question-oh]", "[surprise-ah]", "[surprise-oh]",
  "[surprise-wa]", "[surprise-yo]", "[dissatisfaction-hnn]",
];

const DEFAULT_SERVER_URL = "http://127.0.0.1:8880";

/* ─── Component ─────────────────────────────────── */

export function OmniVoiceLabPanel({ isRu }: OmniVoiceLabPanelProps) {
  // ── Server connection ──
  const { value: serverUrl, update: setServerUrl } = useCloudSettings("omnivoice-server-url", DEFAULT_SERVER_URL);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [checkingServer, setCheckingServer] = useState(false);

  // ── Mode ──
  const [mode, setMode] = useState<SynthMode>("design");

  // ── Voice Design ──
  const [preset, setPreset] = useState("alloy");
  const [instructions, setInstructions] = useState("");

  // ── Voice Cloning ──
  const [refAudioBlob, setRefAudioBlob] = useState<Blob | null>(null);
  const [refAudioName, setRefAudioName] = useState("");
  const [refTranscript, setRefTranscript] = useState("");
  const refInputRef = useRef<HTMLInputElement>(null);

  // ── Synthesis ──
  const [synthText, setSynthText] = useState("");
  const [speed, setSpeed] = useState(1.0);
  const [numSteps, setNumSteps] = useState(32);
  const [stage, setStage] = useState<SynthStage>("idle");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Playback ──
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ── Server health check ──
  const checkServer = useCallback(async () => {
    setCheckingServer(true);
    try {
      const res = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(3000) });
      setServerOnline(res.ok);
    } catch {
      setServerOnline(false);
    } finally {
      setCheckingServer(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    checkServer();
  }, [checkServer]);

  // ── Reference upload ──
  const handleRefUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRefAudioBlob(file);
    setRefAudioName(file.name);
  }, []);

  // ── Synthesis ──
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
        // One-shot cloning via multipart form
        const form = new FormData();
        form.append("text", synthText.trim());
        form.append("ref_text", refTranscript.trim());
        form.append("ref_audio", refAudioBlob!, refAudioName || "reference.wav");

        response = await fetch(`${serverUrl}/v1/audio/speech/clone`, {
          method: "POST",
          body: form,
        });
      } else {
        // Design or Auto via JSON
        const body: Record<string, unknown> = {
          model: "omnivoice",
          input: synthText.trim(),
          response_format: "wav",
          speed,
        };

        if (mode === "design") {
          if (instructions.trim()) {
            body.instructions = instructions.trim();
          } else {
            body.voice = preset;
          }
        }
        // Auto mode: no voice/instructions — model picks automatically

        response = await fetch(`${serverUrl}/v1/audio/speech`, {
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
          : `Synthesis complete in ${(elapsed / 1000).toFixed(1)}s`
      );
    } catch (err: any) {
      console.error("[omnivoice] Synthesis error:", err);
      setErrorMessage(err?.message ?? String(err));
      setStage("error");
      toast.error(err?.message ?? String(err));
    }
  }, [synthText, mode, refAudioBlob, refAudioName, refTranscript, instructions, preset, speed, serverUrl, isRu, resultUrl]);

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

  // Cleanup
  useEffect(() => () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    audioRef.current?.pause();
  }, [resultUrl]);

  const busy = stage === "synthesizing";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            OmniVoice — Zero-Shot TTS
          </h3>
          <p className="text-sm text-muted-foreground">
            {isRu
              ? "Локальный сервер: Voice Design, Voice Cloning, 600+ языков"
              : "Local server: Voice Design, Voice Cloning, 600+ languages"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {serverOnline === true && (
            <Badge variant="default" className="gap-1">
              <Wifi className="w-3 h-3" />
              Online
            </Badge>
          )}
          {serverOnline === false && (
            <Badge variant="destructive" className="gap-1">
              <WifiOff className="w-3 h-3" />
              Offline
            </Badge>
          )}
          {serverOnline === null && checkingServer && (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              {isRu ? "Проверка..." : "Checking..."}
            </Badge>
          )}
        </div>
      </div>

      {/* Server URL */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="w-4 h-4" />
            {isRu ? "Сервер OmniVoice" : "OmniVoice Server"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://127.0.0.1:8880"
              className="text-sm font-mono"
            />
            <Button size="sm" variant="outline" onClick={checkServer} disabled={checkingServer}>
              {checkingServer ? <Loader2 className="w-3 h-3 animate-spin" /> : (isRu ? "Проверить" : "Check")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {isRu
              ? "Запустите: pip install omnivoice-server && omnivoice-server --device cuda"
              : "Run: pip install omnivoice-server && omnivoice-server --device cuda"}
          </p>
        </CardContent>
      </Card>

      {/* Mode selector */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{isRu ? "Режим синтеза" : "Synthesis Mode"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: "design" as SynthMode, label: isRu ? "🎨 Дизайн голоса" : "🎨 Voice Design" },
              { id: "clone" as SynthMode, label: isRu ? "🎙️ Клонирование" : "🎙️ Voice Clone" },
              { id: "auto" as SynthMode, label: isRu ? "🤖 Авто" : "🤖 Auto Voice" },
            ]).map((m) => (
              <Button
                key={m.id}
                variant={mode === m.id ? "default" : "outline"}
                size="sm"
                onClick={() => setMode(m.id)}
                className="text-xs"
              >
                {m.label}
              </Button>
            ))}
          </div>

          {/* Voice Design controls */}
          {mode === "design" && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">{isRu ? "Пресет (OpenAI-совместимый)" : "Preset (OpenAI-compatible)"}</Label>
                <Select value={preset} onValueChange={setPreset}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPENAI_PRESETS.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">
                  {isRu ? "Инструкции (переопределяет пресет)" : "Instructions (overrides preset)"}
                </Label>
                <Textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder={isRu
                    ? "female, young adult, high pitch, british accent"
                    : "female, young adult, high pitch, british accent"}
                  rows={2}
                  className="mt-1 text-sm font-mono"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {isRu
                    ? "Атрибуты: gender, age, pitch, style (whisper), accent (american, british, russian...)"
                    : "Attrs: gender, age, pitch, style (whisper), accent (american, british, russian...)"}
                </p>
              </div>
            </div>
          )}

          {/* Voice Cloning controls */}
          {mode === "clone" && (
            <div className="space-y-3">
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
                  {isRu ? "Транскрипт референса" : "Reference transcript"}
                </Label>
                <Textarea
                  value={refTranscript}
                  onChange={(e) => setRefTranscript(e.target.value)}
                  placeholder={isRu ? "Текст, произносимый в референсном аудио..." : "Text spoken in the reference audio..."}
                  rows={2}
                  className="mt-1 text-sm"
                />
              </div>
            </div>
          )}

          {/* Auto mode info */}
          {mode === "auto" && (
            <Alert>
              <AlertDescription className="text-xs">
                {isRu
                  ? "Модель автоматически выберет голос. Просто введите текст."
                  : "The model will automatically choose a voice. Just enter text."}
              </AlertDescription>
            </Alert>
          )}
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
              placeholder={isRu
                ? "Введите текст для озвучки... Поддерживаются теги: [laughter], [sigh] и др."
                : "Enter text to speak... Supports tags: [laughter], [sigh], etc."}
              rows={4}
              className="mt-1 text-sm"
            />
            {/* Non-verbal tags helper */}
            <div className="flex flex-wrap gap-1 mt-1">
              {NON_VERBAL_TAGS.slice(0, 5).map((tag) => (
                <Button
                  key={tag}
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[10px] text-muted-foreground"
                  onClick={() => setSynthText((prev) => prev + " " + tag)}
                >
                  {tag}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">{isRu ? "Скорость" : "Speed"}: {speed.toFixed(2)}</Label>
              <Slider value={[speed]} onValueChange={([v]) => setSpeed(v)} min={0.5} max={2.0} step={0.05} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{isRu ? "Шаги диффузии" : "Diffusion steps"}: {numSteps}</Label>
              <Slider value={[numSteps]} onValueChange={([v]) => setNumSteps(v)} min={4} max={64} step={1} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={busy ? handleReset : handleSynthesize}
              variant={busy ? "secondary" : "default"}
              disabled={!busy && (!synthText.trim() || serverOnline !== true)}
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
              <Button size="sm" variant="outline" onClick={handlePlay}>
                {playing ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              </Button>
            )}

            {stage === "done" && (
              <CheckCircle2 className="w-4 h-4 text-primary" />
            )}
          </div>

          {/* Latency */}
          {latencyMs !== null && (
            <p className="text-xs text-muted-foreground">
              {isRu ? "Время ответа" : "Response time"}: {(latencyMs / 1000).toFixed(2)}s
            </p>
          )}

          {/* Error */}
          {stage === "error" && (
            <Alert variant="destructive">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription className="text-xs">
                {errorMessage ?? (isRu ? "Ошибка синтеза" : "Synthesis error")}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Info */}
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isRu ? (
              <>
                <strong>OmniVoice</strong> — высококачественный TTS с поддержкой 600+ языков, клонирования голоса и Voice Design.
                Для работы запустите <code className="text-[10px] bg-muted px-1 rounded">omnivoice-server</code> локально на GPU.
                RTF ~0.025 на CUDA (в 40× быстрее реального времени).
                Репозиторий: <a href="https://github.com/k2-fsa/OmniVoice" target="_blank" rel="noopener" className="underline">k2-fsa/OmniVoice</a>
              </>
            ) : (
              <>
                <strong>OmniVoice</strong> — high-quality TTS supporting 600+ languages, voice cloning, and Voice Design.
                Run <code className="text-[10px] bg-muted px-1 rounded">omnivoice-server</code> locally on GPU.
                RTF ~0.025 on CUDA (40× faster than real-time).
                Repo: <a href="https://github.com/k2-fsa/OmniVoice" target="_blank" rel="noopener" className="underline">k2-fsa/OmniVoice</a>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
