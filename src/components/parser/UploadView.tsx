import { RefObject } from "react";
import { motion } from "framer-motion";
import { Upload, FolderOpen, FolderPlus, HardDrive, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { t } from "@/pages/parser/i18n";
import { type StorageBackend } from "@/lib/projectStorage";

interface UploadViewProps {
  isRu: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Local-first: storage backend available */
  storageBackend?: StorageBackend;
  /** Create new local project */
  onCreateLocalProject?: () => void;
  /** Open existing local project */
  onOpenLocalProject?: () => void;
}

export default function UploadView({
  isRu,
  fileInputRef,
  onFileSelect,
  storageBackend = "none",
  onCreateLocalProject,
  onOpenLocalProject,
}: UploadViewProps) {
  const hasLocalStorage = storageBackend !== "none";

  return (
    <motion.div
      key="upload"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex-1 flex items-center justify-center h-full"
    >
      <div className="flex flex-col items-center gap-6 w-full max-w-lg">
        {/* ── Cloud Upload card (existing) ── */}
        <Card
          className="w-full cursor-pointer border-dashed border-2 hover:border-primary/50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <CardContent className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="h-16 w-16 rounded-2xl gradient-cyan flex items-center justify-center shadow-cool">
              <Upload className="h-8 w-8 text-primary-foreground" />
            </div>
            <div className="text-center">
              <p className="font-display font-semibold text-lg text-foreground">
                {t("uploadTitle", isRu)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {t("uploadHint", isRu)}
              </p>
            </div>
            <Button variant="outline" size="lg">
              <Upload className="h-4 w-4 mr-2" />
              {t("selectFile", isRu)}
            </Button>
          </CardContent>
        </Card>

        {/* ── Local Project section ── */}
        {hasLocalStorage && (
          <>
            <div className="flex items-center gap-3 w-full">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground font-body uppercase tracking-wider">
                {isRu ? "Локальный проект" : "Local Project"}
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <div className="flex items-center gap-3 w-full">
              {onCreateLocalProject && (
                <Card
                  className="flex-1 cursor-pointer border hover:border-accent transition-colors"
                  onClick={onCreateLocalProject}
                >
                  <CardContent className="flex flex-col items-center justify-center py-6 gap-3">
                    <div className="h-11 w-11 rounded-xl bg-accent/20 flex items-center justify-center">
                      <FolderPlus className="h-5 w-5 text-accent-foreground" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">
                        {isRu ? "Новый проект" : "New Project"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {isRu ? "Создать папку на диске" : "Create folder on disk"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {onOpenLocalProject && (
                <Card
                  className="flex-1 cursor-pointer border hover:border-accent transition-colors"
                  onClick={onOpenLocalProject}
                >
                  <CardContent className="flex flex-col items-center justify-center py-6 gap-3">
                    <div className="h-11 w-11 rounded-xl bg-accent/20 flex items-center justify-center">
                      <FolderOpen className="h-5 w-5 text-accent-foreground" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">
                        {isRu ? "Открыть проект" : "Open Project"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {isRu ? "Выбрать существующую папку" : "Select existing folder"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {storageBackend === "fs-access" ? (
                <Monitor className="h-3 w-3 text-muted-foreground" />
              ) : (
                <HardDrive className="h-3 w-3 text-muted-foreground" />
              )}
              <span className="text-[10px] text-muted-foreground font-mono">
                {storageBackend === "fs-access"
                  ? (isRu ? "File System Access API" : "File System Access API")
                  : (isRu ? "OPFS (браузерное хранилище)" : "OPFS (browser storage)")}
              </span>
            </div>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={onFileSelect}
      />
    </motion.div>
  );
}
