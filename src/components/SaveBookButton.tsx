import { Loader2, CloudUpload, Download, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRef } from "react";

interface SaveBookButtonProps {
  isRu: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void | Promise<void>;
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

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="secondary"
        size="sm"
        onClick={onClick}
        disabled={disabled || loading}
        className="gap-1.5"
        title={isRu ? "Синхронизировать на сервер (для доступа с других устройств)" : "Sync to server (for cross-device access)"}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
        {isRu ? "На сервер" : "Sync"}
      </Button>

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
