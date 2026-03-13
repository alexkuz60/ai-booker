import { useState, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { FileAudio, Download, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { renderChapter, type ChapterRenderProgress } from "@/lib/chapterRenderer";
import type { TimelineClip } from "@/hooks/useTimelineClips";

interface RenderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clips: TimelineClip[];
  totalDurationSec: number;
  userId: string;
  bookTitle: string;
  chapterTitle: string;
  partNumber?: number | null;
  isRu: boolean;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizeFileName(name: string): string {
  // Transliterate Cyrillic to Latin, then remove/replace unsafe chars
  const transliterated = name
    .replace(/[а-яё]/gi, (char) => {
      const map: Record<string, string> = {
        а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
        й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
        у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y',
        ь: '', э: 'e', ю: 'yu', я: 'ya',
        А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'Yo', Ж: 'Zh', З: 'Z', И: 'I',
        Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T',
        У: 'U', Ф: 'F', Х: 'H', Ц: 'Ts', Ч: 'Ch', Ш: 'Sh', Щ: 'Sch', Ъ: '', Ы: 'Y',
        Ь: '', Э: 'E', Ю: 'Yu', Я: 'Ya',
      };
      return map[char] || char;
    })
    .replace(/\s+/g, '_')           // spaces → underscores
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')  // illegal chars
    .replace(/_{2,}/g, '_')         // collapse multiple underscores
    .trim();
  return transliterated || 'render';
}

const PHASE_LABELS = {
  loading: { en: "Loading stems…", ru: "Загрузка стемов…" },
  rendering: { en: "Rendering…", ru: "Рендеринг…" },
  encoding: { en: "Encoding WAV…", ru: "Кодирование WAV…" },
  uploading: { en: "Uploading…", ru: "Загрузка файла…" },
  done: { en: "Done!", ru: "Готово!" },
  error: { en: "Error", ru: "Ошибка" },
};

export function RenderDialog({
  open, onOpenChange, clips, totalDurationSec, userId,
  bookTitle, chapterTitle, partNumber, isRu,
}: RenderDialogProps) {

  // Default filename
  const defaultName = [
    sanitizeFileName(bookTitle),
    sanitizeFileName(chapterTitle),
    partNumber ? `part${partNumber}` : null,
  ].filter(Boolean).join("_");

  const [folderPath, setFolderPath] = useState("chapter-renders");
  const [fileName, setFileName] = useState(defaultName);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState<ChapterRenderProgress | null>(null);
  const [result, setResult] = useState<{ storagePath: string; fileSizeBytes: number } | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const abortRef = useRef(false);

  const handleRender = useCallback(async () => {
    if (!userId || clips.length === 0) return;
    setRendering(true);
    setProgress(null);
    setResult(null);
    setDownloadUrl(null);
    abortRef.current = false;

    const safeName = sanitizeFileName(fileName) || defaultName;
    const safeFolder = folderPath.replace(/^\/+|\/+$/g, "") || "chapter-renders";
    const storagePath = `${userId}/${safeFolder}/${safeName}.wav`;

    try {
      const res = await renderChapter({
        clips,
        totalDurationSec,
        userId,
        storagePath,
        onProgress: (p) => {
          if (!abortRef.current) setProgress(p);
        },
      });
      setResult({ storagePath: res.storagePath, fileSizeBytes: res.fileSizeBytes });

      // Get download URL
      const { data } = await supabase.storage
        .from("user-media")
        .createSignedUrl(res.storagePath, 3600);
      if (data?.signedUrl) setDownloadUrl(data.signedUrl);
    } catch (e: any) {
      console.error("[RenderDialog] Render failed:", e);
    } finally {
      setRendering(false);
    }
  }, [userId, clips, totalDurationSec, fileName, folderPath, defaultName]);

  const handleClose = useCallback(() => {
    if (rendering) return; // prevent close during render
    abortRef.current = true;
    setProgress(null);
    setResult(null);
    setDownloadUrl(null);
    setFileName(defaultName);
    onOpenChange(false);
  }, [rendering, defaultName, onOpenChange]);

  const phaseLabel = progress
    ? (isRu ? PHASE_LABELS[progress.phase].ru : PHASE_LABELS[progress.phase].en)
    : "";

  const isDone = progress?.phase === "done";
  const isError = progress?.phase === "error";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <FileAudio className="h-4 w-4" />
            {isRu ? "Рендер главы" : "Render Chapter"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Info */}
          <div className="text-xs text-muted-foreground font-body space-y-0.5">
            <p>{bookTitle} → {chapterTitle}{partNumber ? ` (${isRu ? "Часть" : "Part"} ${partNumber})` : ""}</p>
            <p>{isRu ? "Длительность" : "Duration"}: {formatDuration(totalDurationSec)} · WAV 16-bit / 44100 Hz / Stereo</p>
          </div>

          {/* File path inputs */}
          {!rendering && !isDone && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-body">
                  {isRu ? "Папка в хранилище" : "Storage folder"}
                </Label>
                <Input
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  className="h-8 text-xs font-mono"
                  placeholder="chapter-renders"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-body">
                  {isRu ? "Имя файла" : "File name"}
                </Label>
                <div className="flex items-center gap-1">
                  <Input
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    className="h-8 text-xs font-mono flex-1"
                    placeholder={defaultName}
                  />
                  <span className="text-xs text-muted-foreground font-mono">.wav</span>
                </div>
              </div>
            </>
          )}

          {/* Progress */}
          {rendering && progress && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="text-xs font-body text-foreground">{phaseLabel}</span>
              </div>
              <Progress value={progress.percent} className="h-2" />
              <p className="text-[10px] text-muted-foreground font-mono text-right">
                {progress.percent}%
              </p>
            </div>
          )}

          {/* Done */}
          {isDone && result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-500">
                <CheckCircle className="h-4 w-4" />
                <span className="font-body">{isRu ? "Рендер завершён" : "Render complete"}</span>
              </div>
              <div className="text-xs text-muted-foreground font-mono space-y-0.5">
                <p>{result.storagePath}</p>
                <p>{formatFileSize(result.fileSizeBytes)}</p>
              </div>
              {downloadUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs w-full"
                  asChild
                >
                  <a href={downloadUrl} download={`${sanitizeFileName(fileName)}.wav`}>
                    <Download className="h-3.5 w-3.5" />
                    {isRu ? "Скачать" : "Download"}
                  </a>
                </Button>
              )}
            </div>
          )}

          {/* Error */}
          {isError && progress?.error && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="font-body text-xs">{progress.error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          {!rendering && !isDone && (
            <>
              <Button variant="ghost" size="sm" onClick={handleClose}>
                {isRu ? "Отмена" : "Cancel"}
              </Button>
              <Button
                variant="hero"
                size="sm"
                onClick={handleRender}
                disabled={!fileName.trim() || clips.length === 0}
                className="gap-1.5"
              >
                <FileAudio className="h-3.5 w-3.5" />
                {isRu ? "Начать рендер" : "Start Render"}
              </Button>
            </>
          )}
          {isDone && (
            <Button variant="ghost" size="sm" onClick={handleClose}>
              {isRu ? "Закрыть" : "Close"}
            </Button>
          )}
          {isError && (
            <>
              <Button variant="ghost" size="sm" onClick={handleClose}>
                {isRu ? "Закрыть" : "Close"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleRender}>
                {isRu ? "Повторить" : "Retry"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
