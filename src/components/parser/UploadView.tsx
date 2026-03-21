import { RefObject, useState } from "react";
import { motion } from "framer-motion";
import { Upload, FolderPlus, HardDrive, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/pages/parser/i18n";
import { type StorageBackend } from "@/lib/projectStorage";

interface UploadViewProps {
  isRu: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  storageBackend?: StorageBackend;
  /** Called with project name when user clicks "Select file" */
  onCreateWithFile?: (projectName: string) => void;
  /** Called when user cancels (goes back to library) */
  onCancel?: () => void;
}

export default function UploadView({
  isRu,
  fileInputRef,
  onFileSelect,
  storageBackend = "none",
  onCreateWithFile,
  onCancel,
}: UploadViewProps) {
  const hasLocalStorage = storageBackend !== "none";
  const [projectName, setProjectName] = useState("");

  const handleSelectFile = () => {
    if (hasLocalStorage && onCreateWithFile && projectName.trim()) {
      onCreateWithFile(projectName.trim());
    }
    fileInputRef.current?.click();
  };

  return (
    <motion.div
      key="upload"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex-1 flex items-center justify-center h-full"
    >
      <div className="flex flex-col items-center gap-6 w-full max-w-md">
        <Card className="w-full border-2 border-dashed hover:border-primary/30 transition-colors">
          <CardContent className="flex flex-col items-center py-8 gap-5">
            {/* Icon + title */}
            <div className="h-14 w-14 rounded-2xl gradient-cyan flex items-center justify-center shadow-cool">
              <FolderPlus className="h-7 w-7 text-primary-foreground" />
            </div>
            <p className="font-display font-semibold text-lg text-foreground">
              {isRu ? "Новый проект" : "New Project"}
            </p>

            {/* Project name input */}
            {hasLocalStorage && (
              <div className="w-full space-y-1.5">
                <Label htmlFor="new-proj-name" className="text-xs text-muted-foreground">
                  {isRu ? "Название проекта" : "Project name"}
                </Label>
                <Input
                  id="new-proj-name"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder={isRu ? "Моя книга" : "My Book"}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && projectName.trim()) {
                      e.preventDefault();
                      handleSelectFile();
                    }
                  }}
                />
              </div>
            )}

            {/* File upload section */}
            <div className="w-full border border-border rounded-lg p-4 flex flex-col items-center gap-3 bg-muted/30">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">
                  {t("uploadTitle", isRu)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("uploadHint", isRu)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectFile}
                disabled={hasLocalStorage && !projectName.trim()}
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                {t("selectFile", isRu)}
              </Button>
            </div>

            {/* Storage backend indicator */}
            {hasLocalStorage && (
              <div className="flex items-center gap-1.5">
                {storageBackend === "fs-access" ? (
                  <Monitor className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <HardDrive className="h-3 w-3 text-muted-foreground" />
                )}
                <span className="text-[10px] text-muted-foreground font-mono">
                  {storageBackend === "fs-access"
                    ? "File System Access API"
                    : (isRu ? "OPFS (браузерное хранилище)" : "OPFS (browser storage)")}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </motion.div>
  );
}
