/**
 * ModelDownloadPanel — ONNX model list with download/clear controls.
 * Extracted from BookerProSection for maintainability.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Cpu, Download, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import {
  VC_MODEL_REGISTRY, VC_PITCH_MODELS, VC_ALL_MODELS,
  downloadAllModels, getModelStatus, getTotalModelSize, clearAllModels,
  VC_MODEL_CACHE_EVENT, type ModelDownloadProgress,
} from "@/lib/vcModelCache";

interface ModelDownloadPanelProps {
  isRu: boolean;
  modelsReady: boolean;
  setModelsReady: (v: boolean) => void;
  setEnabled: (v: boolean) => void;
  gpuChecking: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function ModelDownloadPanel({
  isRu, modelsReady, setModelsReady, setEnabled, gpuChecking,
}: ModelDownloadPanelProps) {
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadLabel, setDownloadLabel] = useState("");
  const [modelStatuses, setModelStatuses] = useState<Record<string, boolean>>({});
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const totalSize = getTotalModelSize();

  // Check cached model status on mount and when cache changes
  // NOTE: modelsReady intentionally NOT in deps to avoid race conditions
  // where refreshStatuses toggles modelsReady, causing re-runs.
  const modelsReadyRef = useRef(modelsReady);
  modelsReadyRef.current = modelsReady;

  useEffect(() => {
    let cancelled = false;

    const refreshStatuses = async () => {
      const status = await getModelStatus();
      if (cancelled) return;
      setModelStatuses(status);
      const allReady = VC_MODEL_REGISTRY.every(m => status[m.id]);
      if (allReady !== modelsReadyRef.current) {
        setModelsReady(allReady);
      }
    };

    const handleCacheChange = () => { void refreshStatuses(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshStatuses();
    };

    void refreshStatuses();
    window.addEventListener(VC_MODEL_CACHE_EVENT, handleCacheChange);
    window.addEventListener("focus", handleCacheChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener(VC_MODEL_CACHE_EVENT, handleCacheChange);
      window.removeEventListener("focus", handleCacheChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [setModelsReady]);

  const handleDownloadModels = useCallback(async () => {
    const ac = new AbortController();
    setAbortController(ac);
    setDownloading(true);
    setDownloadProgress(0);

    let completedBytes = 0;
    const completedModels = new Set<string>();

    const onProgress = (p: ModelDownloadProgress) => {
      if (p.phase === "done" && !completedModels.has(p.modelId)) {
        completedModels.add(p.modelId);
        completedBytes += p.bytesTotal;
      }
      const currentBytes = p.phase === "done" ? completedBytes : completedBytes + p.bytesLoaded;
      setDownloadProgress(Math.round((currentBytes / totalSize) * 100));

      if (p.phase === "downloading") {
        const pct = Math.round(p.fraction * 100);
        setDownloadLabel(`${p.label} — ${pct}% (${formatBytes(p.bytesLoaded)})`);
      } else if (p.phase === "writing") {
        setDownloadLabel(isRu ? `${p.label} — запись в кэш...` : `${p.label} — caching...`);
      } else if (p.phase === "done") {
        setModelStatuses(prev => ({ ...prev, [p.modelId]: true }));
      } else if (p.phase === "error") {
        setDownloadLabel(
          isRu ? `Ошибка: ${p.label} — ${p.error}` : `Error: ${p.label} — ${p.error}`,
        );
      }
    };

    try {
      const allOk = await downloadAllModels(onProgress, ac.signal);
      if (allOk) { setModelsReady(true); setDownloadLabel(""); }
    } catch (err) {
      console.error("Model download error:", err);
    } finally {
      setDownloading(false);
      setAbortController(null);
    }
  }, [isRu, totalSize, setModelsReady]);

  const handleCancelDownload = useCallback(() => {
    abortController?.abort();
    setDownloading(false);
    setDownloadLabel(isRu ? "Отменено" : "Cancelled");
  }, [abortController, isRu]);

  const handleClearModels = useCallback(async () => {
    await clearAllModels();
    setModelStatuses({});
    setModelsReady(false);
    setEnabled(false);
  }, [setModelsReady, setEnabled]);

  const cachedCount = VC_ALL_MODELS.filter(m => modelStatuses[m.id]).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{isRu ? "ONNX модели" : "ONNX Models"}</span>
          <span className="text-xs text-muted-foreground">
            ({cachedCount}/{VC_ALL_MODELS.length})
          </span>
        </div>
        {modelsReady ? (
          <div className="flex items-center gap-2">
            <Badge className="bg-primary/20 text-primary border-primary/50 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {isRu ? "Готовы" : "Ready"}
            </Badge>
            <Button
              variant="ghost" size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              onClick={handleClearModels}
              title={isRu ? "Удалить модели" : "Clear models"}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            ~{formatBytes(totalSize)}
          </Badge>
        )}
      </div>

      {/* Per-model status list */}
      <div className="space-y-1">
        {VC_MODEL_REGISTRY.map(m => (
          <div key={m.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-muted/20">
            <span className="text-muted-foreground font-mono">{m.label}</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{formatBytes(m.sizeBytes)}</span>
              {modelStatuses[m.id]
                ? <CheckCircle2 className="h-3 w-3 text-primary" />
                : <XCircle className="h-3 w-3 text-muted-foreground/50" />
              }
            </div>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground pt-1 px-2">
          {isRu ? "Алгоритмы определения тона (F0)" : "Pitch Detection (F0)"}
        </p>
        {VC_PITCH_MODELS.map(m => (
          <div key={m.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-muted/20">
            <span className="text-muted-foreground font-mono">{m.label}</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{formatBytes(m.sizeBytes)}</span>
              {modelStatuses[m.id]
                ? <CheckCircle2 className="h-3 w-3 text-primary" />
                : <XCircle className="h-3 w-3 text-muted-foreground/50" />
              }
            </div>
          </div>
        ))}
      </div>

      {downloading && (
        <div className="space-y-2">
          <Progress value={downloadProgress} className="h-2" />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{downloadLabel}</p>
            <Button
              variant="ghost" size="sm"
              className="h-6 text-xs text-destructive"
              onClick={handleCancelDownload}
            >
              {isRu ? "Отмена" : "Cancel"}
            </Button>
          </div>
        </div>
      )}

      {!modelsReady && !downloading && (
        <Button
          onClick={handleDownloadModels}
          disabled={gpuChecking}
          variant="outline"
          className="w-full"
        >
          <Download className="h-4 w-4 mr-2" />
          {isRu
            ? `Скачать ONNX модели (~${formatBytes(totalSize)})`
            : `Download ONNX models (~${formatBytes(totalSize)})`}
        </Button>
      )}
    </div>
  );
}
