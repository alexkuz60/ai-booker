import { useState, useRef, useCallback } from "react";
import { Download, Upload, Loader2, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import type { ProjectStorage } from "@/lib/projectStorage";
import {
  exportAudioZip,
  importAudioZip,
  downloadAudioZip,
  type AudioZipProgress,
} from "@/lib/audioZip";

interface AudioZipControlsProps {
  storage: ProjectStorage | null;
  projectName?: string;
  isRu: boolean;
}

export function AudioZipControls({ storage, projectName, isRu }: AudioZipControlsProps) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(async () => {
    if (!storage) return;
    setExporting(true);
    setDialogOpen(true);
    setProgressPct(0);
    setProgressLabel(isRu ? "Сбор аудиофайлов…" : "Collecting audio files…");

    try {
      const blob = await exportAudioZip(storage, (p: AudioZipProgress) => {
        if (p.phase === "collecting") {
          setProgressPct(20);
          setProgressLabel(isRu ? "Сбор аудиофайлов…" : "Collecting audio files…");
        } else if (p.phase === "zipping") {
          setProgressPct(60);
          setProgressLabel(
            isRu
              ? `Упаковка ${p.fileCount} файлов…`
              : `Packing ${p.fileCount} files…`,
          );
        } else {
          setProgressPct(100);
          setProgressLabel(
            isRu
              ? `Готово! ${p.fileCount} файлов`
              : `Done! ${p.fileCount} files`,
          );
        }
      });

      downloadAudioZip(blob, projectName || "project");
      toast.success(
        isRu ? "Аудио-архив скачан" : "Audio archive downloaded",
      );
    } catch (err: any) {
      console.error("[AudioZip] Export error:", err);
      toast.error(
        isRu
          ? `Ошибка экспорта: ${err.message}`
          : `Export error: ${err.message}`,
      );
    } finally {
      setExporting(false);
      setTimeout(() => setDialogOpen(false), 800);
    }
  }, [storage, projectName, isRu]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !storage) return;
      // Reset input so same file can be re-selected
      e.target.value = "";

      setImporting(true);
      setDialogOpen(true);
      setProgressPct(0);
      setProgressLabel(isRu ? "Распаковка архива…" : "Unpacking archive…");

      try {
        const count = await importAudioZip(storage, file, (written, total) => {
          const pct = Math.round((written / total) * 100);
          setProgressPct(pct);
          setProgressLabel(
            isRu
              ? `Записано ${written} из ${total} файлов`
              : `Written ${written} of ${total} files`,
          );
        });

        setProgressPct(100);
        setProgressLabel(
          isRu ? `Готово! ${count} файлов` : `Done! ${count} files`,
        );

        toast.success(
          isRu
            ? `Импортировано ${count} аудиофайлов`
            : `Imported ${count} audio files`,
        );
      } catch (err: any) {
        console.error("[AudioZip] Import error:", err);
        toast.error(
          isRu
            ? `Ошибка импорта: ${err.message}`
            : `Import error: ${err.message}`,
        );
      } finally {
        setImporting(false);
        setTimeout(() => setDialogOpen(false), 800);
      }
    },
    [storage, isRu],
  );

  const busy = exporting || importing;

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExport}
          disabled={!storage || busy}
          title={isRu ? "Экспорт аудио (ZIP)" : "Export audio (ZIP)"}
          className="h-8 gap-1.5 text-xs"
        >
          {exporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          <Music className="h-3 w-3" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleImportClick}
          disabled={!storage || busy}
          title={isRu ? "Импорт аудио (ZIP)" : "Import audio (ZIP)"}
          className="h-8 gap-1.5 text-xs"
        >
          {importing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          <Music className="h-3 w-3" />
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={handleFileSelected}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {exporting
                ? (isRu ? "Экспорт аудио" : "Audio Export")
                : (isRu ? "Импорт аудио" : "Audio Import")}
            </DialogTitle>
            <DialogDescription>{progressLabel}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Progress value={progressPct} className="h-3" />
            <p className="text-xs text-muted-foreground mt-2 text-center">
              {progressPct}%
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              disabled={busy}
            >
              {isRu ? "Закрыть" : "Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
