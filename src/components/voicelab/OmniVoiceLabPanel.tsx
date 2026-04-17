/**
 * OmniVoiceLabPanel — Experimental OmniVoice tab in VoiceLab.
 * Connects to a local OmniVoice server (OpenAI-compatible /v1/audio/speech API).
 * Supports: Voice Design (instructions), Voice Cloning (ref audio + ref text), and Auto Voice.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Play, Square, Loader2, AlertTriangle, CheckCircle2, Upload, Zap, RotateCcw, Wifi, WifiOff, Globe,
  Sparkles, Tags, Mic, Download,
} from "lucide-react";
import { toast } from "sonner";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import { recoverYo, YO_DICT_SIZE } from "@/lib/ruYoRecovery";

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

// Полный набор управляющих тегов OmniVoice (https://github.com/k2-fsa/OmniVoice).
// Группируем по смыслу для удобной вставки.
const NON_VERBAL_TAG_GROUPS: { label_ru: string; label_en: string; tags: string[] }[] = [
  {
    label_ru: "Эмоции", label_en: "Emotions",
    tags: ["[laughter]", "[sigh]", "[cry]", "[gasp]"],
  },
  {
    label_ru: "Подтверждения", label_en: "Confirmations",
    tags: ["[confirmation-en]", "[confirmation-mm]", "[confirmation-uhhuh]"],
  },
  {
    label_ru: "Вопросы", label_en: "Questions",
    tags: ["[question-en]", "[question-ah]", "[question-oh]", "[question-hmm]"],
  },
  {
    label_ru: "Удивление", label_en: "Surprise",
    tags: ["[surprise-ah]", "[surprise-oh]", "[surprise-wa]", "[surprise-yo]"],
  },
  {
    label_ru: "Прочее", label_en: "Other",
    tags: ["[dissatisfaction-hnn]", "[thinking-hmm]", "[breath]", "[cough]"],
  },
];

const DEFAULT_SERVER_URL = "http://127.0.0.1:8880";
const LOCAL_DEV_PROXY_PATH = "/api/omnivoice";
const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

const normalizeServerUrl = (value: string) => value.trim().replace(/\/$/, "");
const isDefaultLocalOmniVoiceServer = (value: string) => /^https?:\/\/(?:127\.0\.0\.1|localhost):8880$/i.test(normalizeServerUrl(value));

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
  const [transcribing, setTranscribing] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);

  // ── Synthesis ──
  const [synthText, setSynthText] = useState("");
  const [speed, setSpeed] = useState(1.0);
  const [numSteps, setNumSteps] = useState(32);
  const [stage, setStage] = useState<SynthStage>("idle");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const synthTextareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Playback ──
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const requestBaseUrl = useMemo(() => {
    const normalized = normalizeServerUrl(serverUrl);
    if (typeof window === "undefined") return normalized;

    const runningLocally = LOCAL_DEV_HOSTS.has(window.location.hostname);
    const canUseDevProxy = import.meta.env.DEV && runningLocally && isDefaultLocalOmniVoiceServer(normalized);

    return canUseDevProxy ? LOCAL_DEV_PROXY_PATH : normalized;
  }, [serverUrl]);

  const usingLocalDevProxy = requestBaseUrl === LOCAL_DEV_PROXY_PATH;
  const isLocalOrigin = typeof window !== "undefined" && LOCAL_DEV_HOSTS.has(window.location.hostname);

  const showPreviewWarning = useMemo(() => {
    if (typeof window === "undefined") return false;
    const runningLocally = LOCAL_DEV_HOSTS.has(window.location.hostname);
    return !runningLocally && /^https?:\/\/(?:127\.0\.0\.1|localhost)/i.test(normalizeServerUrl(serverUrl));
  }, [serverUrl]);

  // ── Server health check ──
  const checkServer = useCallback(async () => {
    setCheckingServer(true);
    try {
      const res = await fetch(`${requestBaseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        setServerOnline(true);
      } else {
        await fetch(`${requestBaseUrl}/`, { signal: AbortSignal.timeout(3000) });
        setServerOnline(true);
      }
    } catch {
      setServerOnline(false);
    } finally {
      setCheckingServer(false);
    }
  }, [requestBaseUrl]);

  useEffect(() => {
    checkServer();
  }, [checkServer]);

  // ── Reference upload ──
  const handleRefUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRefAudioBlob(file);
    setRefAudioName(file.name);
    setRefTranscript("");           // сбрасываем — старый транскрипт уже не валиден
  }, []);

  // ── Reference transcription (STT через OmniVoice / Whisper) ──
  const handleTranscribeRef = useCallback(async () => {
    if (!refAudioBlob) {
      toast.error(isRu ? "Сначала загрузите референсное аудио" : "Upload reference audio first");
      return;
    }
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("file", refAudioBlob, refAudioName || "reference.wav");
      form.append("model", "whisper-1");          // OmniVoice/OpenAI-совместимое имя
      form.append("response_format", "json");

      const res = await fetch(`${requestBaseUrl}/v1/audio/transcriptions`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${errText || "STT error"}`);
      }
      const data = await res.json().catch(() => null) as { text?: string } | null;
      const recognized = data?.text?.trim() ?? "";
      if (!recognized) {
        throw new Error(isRu ? "Сервер вернул пустой транскрипт" : "Server returned empty transcript");
      }
      setRefTranscript(recognized);
      toast.success(isRu ? `Распознано (${recognized.length} симв.)` : `Recognized (${recognized.length} chars)`);
    } catch (err: any) {
      console.error("[omnivoice] STT error:", err);
      toast.error(err?.message ?? String(err));
    } finally {
      setTranscribing(false);
    }
  }, [refAudioBlob, refAudioName, requestBaseUrl, isRu]);

  // ── Восстановление «ё» ──
  const handleRecoverYo = useCallback(() => {
    const { text, replacements } = recoverYo(synthText);
    if (replacements === 0) {
      toast.info(isRu ? "Нечего заменять" : "Nothing to replace");
      return;
    }
    setSynthText(text);
    toast.success(isRu ? `Восстановлено ё: ${replacements}` : `Restored ё: ${replacements}`);
  }, [synthText, isRu]);

  // ── Вставка тега в позицию курсора ──
  const insertTagAtCursor = useCallback((tag: string) => {
    const ta = synthTextareaRef.current;
    if (!ta) {
      // Фоллбек — добавляем в конец
      setSynthText((prev) => prev + (prev.endsWith(" ") || prev.length === 0 ? "" : " ") + tag + " ");
      return;
    }
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    // Аккуратно расставляем пробелы вокруг тега
    const needLeadingSpace = before.length > 0 && !/\s$/.test(before);
    const needTrailingSpace = after.length > 0 && !/^\s/.test(after);
    const inserted = (needLeadingSpace ? " " : "") + tag + (needTrailingSpace ? " " : "");
    const next = before + inserted + after;
    setSynthText(next);
    // Возвращаем фокус и позицию каретки за вставленным тегом
    queueMicrotask(() => {
      ta.focus();
      const caret = before.length + inserted.length;
      ta.setSelectionRange(caret, caret);
    });
  }, []);

  // ── Скачивание результата как WAV ──
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
      // Освобождаем объектный URL копии (оригинал остаётся для плеера)
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err: any) {
      console.error("[omnivoice] Download error:", err);
      toast.error(err?.message ?? String(err));
    }
  }, [resultUrl, mode]);


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
        const form = new FormData();
        form.append("text", synthText.trim());
        form.append("ref_text", refTranscript.trim());
        form.append("ref_audio", refAudioBlob!, refAudioName || "reference.wav");

        response = await fetch(`${requestBaseUrl}/v1/audio/speech/clone`, {
          method: "POST",
          body: form,
        });
      } else {
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
          : `Synthesis complete in ${(elapsed / 1000).toFixed(1)}s`
      );
    } catch (err: any) {
      console.error("[omnivoice] Synthesis error:", err);
      setErrorMessage(err?.message ?? String(err));
      setStage("error");
      toast.error(err?.message ?? String(err));
    }
  }, [synthText, mode, refAudioBlob, refAudioName, refTranscript, instructions, preset, speed, requestBaseUrl, isRu, resultUrl]);

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
          <Badge variant={isLocalOrigin ? "secondary" : "outline"} className="gap-1 text-[10px]">
            <Globe className="w-3 h-3" />
            {isLocalOrigin ? "Local" : "Cloud Preview"}
          </Badge>
          {serverOnline === true && (
            <Badge variant="default" className="gap-1">
              <Wifi className="w-3 h-3" />
              {isRu ? "Онлайн" : "Online"}
            </Badge>
          )}
          {serverOnline === false && (
            <Badge variant="destructive" className="gap-1">
              <WifiOff className="w-3 h-3" />
              {isRu ? "Оффлайн" : "Offline"}
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
          {usingLocalDevProxy && (
            <p className="text-xs text-muted-foreground">
              {isRu
                ? "В локальном Booker запросы к OmniVoice идут через встроенный dev-прокси на 127.0.0.1:8880."
                : "When Booker runs locally, OmniVoice requests go through the built-in dev proxy on 127.0.0.1:8880."}
            </p>
          )}
          {showPreviewWarning && (
            <Alert variant="destructive">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription className="text-xs">
                {isRu ? (
                  <>
                    Cloud preview не может достучаться до локального OmniVoice на <code className="rounded bg-muted px-1 text-[10px]">127.0.0.1:8880</code>.
                    Откройте Booker локально через <code className="rounded bg-muted px-1 text-[10px]">npm run dev</code> и используйте <code className="rounded bg-muted px-1 text-[10px]">http://localhost:8080/voice-lab</code>.
                  </>
                ) : (
                  <>
                    The cloud preview cannot reach a local OmniVoice server at <code className="rounded bg-muted px-1 text-[10px]">127.0.0.1:8880</code>.
                    Run Booker locally with <code className="rounded bg-muted px-1 text-[10px]">npm run dev</code> and use <code className="rounded bg-muted px-1 text-[10px]">http://localhost:8080/voice-lab</code>.
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}
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
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => refInputRef.current?.click()}>
                  <Upload className="w-3 h-3 mr-1" />
                  {isRu ? "Загрузить аудио" : "Upload audio"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTranscribeRef}
                  disabled={!refAudioBlob || transcribing}
                  title={isRu ? "Распознать речь в референсе (STT)" : "Transcribe reference audio (STT)"}
                >
                  {transcribing ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Mic className="w-3 h-3 mr-1" />
                  )}
                  {isRu ? "Распознать" : "Transcribe"}
                </Button>
                {refAudioName && (
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">{refAudioName}</span>
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
                <p className="text-xs text-muted-foreground mt-1">
                  {isRu
                    ? "Используйте «Распознать» для авто-заполнения через STT-эндпоинт сервера."
                    : "Use «Transcribe» to auto-fill via the server's STT endpoint."}
                </p>
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
              disabled={!busy && !synthText.trim()}
              title={serverOnline === false ? (isRu ? "Сервер недоступен (health-check не прошёл). Можно попробовать всё равно." : "Server unreachable (health-check failed). You can try anyway.") : undefined}
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
