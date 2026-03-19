import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useUserApiKeys } from "@/hooks/useUserApiKeys";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Library, PlusCircle, Network, Users, RefreshCw } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAiRoles } from "@/hooks/useAiRoles";
import { useLanguage } from "@/hooks/useLanguage";
import { usePageHeader } from "@/hooks/usePageHeader";
import { t } from "@/pages/parser/i18n";
import { NAV_WIDTH_KEY, NAV_STATE_KEY } from "@/pages/parser/types";
import type { Scene, ChapterStatus, TocChapter } from "@/pages/parser/types";
import type { AiRoleId } from "@/config/aiRoles";
import { useToast } from "@/hooks/use-toast";
import { useChapterAnalysis } from "@/hooks/useChapterAnalysis";
import { useBookManager } from "@/hooks/useBookManager";
import { useParserHelpers } from "@/hooks/useParserHelpers";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { useSaveBookToProject } from "@/hooks/useSaveBookToProject";
import { useImperativeSave } from "@/hooks/useImperativeSave";
import { useParserCharacters } from "@/hooks/useParserCharacters";
import { useTocMutations } from "@/hooks/useTocMutations";

import LibraryView from "@/components/parser/LibraryView";
import UploadView from "@/components/parser/UploadView";
import { ExtractingTocView, ErrorView } from "@/components/parser/StatusViews";
import NavSidebar from "@/components/parser/NavSidebar";
import ChapterDetailPanel from "@/components/parser/ChapterDetailPanel";
import { AiRolesTab } from "@/components/profile/tabs/AiRolesTab";
import { SaveBookButton } from "@/components/SaveBookButton";
import ParserCharactersPanel from "@/components/parser/ParserCharactersPanel";

