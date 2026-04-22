/**
 * OmniVoiceModelsColumn — правая колонка в табе «Модели» VoiceLab.
 *
 * Архитектурное разделение:
 *  • OmniVoice TTS — серверная модель (Python, ~/.cache/huggingface/), браузер
 *    лишь спрашивает /health. Управлять моделью отсюда нельзя — только смотреть.
 *  • Whisper STT — браузерный ONNX через @huggingface/transformers, кэш в
 *    Cache Storage / IndexedDB. Кнопка Скачать/Удалить.
 *
 * RVC и прочие ONNX-модели для Voice Conversion остаются в левой колонке
 * (ModelsPanel в VoiceLab.tsx).
 */
import { useEffect, useState } from "react";
import {
  Server,
  HardDrive,
  Mic,
  Loader2,
  Download,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Music2,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWhisperStt } from "@/hooks/useWhisperStt";
import { useOmniVoiceServer } from "@/components/voicelab/omnivoice/useOmniVoiceServer";
import { WHISPER_APPROX_BYTES } from "@/lib/whisper/whisperStt";
import { toast } from "sonner";

interface ServerHealth {
  status?: string;
  ready?: boolean;
  model_loaded?: boolean;
  model_id?: string;
  memory_rss_mb?: number;
  uptime_s?: number;
}

/**
 * Known OmniVoice server-side checkpoints. The server loads exactly one at a
 * time (chosen via `omnivoice-server --model <hf-id>`); we just *display* the
 * catalog so the user can see what's available and which one is currently
 * loaded (matched by `health.model_id`).
 */
interface OmniVoiceModelEntry {
  id: string;
  label_ru: string;
  label_en: string;
  desc_ru: string;
  desc_en: string;
  tags?: string[];
  url: string;
}

const OMNIVOICE_CATALOG: OmniVoiceModelEntry[] = [
  {
    id: "k2-fsa/OmniVoice",
    label_ru: "OmniVoice (база)",
    label_en: "OmniVoice (base)",
    desc_ru: "Базовый чекпоинт k2-fsa: Voice Design + Voice Cloning, 600+ языков, non-verbal теги ([laughter], [sigh] и т.д.).",
    desc_en: "k2-fsa base checkpoint: Voice Design + Cloning, 600+ languages, non-verbal tags ([laughter], [sigh], …).",
    url: "https://huggingface.co/k2-fsa/OmniVoice",
  },
  {
    id: "ModelsLab/omnivoice-singing",
    label_ru: "OmniVoice Singing (ModelsLab)",
    label_en: "OmniVoice Singing (ModelsLab)",
    desc_ru: "Finetune ModelsLab: добавляет [singing] + 7 эмоций ([happy]/[sad]/[angry]/[excited]/[calm]/[nervous]/[whisper]). Простые мелодии, без аккомпанемента.",
    desc_en: "ModelsLab finetune: adds [singing] + 7 emotions ([happy]/[sad]/[angry]/[excited]/[calm]/[nervous]/[whisper]). Simple melodies only, no instrumental backing.",
    tags: ["[singing]", "[happy]", "[sad]"],
    url: "https://huggingface.co/ModelsLab/omnivoice-singing",
  },
];

interface Props {
  isRu: boolean;
}

