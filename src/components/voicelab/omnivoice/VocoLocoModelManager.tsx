/**
 * VocoLocoModelManager — UI for the 5-file local stack (Higgs Encoder +
 * Decoder + 3 LLM quant variants).
 *
 * Per-model row: name, role badge, size, status icon, download/delete button.
 * One global progress bar surfaces the active download.
 *
 * The selected LLM variant is owned by the parent (so the rest of the panel
 * can show "ready / not ready" against the user's pick).
 */
import { CheckCircle2, Cpu, Download, Loader2, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  VOCOLOCO_DECODER,
  VOCOLOCO_ENCODER,
  VOCOLOCO_LLM_VARIANTS,
  type VocoLocoModelEntry,
} from "@/lib/vocoloco/modelRegistry";
import type { VocoLocoDownloadProgress } from "@/lib/vocoloco/modelCache";

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

interface Props {
  isRu: boolean;
  statuses: Record<string, boolean>;
  llmModelId: string;
  onLlmModelChange: (id: string) => void;
  downloading: string | null;
  downloadProgress: VocoLocoDownloadProgress | null;
  onDownload: (entry: VocoLocoModelEntry) => void;
  onDelete: (entry: VocoLocoModelEntry) => void;
  onCancel: () => void;
}

function ModelRow({
  isRu, entry, cached, isDownloading, progress, onDownload, onDelete, disabled,
}: {
  isRu: boolean;
  entry: VocoLocoModelEntry;
  cached: boolean;
  isDownloading: boolean;
  progress: VocoLocoDownloadProgress | null;
  onDownload: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/20 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono truncate">{entry.label}</span>
          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 uppercase">
            {entry.role}
          </Badge>
          {entry.quant && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 uppercase">
              {entry.quant}
            </Badge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground truncate">{entry.description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {formatBytes(entry.sizeBytes)}
        </span>
        {cached ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
            <Button
              size="sm" variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              title={isRu ? "Удалить из кэша" : "Remove from cache"}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </>
        ) : isDownloading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
        ) : (
          <>
            <XCircle className="w-3.5 h-3.5 text-muted-foreground/50" />
            <Button
              size="sm" variant="outline"
              className="h-6 px-2 text-[10px]"
              onClick={onDownload}
              disabled={disabled}
            >
              <Download className="w-3 h-3 mr-1" />
              {isRu ? "Скачать" : "Get"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function VocoLocoModelManager({
  isRu, statuses, llmModelId, onLlmModelChange,
  downloading, downloadProgress, onDownload, onDelete, onCancel,
}: Props) {
  const anyDownloading = downloading !== null;

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          {isRu ? "Локальные модели VocoLoco" : "VocoLoco local models"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">
          {isRu
            ? "Полный стек ~1.4 ГБ (encoder + decoder + один LLM-квант). Voice Design не требует encoder."
            : "Full stack ~1.4 GB (encoder + decoder + one LLM quant). Voice Design does not need the encoder."}
        </p>

        <ModelRow
          isRu={isRu}
          entry={VOCOLOCO_DECODER}
          cached={!!statuses[VOCOLOCO_DECODER.id]}
          isDownloading={downloading === VOCOLOCO_DECODER.id}
          progress={downloadProgress}
          onDownload={() => onDownload(VOCOLOCO_DECODER)}
          onDelete={() => onDelete(VOCOLOCO_DECODER)}
          disabled={anyDownloading}
        />
        <ModelRow
          isRu={isRu}
          entry={VOCOLOCO_ENCODER}
          cached={!!statuses[VOCOLOCO_ENCODER.id]}
          isDownloading={downloading === VOCOLOCO_ENCODER.id}
          progress={downloadProgress}
          onDownload={() => onDownload(VOCOLOCO_ENCODER)}
          onDelete={() => onDelete(VOCOLOCO_ENCODER)}
          disabled={anyDownloading}
        />

        <div className="space-y-1.5 pt-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {isRu ? "Квант LLM" : "LLM quantization"}
          </Label>
          <Select value={llmModelId} onValueChange={onLlmModelChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOCOLOCO_LLM_VARIANTS.map((v) => (
                <SelectItem key={v.id} value={v.id} className="text-xs">
                  {v.label} — {formatBytes(v.sizeBytes)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {VOCOLOCO_LLM_VARIANTS.map((v) => (
          v.id === llmModelId ? (
            <ModelRow
              key={v.id}
              isRu={isRu}
              entry={v}
              cached={!!statuses[v.id]}
              isDownloading={downloading === v.id}
              progress={downloadProgress}
              onDownload={() => onDownload(v)}
              onDelete={() => onDelete(v)}
              disabled={anyDownloading}
            />
          ) : null
        ))}

        {downloadProgress && (
          <div className="space-y-1">
            <Progress value={Math.round(downloadProgress.fraction * 100)} className="h-1.5" />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                {downloadProgress.label} — {downloadProgress.phase}
                {downloadProgress.phase === "downloading" &&
                  ` (${formatBytes(downloadProgress.bytesLoaded)} / ${formatBytes(downloadProgress.bytesTotal)})`}
              </span>
              {anyDownloading && (
                <Button
                  variant="ghost" size="sm"
                  className="h-5 px-2 text-[10px] text-destructive"
                  onClick={onCancel}
                >
                  {isRu ? "Отмена" : "Cancel"}
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