export default function Parser() {
  const { user } = useAuth();
  const { isRu } = useLanguage();
  const { setPageHeader } = usePageHeader();
  const navigate = useNavigate();
  const location = useLocation();

  const userApiKeys = useUserApiKeys();
  const [aiRolesOpen, setAiRolesOpen] = useState(false);
  const [parserTab, setParserTab] = useState<"structure" | "characters">("structure");
  const [pendingProjectName, setPendingProjectName] = useState<string | null>(null);
  const {
    backend: storageBackend,
    createProject,
    openProjectByName,
    storage: projectStorage,
    initialized: projectStorageInitialized,
    meta: projectMeta,
    hardResetLocalData,
  } = useProjectStorageContext();
  const { getModelForRole, getEffectivePool } = useAiRoles(userApiKeys);
  const { toast } = useToast();
  const [navRestoredFromStorage] = useState<boolean>(() => {
    try {
      const saved = sessionStorage.getItem(NAV_STATE_KEY);
      return !!saved;
    } catch { return false; }
  });
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => {
    try {
      const saved = sessionStorage.getItem(NAV_STATE_KEY);
      if (saved) { const p = JSON.parse(saved); return new Set(p.selected || []); }
    } catch {}
    return new Set();
  });
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(() => {
    try {
      const saved = sessionStorage.getItem(NAV_STATE_KEY);
      if (saved) { const p = JSON.parse(saved); return p.lastClicked ?? null; }
    } catch {}
    return null;
  });
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem(NAV_STATE_KEY);
      if (saved) { const p = JSON.parse(saved); return new Set(p.expanded || []); }
    } catch {}
    return new Set();
  });

  const {
    step, setStep, books, loadingLibrary, fileName, errorMsg, bookId, uploadProgress,
    chapterIdMap, setChapterIdMap, tocEntries, setTocEntries, pdfRef, totalPages, file,
    partIdMap, chapterResults, setChapterResults, fileInputRef,
    openSavedBook, deleteBook, clearAllProjects, handleFileSelect, handleReset: bookReset, reloadBook, ensurePdfLoaded,
    reloadLibrary, renameBook,
    serverBooks, loadingServerBooks, deleteServerBook,
    serverNewerBookId, dismissServerNewer, acceptServerVersion,
  } = useBookManager({ userId: user?.id, isRu, projectStorage, projectStorageInitialized, storageBackend, createProject, openProjectByName, pendingProjectName });

  const {
    characters, extracting, extractProgress, extractPoolStats, extractCharacters,
    profiling, profileProgress, profilePoolStats, profileCharacters,
    renameCharacter, updateGender, updateAliases, deleteCharacter, mergeCharacters, addCharacter,
  } = useParserCharacters({
    storage: projectStorage,
    tocEntries,
    chapterResults,
    bookId,
    profilerModel: getModelForRole("profiler"),
    userApiKeys,
    isRu,
    effectivePool: getEffectivePool("profiler"),
  });

  const selectedIdx = selectedIndices.size === 1 ? Array.from(selectedIndices)[0] : null;

  const {
    selectedEntry, selectedResult, selectedChildCount,
    contentEntries, supplementaryEntries,
    analyzedCount, totalScenes,
    isChapterFullyDone, sendToStudio,
    partGroups, partlessIndices,
  } = useParserHelpers({ tocEntries, chapterResults, selectedIdx, fileName, bookId: bookId ?? undefined });

  const localPartsForSave = useMemo(() => {
    const seen = new Set<string>();
    const parts: Array<{ id: string; title: string; partNumber: number }> = [];

    for (const entry of tocEntries) {
      if (!entry.partTitle || seen.has(entry.partTitle)) continue;
      seen.add(entry.partTitle);
      parts.push({
        id: partIdMap.get(entry.partTitle) || "",
        title: entry.partTitle,
        partNumber: parts.length + 1,
      });
    }

    return parts;
  }, [tocEntries, partIdMap]);

  // ── Imperative auto-save ──
  const tocEntriesRef = useRef(tocEntries);
  const localPartsRef = useRef(localPartsForSave);
  const chapterIdMapRef = useRef(chapterIdMap);
  const chapterResultsRef = useRef(chapterResults);
  tocEntriesRef.current = tocEntries;
  localPartsRef.current = localPartsForSave;
  chapterIdMapRef.current = chapterIdMap;
  chapterResultsRef.current = chapterResults;

  const getLocalSnapshot = useCallback(() => ({
    toc: tocEntriesRef.current,
    parts: localPartsRef.current,
    chapterIdMap: chapterIdMapRef.current,
    chapterResults: chapterResultsRef.current,
  }), []);

  const { scheduleSave, flushSave } = useImperativeSave({
    storage: projectStorage,
    bookId,
    fileName,
    getSnapshot: getLocalSnapshot,
  });

  // ── TOC Mutations (extracted from Parser) ──
  const mutations = useTocMutations({
    tocEntries, setTocEntries,
    chapterIdMap, setChapterIdMap,
    chapterResults, setChapterResults,
    partIdMap,
    selectedIdx,
    setSelectedIndices,
    scheduleSave,
  });

  const { analysisLog, analyzeChapter, resetAnalysis, stopAnalysis, isAnalyzing } = useChapterAnalysis({
    isRu, pdfRef, userId: user?.id, bookId, userApiKeys, getModelForRole,
    tocEntries, chapterIdMap, chapterResults, setChapterResults,
    onChapterResultsMutated: scheduleSave,
    ensurePdfLoaded,
    fileFormat: projectMeta?.fileFormat || null,
    projectStorage,
  });

  // ── Flush pending auto-save on page unload ──
  const flushSaveRef = useRef(flushSave);
  flushSaveRef.current = flushSave;
  useEffect(() => {
    const handler = () => flushSaveRef.current();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const { saveBook, saving: savingBook, isProjectOpen, downloadZip, importZip } = useSaveBookToProject({
    isRu,
    currentBookId: bookId,
    fileName,
    localSnapshot: step === "workspace"
      ? {
          toc: tocEntries,
          parts: localPartsForSave,
          chapterIdMap,
          chapterResults,
        }
      : undefined,
  });

  // ── Warn when analysis-relevant models change ──
  const handleRoleModelChanged = useCallback((roleId: AiRoleId) => {
    if (roleId !== "screenwriter" && roleId !== "director") return;
    let count = 0;
    chapterResults.forEach((r) => { if (r.status === "done") count++; });
    if (count > 0) {
      toast({
        title: isRu ? "Модель изменена" : "Model changed",
        description: isRu
          ? `${count} гл. проанализированы прежней моделью. Используйте «Повторить» для обновления.`
          : `${count} ch. analyzed with previous model. Use "Reanalyze" to update.`,
        duration: 6000,
      });
    }
  }, [chapterResults, isRu, toast]);

  // ── Reset handler ──
  const handleReset = useCallback(() => {
    bookReset();
    setSelectedIndices(new Set());
    setLastClickedIdx(null);
    setExpandedNodes(new Set());
    setPendingProjectName(null);
    resetAnalysis();
    sessionStorage.removeItem(NAV_STATE_KEY);
  }, [bookReset, resetAnalysis]);

  const startNewProject = useCallback(() => {
    handleReset();
    setParserTab("structure");
    setStep("upload");
  }, [handleReset, setStep]);

  useEffect(() => {
    if (!new URLSearchParams(location.search).has("resetLocal")) return;

    let cancelled = false;

    void (async () => {
      await hardResetLocalData();
      if (cancelled) return;
      handleReset();
      setParserTab("structure");
      setStep("upload");
      navigate("/parser", { replace: true });
      toast({
        title: isRu ? "Локальное хранилище очищено" : "Local storage cleared",
        description: isRu
          ? "Все локальные проекты и кэш Парсера удалены из этого браузера."
          : "All local parser projects and caches were removed from this browser.",
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [location.search, hardResetLocalData, handleReset, navigate, isRu, toast, setStep]);

  // ── Page header ──
  const headerRight = useMemo(() => {
    const navButtons = (
      <div className="flex items-center gap-1">
        <Button
          variant={step === "library" ? "secondary" : "ghost"} size="sm"
          onClick={() => {
            if (step === "workspace") handleReset();
            else setStep("library");
            void reloadLibrary();
          }}
          className="gap-1.5 text-xs"
        >
          <Library className="h-3.5 w-3.5" />
          {isRu ? "Библиотека" : "Library"}
        </Button>
        {step === "library" && (
          <Button
            variant="ghost" size="sm"
            onClick={startNewProject}
            className="gap-1.5 text-xs"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            {isRu ? "Новая книга" : "New Book"}
          </Button>
        )}
        {step === "workspace" && (
          <Button
            variant="ghost" size="sm"
            onClick={reloadBook}
            className="gap-1.5 text-xs"
            title={isRu ? "Перезагрузить книгу (загрузить другую версию PDF)" : "Reload book (upload different PDF version)"}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {isRu ? "Перезагрузить" : "Reload"}
          </Button>
        )}

        {step === "workspace" && (
          <>
            <span className="w-px h-4 bg-border mx-1" />
            <Button
              variant={parserTab === "structure" ? "secondary" : "ghost"} size="sm"
              onClick={() => setParserTab("structure")}
              className="gap-1.5 text-xs"
            >
              <Network className="h-3.5 w-3.5" />
              {isRu ? "Структура" : "Structure"}
            </Button>
            <Button
              variant={parserTab === "characters" ? "secondary" : "ghost"} size="sm"
              onClick={() => setParserTab(parserTab === "characters" ? "structure" : "characters")}
              className="gap-1.5 text-xs"
            >
              <Users className="h-3.5 w-3.5" />
              {isRu ? "Персонажи" : "Characters"}
            </Button>
          </>
        )}
      </div>
    );

    if (step === "workspace") {
      return (
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground font-body">
            {analyzedCount}/{tocEntries.length} {t("chapters", isRu)} · {totalScenes} {t("scenes", isRu)}
          </div>
          {navButtons}
          <SaveBookButton
            isRu={isRu}
            onClick={saveBook}
            loading={savingBook}
            disabled={!bookId}
            showDownloadZip={isProjectOpen}
            onDownloadZip={downloadZip}
            showImportZip={!isProjectOpen}
            onImportZip={importZip}
          />
          <Button variant="ghost" size="sm" onClick={() => setAiRolesOpen(true)} className="gap-1.5">
            <Bot className="h-3.5 w-3.5" />
            {isRu ? "AI Роли" : "AI Roles"}
          </Button>
        </div>
      );
    }

    return navButtons;
  }, [step, isRu, analyzedCount, tocEntries.length, totalScenes, handleReset, setStep, parserTab, reloadBook, reloadLibrary, saveBook, savingBook, bookId, startNewProject]);

  useEffect(() => {
    const title = t("parserTitle", isRu);
    const subtitle = step === "workspace" && fileName
      ? fileName.replace(/\.(pdf|docx?|fb2)$/i, '')
      : t("parserSubtitle", isRu);
    setPageHeader({ title, subtitle, headerRight });
    return () => setPageHeader({});
  }, [isRu, step, fileName, headerRight, setPageHeader]);

  // Persist nav state to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(NAV_STATE_KEY, JSON.stringify({
        selected: Array.from(selectedIndices),
        lastClicked: lastClickedIdx,
        expanded: Array.from(expandedNodes),
      }));
    } catch {}
  }, [selectedIndices, lastClickedIdx, expandedNodes]);

  const handleOpenPdf = (page?: number) => {
    const suffix = page ? `#page=${page}` : '';
    if (file) {
      const url = URL.createObjectURL(file);
      window.open(url + suffix, '_blank');
    } else if (pdfRef?.getData) {
      pdfRef.getData().then((data: any) => {
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        window.open(url + suffix, '_blank');
      });
    }
  };

  const handleSelectChapter = (idx: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedIdx !== null) {
      const from = Math.min(lastClickedIdx, idx);
      const to = Math.max(lastClickedIdx, idx);
      setSelectedIndices(prev => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) next.add(i);
        return next;
      });
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedIndices(prev => {
        const next = new Set(prev);
        next.has(idx) ? next.delete(idx) : next.add(idx);
        return next;
      });
    } else {
      setSelectedIndices(new Set([idx]));
    }
    setLastClickedIdx(idx);
  };

  const toggleNode = (key: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  useEffect(() => {
    if (navRestoredFromStorage) return;
    if (tocEntries.length > 0 && expandedNodes.size === 0) {
      const allKeys = new Set<string>();
      tocEntries.forEach((e, idx) => {
        if (e.partTitle) allKeys.add(`part:${e.partTitle}`);
        const hasChild = idx + 1 < tocEntries.length &&
          tocEntries[idx + 1].level > e.level &&
          tocEntries[idx + 1].sectionType === e.sectionType;
        if (hasChild) allKeys.add(`item:${idx}`);
      });
      ["preface", "afterword", "endnotes", "appendix"].forEach(s => {
        if (tocEntries.some(e => e.sectionType === s)) allKeys.add(`section:${s}`);
      });
      setExpandedNodes(allKeys);
    }
  }, [tocEntries, navRestoredFromStorage]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col h-full">
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {step === "library" && (
            <LibraryView
              isRu={isRu} books={books} loadingLibrary={loadingLibrary}
              onUpload={startNewProject} onOpen={openSavedBook} onDelete={deleteBook}
              onClearAll={clearAllProjects} onRename={renameBook}
              serverBooks={serverBooks} loadingServerBooks={loadingServerBooks}
              onOpenServerBook={(book) => openSavedBook(book, { skipTimestampCheck: true })} onDeleteServerBook={deleteServerBook}
            />
          )}
          {step === "upload" && (
            <UploadView
              isRu={isRu}
              fileInputRef={fileInputRef}
              onFileSelect={handleFileSelect}
              storageBackend={storageBackend}
              onCreateWithFile={(name) => setPendingProjectName(name)}
            />
          )}
          {step === "extracting_toc" && (
            <ExtractingTocView fileName={fileName} isRu={isRu} uploadProgress={uploadProgress} />
          )}
          {step === "error" && (
            <ErrorView errorMsg={errorMsg} isRu={isRu} onReset={handleReset} />
          )}
          {step === "workspace" && parserTab === "structure" && (
            <motion.div key="workspace-structure" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex h-full min-h-0 overflow-hidden">
              <ResizablePanelGroup direction="horizontal" autoSaveId={NAV_WIDTH_KEY} className="h-full min-h-0">
                <ResizablePanel defaultSize={22} minSize={14} maxSize={45} className="min-h-0 overflow-hidden">
                  <NavSidebar
                    isRu={isRu} fileName={fileName} totalPages={totalPages}
                    tocEntries={tocEntries} chapterResults={chapterResults}
                    selectedIndices={selectedIndices} expandedNodes={expandedNodes}
                    contentEntries={contentEntries} supplementaryEntries={supplementaryEntries}
                    partGroups={partGroups} partlessIndices={partlessIndices}
                    onSelectChapter={handleSelectChapter} onAnalyzeChapter={analyzeChapter}
                    onToggleNode={toggleNode} onSendToStudio={sendToStudio}
                    isChapterFullyDone={isChapterFullyDone}
                    onChangeLevel={mutations.changeLevel}
                    onDeleteEntry={mutations.deleteEntry}
                    onRenameEntry={mutations.renameEntry}
                    onChangeStartPage={mutations.changeStartPage}
                    onOpenPdf={handleOpenPdf}
                    onRenamePart={mutations.renamePart}
                    onMergeEntries={mutations.mergeEntries}
                    roleModels={{
                      screenwriter: getModelForRole("screenwriter"),
                      director: getModelForRole("director"),
                      translator: getModelForRole("translator"),
                      proofreader: getModelForRole("proofreader"),
                    }}
                  />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={78} className="min-h-0 overflow-hidden">
                  <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
                   <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
                     <ChapterDetailPanel
                       isRu={isRu} selectedIdx={selectedIdx}
                       selectedEntry={selectedEntry} selectedResult={selectedResult}
                       analysisLog={analysisLog} onAnalyze={analyzeChapter}
                       onStopAnalysis={stopAnalysis}
                       isAnalyzing={isAnalyzing}
                       childCount={selectedChildCount}
                       roleModels={{
                         screenwriter: getModelForRole("screenwriter"),
                          director: getModelForRole("director"),
                        }}
                        onScenesUpdate={mutations.handleScenesUpdate}
                      />
                   </div>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </motion.div>
          )}
          {step === "workspace" && parserTab === "characters" && (
            <motion.div key="workspace-characters" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex h-full min-h-0 overflow-hidden">
              <ParserCharactersPanel
                isRu={isRu}
                characters={characters}
                extracting={extracting}
                extractProgress={extractProgress}
                extractPoolStats={extractPoolStats}
                onExtract={extractCharacters}
                onRename={renameCharacter}
                onUpdateGender={updateGender}
                onUpdateAliases={updateAliases}
                onDelete={deleteCharacter}
                onMerge={mergeCharacters}
                onAdd={addCharacter}
                analyzedCount={analyzedCount}
                profilerModel={getModelForRole("profiler")}
                profiling={profiling}
                profileProgress={profileProgress}
                profilePoolStats={profilePoolStats}
                onProfile={profileCharacters}
                tocEntries={tocEntries}
                chapterResults={chapterResults}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Sheet open={aiRolesOpen} onOpenChange={setAiRolesOpen}>
        <SheetContent side="right" className="w-[800px] sm:max-w-[800px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              {isRu ? "AI Роли" : "AI Roles"}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <AiRolesTab apiKeys={userApiKeys} isRu={isRu} onModelChanged={handleRoleModelChanged} bookTitle={fileName || undefined} />
          </div>
        </SheetContent>
      </Sheet>




      {/* ── Delete Confirmation Dialog ── */}
      <AlertDialog open={!!mutations.pendingDelete} onOpenChange={(open) => { if (!open) mutations.setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isRu ? "Удалить из структуры?" : "Remove from structure?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {mutations.pendingDelete && mutations.pendingDelete.indices.length === 1 ? (
                <span>{t("deleteEntryConfirm", isRu).replace("{title}", tocEntries[mutations.pendingDelete.indices[0]]?.title || "")}</span>
              ) : mutations.pendingDelete ? (
                <span>{t("deleteMultiConfirm", isRu).replace("{count}", String(mutations.pendingDelete.indices.length))}</span>
              ) : null}
              {mutations.pendingDelete && mutations.pendingDelete.toDelete.size > mutations.pendingDelete.indices.length && (
                <span className="block text-xs text-muted-foreground">
                  {isRu
                    ? `Включая ${mutations.pendingDelete.toDelete.size - mutations.pendingDelete.indices.length} вложенных элементов`
                    : `Including ${mutations.pendingDelete.toDelete.size - mutations.pendingDelete.indices.length} nested items`}
                </span>
              )}
              {mutations.pendingDelete && (() => {
                let sceneCount = 0;
                for (const di of mutations.pendingDelete.toDelete) {
                  const r = chapterResults.get(di);
                  if (r?.scenes) sceneCount += r.scenes.length;
                }
                return sceneCount > 0 ? (
                  <span className="block text-xs text-destructive">
                    {isRu ? `${sceneCount} проанализированных сцен будут потеряны` : `${sceneCount} analyzed scenes will be lost`}
                  </span>
                ) : null;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={mutations.confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isRu ? "Удалить" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Server Newer Version Dialog ── */}
      <AlertDialog open={!!serverNewerBookId} onOpenChange={(open) => { if (!open) dismissServerNewer(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isRu ? "На сервере есть более свежая версия" : "Server has a newer version"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isRu
                ? "Книга была обновлена на другом устройстве. Загрузить серверную версию? Локальные изменения будут заменены."
                : "The book was updated on another device. Load the server version? Local changes will be replaced."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {isRu ? "Оставить локальную" : "Keep local"}
            </AlertDialogCancel>
            <AlertDialogAction onClick={acceptServerVersion}>
              {isRu ? "Загрузить с сервера" : "Load from server"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