export function OmniVoiceModelsColumn({ isRu }: Props) {
  const { requestBaseUrl, serverOnline, checkingServer, checkServer } = useOmniVoiceServer();
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  const whisper = useWhisperStt();

  // Подтягиваем /health с подробностями (model_id, memory_rss_mb)
  const refreshHealth = async () => {
    setLoadingHealth(true);
    try {
      const res = await fetch(`${requestBaseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) setHealth(await res.json());
      else setHealth(null);
    } catch {
      setHealth(null);
    } finally {
      setLoadingHealth(false);
    }
  };

  useEffect(() => {
    void refreshHealth();
     
  }, [requestBaseUrl, serverOnline]);

  const handleRefresh = async () => {
    await checkServer();
    await refreshHealth();
  };

  const handleWhisperDownload = async () => {
    const ok = await whisper.load();
    if (ok) {
      toast.success(isRu ? "Whisper STT загружен" : "Whisper STT downloaded");
    } else {
      toast.error(
        isRu ? "Не удалось загрузить Whisper STT" : "Failed to download Whisper STT",
      );
    }
  };

  const handleWhisperDelete = async () => {
    await whisper.clear();
    toast.success(isRu ? "Whisper STT удалён" : "Whisper STT removed");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Server className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {isRu ? "OmniVoice TTS" : "OmniVoice TTS"}
        </h2>
      </div>

      {/* ── Серверная модель ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            {isRu ? "Модель на сервере" : "Server-side model"}
            {serverOnline === true && (
              <Badge variant="outline" className="text-[10px] text-primary border-primary/50 ml-auto">
                {isRu ? "онлайн" : "online"}
              </Badge>
            )}
            {serverOnline === false && (
              <Badge variant="outline" className="text-[10px] text-destructive border-destructive/50 ml-auto">
                {isRu ? "офлайн" : "offline"}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleRefresh}
              disabled={checkingServer || loadingHealth}
            >
              {checkingServer || loadingHealth ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {isRu
              ? "OmniVoice работает локально на Python-сервере (CUDA), модель хранится в кэше HuggingFace, не в OPFS браузера. Управление моделью — через переустановку omnivoice-server."
              : "OmniVoice runs as a local Python server (CUDA). The model lives in the HuggingFace cache, not in browser OPFS. To manage the model, reinstall omnivoice-server."}
          </p>

          {serverOnline === false && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              {isRu
                ? "Сервер не отвечает. Запустите его командой:"
                : "Server is unreachable. Start it with:"}
              <pre className="mt-2 rounded bg-background/60 p-2 font-mono text-[11px]">
                npm run dev:full
              </pre>
            </div>
          )}

          {serverOnline === true && health && (
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs space-y-1.5">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Model</span>
                <span className="font-mono text-foreground">{health.model_id ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">{isRu ? "Загружена" : "Loaded"}</span>
                <span className="font-mono">
                  {health.model_loaded ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary inline" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground inline" />
                  )}
                </span>
              </div>
              {typeof health.memory_rss_mb === "number" && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{isRu ? "Память (RSS)" : "Memory (RSS)"}</span>
                  <span className="font-mono tabular-nums">
                    {(health.memory_rss_mb / 1024).toFixed(2)} GB
                  </span>
                </div>
              )}
              {typeof health.uptime_s === "number" && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{isRu ? "Аптайм" : "Uptime"}</span>
                  <span className="font-mono tabular-nums">
                    {formatUptime(health.uptime_s)}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-2 pt-1 border-t border-border/40">
                <span className="text-muted-foreground">{isRu ? "Адрес" : "Endpoint"}</span>
                <span className="font-mono text-[10px] truncate">{requestBaseUrl}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Каталог известных OmniVoice-чекпоинтов ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Music2 className="h-4 w-4 text-primary" />
            {isRu ? "Каталог моделей OmniVoice" : "OmniVoice catalog"}
            <Badge variant="outline" className="text-[10px] ml-auto">
              {isRu ? "серверные" : "server-side"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {isRu
              ? "Сервер загружает один чекпоинт за раз. Переключение — флагом --model при запуске omnivoice-server."
              : "The server loads one checkpoint at a time. Switch via --model when starting omnivoice-server."}
          </p>
          <div className="space-y-2">
            {OMNIVOICE_CATALOG.map((m) => {
              const active = health?.model_id === m.id;
              return (
                <div
                  key={m.id}
                  className={`rounded-md border p-3 transition-colors ${
                    active
                      ? "border-primary/60 bg-primary/5"
                      : "border-border/60 bg-muted/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium truncate">
                          {isRu ? m.label_ru : m.label_en}
                        </p>
                        {active && (
                          <Badge className="text-[10px] h-5 bg-primary/15 text-primary border-primary/40 hover:bg-primary/20">
                            {isRu ? "активна" : "active"}
                          </Badge>
                        )}
                      </div>
                      <p className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate">
                        {m.id}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {isRu ? m.desc_ru : m.desc_en}
                      </p>
                      {m.tags && m.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {m.tags.map((t) => (
                            <Badge
                              key={t}
                              variant="outline"
                              className="text-[10px] h-4 px-1.5 font-mono"
                            >
                              {t}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      title={isRu ? "Открыть на HuggingFace" : "Open on HuggingFace"}
                    >
                      <a href={m.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {serverOnline === true && health?.model_id && !OMNIVOICE_CATALOG.some(m => m.id === health.model_id) && (
            <p className="text-[11px] text-muted-foreground italic">
              {isRu
                ? `Сервер сообщил неизвестный чекпоинт: ${health.model_id}. Добавьте его в OMNIVOICE_CATALOG, чтобы он отобразился как «активный».`
                : `Server reported an unknown checkpoint: ${health.model_id}. Add it to OMNIVOICE_CATALOG to mark it as active.`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Whisper STT в OPFS / IndexedDB ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-primary" />
            {isRu ? "Браузерные модели (OPFS / IDB)" : "Browser models (OPFS / IDB)"}
            <Badge variant="outline" className="text-[10px] ml-auto">
              {isRu ? "опционально" : "optional"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {isRu
              ? "Эти модели работают прямо в браузере и кэшируются локально. Whisper STT нужен для автоматического распознавания текста референсного аудио во вкладке Cloning."
              : "These models run in the browser and cache locally. Whisper STT is used to auto-transcribe the reference audio in the Cloning tab."}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">{isRu ? "Модель" : "Model"}</TableHead>
                <TableHead className="text-xs text-right">{isRu ? "Размер" : "Size"}</TableHead>
                <TableHead className="text-xs text-center">{isRu ? "Статус" : "Status"}</TableHead>
                <TableHead className="text-xs w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="py-2">
                  <div className="flex items-center gap-2">
                    <Mic className="h-3.5 w-3.5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Whisper Base (STT)</p>
                      <p className="text-xs text-muted-foreground">
                        {isRu
                          ? "Xenova/whisper-base, FP32 на WASM — распознавание речи в браузере"
                          : "Xenova/whisper-base, FP32 on WASM — in-browser speech recognition"}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-xs text-right text-muted-foreground tabular-nums">
                  {(WHISPER_APPROX_BYTES / 1024 / 1024).toFixed(0)} MB
                </TableCell>
                <TableCell className="text-center">
                  {whisper.cached ? (
                    <CheckCircle2 className="h-4 w-4 text-primary mx-auto" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-muted-foreground mx-auto" />
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {whisper.cached ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={handleWhisperDelete}
                      disabled={whisper.downloading}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={handleWhisperDownload}
                      disabled={whisper.downloading}
                    >
                      {whisper.downloading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Download className="h-3 w-3" />
                      )}
                      {whisper.downloading
                        ? whisper.progress?.fraction
                          ? `${Math.round(whisper.progress.fraction * 100)}%`
                          : "…"
                        : isRu
                          ? "Скачать"
                          : "Download"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {whisper.downloading && whisper.progress?.fraction !== undefined && (
            <Progress value={whisper.progress.fraction * 100} className="h-1.5" />
          )}
          {whisper.error && (
            <p className="text-xs text-destructive">{whisper.error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
