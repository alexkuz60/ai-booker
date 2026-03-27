import { Loader2, CloudUpload, Download, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCallback, useRef, useState } from "react";
import {
  SyncProgressDialog,
  buildSyncSteps,
  type SyncStep,
  type SyncProgressCallback,
} from "@/components/SyncProgressDialog";

interface SaveBookButtonProps {
  isRu: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick: (onProgress?: SyncProgressCallback, opts?: { syncAtmo?: boolean }) => void | Promise<void>;
  showDownloadZip?: boolean;
  onDownloadZip?: () => void | Promise<void>;
  showImportZip?: boolean;
  onImportZip?: (file: File) => void | Promise<void>;
}

export function SaveBookButton({
  isRu,
  loading = false,
  disabled = false,
  onClick,
  showDownloadZip,
  onDownloadZip,
  showImportZip,
  onImportZip,
}: SaveBookButtonProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [syncAtmo, setSyncAtmo] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [steps, setSteps] = useState<SyncStep[]>([]);
  const [phase, setPhase] = useState<"confirm" | "running" | "done" | "error">("confirm");
  const [errorMessage, setErrorMessage] = useState<string>();

  const handleOpenDialog = useCallback(() => {
    setSteps(buildSyncSteps(isRu));
    setPhase("confirm");
    setErrorMessage(undefined);
    setDialogOpen(true);
  }, [isRu]);

  const handleProgress: SyncProgressCallback = useCallback(
    (stepId, status, detail) => {
      setSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, status, detail: detail ?? s.detail } : s)),
      );
    },
    [],
  );

  const handleConfirm = useCallback(async () => {
    setPhase("running");
    try {
      await onClick(handleProgress, { syncAtmo });
      setPhase("done");
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [onClick, handleProgress, syncAtmo]);

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="secondary"
        size="sm"
        onClick={handleOpenDialog}
        disabled={disabled || loading}
        className="gap-1.5"
        title={isRu ? "Синхронизировать на сервер (для доступа с других устройств)" : "Sync to server (for cross-device access)"}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
        {isRu ? "На сервер" : "Sync"}
      </Button>

      <SyncProgressDialog
        isRu={isRu}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConfirm={handleConfirm}
        steps={steps}
        phase={phase}
        errorMessage={errorMessage}
        confirmOptions={confirmOptions}
      />

      {showDownloadZip && onDownloadZip && (
        <Button
          variant="outline"
          size="sm"
          onClick={onDownloadZip}
          disabled={disabled || loading}
          className="gap-1.5"
          title={isRu ? "Скачать проект как ZIP" : "Download project as ZIP"}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      )}

      {showImportZip && onImportZip && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            className="gap-1.5"
            title={isRu ? "Открыть проект из ZIP" : "Open project from ZIP"}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportZip(file);
              e.target.value = "";
            }}
          />
        </>
      )}
    </div>
  );
}
