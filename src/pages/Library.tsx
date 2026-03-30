import { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { usePageHeader } from "@/hooks/usePageHeader";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { useBookManager } from "@/hooks/useBookManager";
import {
  SyncProgressDialog,
  buildRestoreSteps,
  type SyncStep,
  type SyncProgressCallback,
} from "@/components/SyncProgressDialog";
import LibraryView from "@/components/parser/LibraryView";
import UploadView from "@/components/parser/UploadView";
import { ExtractingTocView, ErrorView } from "@/components/parser/StatusViews";
import type { BookRecord } from "@/pages/parser/types";

export default function Library() {
  const { user } = useAuth();
  const { isRu } = useLanguage();
  const { setPageHeader } = usePageHeader();
  const navigate = useNavigate();

  const {
    backend: storageBackend,
    createProject,
    openProjectByName,
    storage: projectStorage,
    initialized: projectStorageInitialized,
    bumpProgressVersion,
  } = useProjectStorageContext();

  const [pendingProjectName, setPendingProjectName] = useState<string | null>(null);

  const {
    step, setStep, books, loadingLibrary, fileName, errorMsg, uploadProgress,
    fileInputRef, handleFileSelect,
    openSavedBook, deleteBook, clearAllProjects, renameBook,
    reloadLibrary,
    serverBooks, loadingServerBooks, deleteServerBook,
    progressMap, setProgressMap,
  } = useBookManager({
    userId: user?.id,
    isRu,
    projectStorage,
    projectStorageInitialized,
    storageBackend,
    createProject,
    openProjectByName,
    pendingProjectName,
    bumpProgressVersion,
  });

  // ── Navigate to Parser only after a NEW book open/upload action ──
  const [shouldRedirect, setShouldRedirect] = useState(false);

  useEffect(() => {
    if (shouldRedirect && step === "workspace") {
      setShouldRedirect(false);
      navigate("/parser");
    }
  }, [step, shouldRedirect, navigate]);

  // ── Restore-from-server progress dialog ──
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoreSteps, setRestoreSteps] = useState<SyncStep[]>([]);
  const [restorePhase, setRestorePhase] = useState<"confirm" | "running" | "done" | "error">("confirm");
  const [restoreError, setRestoreError] = useState<string>();
  const [restoreTargetBook, setRestoreTargetBook] = useState<BookRecord | null>(null);
  const [restoreDownloadIr, setRestoreDownloadIr] = useState(true);
  const [restoreDownloadAtmo, setRestoreDownloadAtmo] = useState(true);
  const [restoreDownloadSfx, setRestoreDownloadSfx] = useState(true);

  const handleRestoreClick = useCallback((book: BookRecord) => {
    setRestoreTargetBook(book);
    setRestoreSteps(buildRestoreSteps(isRu));
    setRestorePhase("confirm");
    setRestoreError(undefined);
    setRestoreDialogOpen(true);
  }, [isRu]);

  const handleRestoreProgress: SyncProgressCallback = useCallback(
    (stepId, status, detail) => {
      setRestoreSteps(prev =>
        prev.map(s => s.id === stepId ? { ...s, status, detail: detail ?? s.detail } : s),
      );
    },
    [],
  );

  const handleRestoreConfirm = useCallback(async () => {
    if (!restoreTargetBook) return;
    setRestorePhase("running");
    try {
      await openSavedBook(restoreTargetBook, {
        skipTimestampCheck: true,
        downloadImpulses: restoreDownloadIr,
        downloadAtmosphere: restoreDownloadAtmo,
        downloadSfx: restoreDownloadSfx,
      }, undefined, undefined, handleRestoreProgress);
      setRestorePhase("done");
      // After restore completes, navigate to parser
      navigate("/parser");
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : String(e));
      setRestorePhase("error");
    }
  }, [restoreTargetBook, openSavedBook, handleRestoreProgress, restoreDownloadIr, restoreDownloadAtmo, restoreDownloadSfx, navigate]);

  const handleReset = useCallback(() => {
    setStep("library");
    setPendingProjectName(null);
  }, [setStep]);

  const startNewProject = useCallback(() => {
    setShouldRedirect(true);
    setStep("upload");
  }, [setStep]);

  const handleOpenBook = useCallback((book: BookRecord) => {
    setShouldRedirect(true);
    openSavedBook(book);
  }, [openSavedBook]);

  /** Timeline stage click: open book then navigate to the stage's route */
  const handleStageNavigate = useCallback((book: BookRecord, route: string) => {
    // Open the book, then navigate to the target route
    (async () => {
      await openSavedBook(book);
      navigate(route);
    })();
  }, [openSavedBook, navigate]);

  /** Project reset: re-upload the book file (wipe progress) */
  const handleProjectReset = useCallback((book: BookRecord) => {
    // Delete and start fresh upload
    (async () => {
      await deleteBook(book.id);
      startNewProject();
    })();
  }, [deleteBook, startNewProject]);

  // ── Page header ──
  useEffect(() => {
    setPageHeader({
      title: isRu ? "Библиотека" : "Library",
      subtitle: isRu ? "Ваши книги и проекты" : "Your books and projects",
    });
    return () => setPageHeader({});
  }, [isRu, setPageHeader]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col h-full">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.doc,.fb2"
        className="hidden"
        onChange={handleFileSelect}
      />

      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {(step === "library" || step === "workspace") && (
            <LibraryView
              isRu={isRu} books={books} loadingLibrary={loadingLibrary}
              onUpload={startNewProject} onOpen={handleOpenBook} onDelete={deleteBook}
              onClearAll={clearAllProjects} onRename={renameBook}
              serverBooks={serverBooks} loadingServerBooks={loadingServerBooks}
              onOpenServerBook={handleRestoreClick} onDeleteServerBook={deleteServerBook}
              onStageNavigate={handleStageNavigate}
              onProjectReset={handleProjectReset}
            />
          )}
          {step === "upload" && (
            <UploadView
              isRu={isRu}
              fileInputRef={fileInputRef}
              onFileSelect={handleFileSelect}
              storageBackend={storageBackend}
              onCreateWithFile={(name) => setPendingProjectName(name)}
              onCancel={handleReset}
            />
          )}
          {step === "extracting_toc" && (
            <ExtractingTocView fileName={fileName} isRu={isRu} uploadProgress={uploadProgress} />
          )}
          {step === "error" && (
            <ErrorView errorMsg={errorMsg} isRu={isRu} onReset={handleReset} />
          )}
        </AnimatePresence>
      </div>

      <SyncProgressDialog
        isRu={isRu}
        open={restoreDialogOpen}
        onOpenChange={setRestoreDialogOpen}
        onConfirm={handleRestoreConfirm}
        steps={restoreSteps}
        phase={restorePhase}
        errorMessage={restoreError}
        mode="restore"
        confirmOptions={[
          {
            id: "download_ir",
            label: isRu ? "Загрузить импульсы реверберации (IR)" : "Download reverb impulses (IR)",
            checked: restoreDownloadIr,
            onChange: setRestoreDownloadIr,
          },
          {
            id: "download_atmo",
            label: isRu ? "Загрузить звуки атмосферы" : "Download atmosphere sounds",
            checked: restoreDownloadAtmo,
            onChange: setRestoreDownloadAtmo,
          },
          {
            id: "download_sfx",
            label: isRu ? "Загрузить звуковые эффекты (SFX)" : "Download sound effects (SFX)",
            checked: restoreDownloadSfx,
            onChange: setRestoreDownloadSfx,
          },
        ]}
      />
    </motion.div>
  );
}
