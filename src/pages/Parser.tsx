import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import ModelSelector from "@/components/ModelSelector";
import { DEFAULT_MODEL_ID } from "@/config/modelRegistry";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import { useLanguage } from "@/hooks/useLanguage";
import { t } from "@/pages/parser/i18n";
import { NAV_WIDTH_KEY } from "@/pages/parser/types";
import type { Scene, ChapterStatus } from "@/pages/parser/types";
import { useChapterAnalysis } from "@/hooks/useChapterAnalysis";
import { useBookManager } from "@/hooks/useBookManager";
import { useParserHelpers } from "@/hooks/useParserHelpers";

import LibraryView from "@/components/parser/LibraryView";
import UploadView from "@/components/parser/UploadView";
import { ExtractingTocView, ErrorView } from "@/components/parser/StatusViews";
import NavSidebar from "@/components/parser/NavSidebar";
import ChapterDetailPanel from "@/components/parser/ChapterDetailPanel";

export default function Parser() {
  const { user } = useAuth();
  const { isRu } = useLanguage();

  const { value: selectedModel, update: setSelectedModel } = useCloudSettings('parser-model', DEFAULT_MODEL_ID);
  const [userApiKeys, setUserApiKeys] = useState<Record<string, string>>({});
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const {
    step, setStep, books, loadingLibrary, fileName, errorMsg,
    chapterIdMap, setChapterIdMap, tocEntries, setTocEntries, pdfRef, totalPages,
    chapterResults, setChapterResults, fileInputRef,
    openSavedBook, deleteBook, handleFileSelect, handleReset: bookReset,
  } = useBookManager({ userId: user?.id, isRu });

  const { analysisLog, analyzeChapter, resetAnalysis } = useChapterAnalysis({
    isRu, pdfRef, userId: user?.id, selectedModel, userApiKeys,
    tocEntries, chapterIdMap, chapterResults, setChapterResults,
  });

  const {
    selectedEntry, selectedResult,
    contentEntries, supplementaryEntries,
    analyzedCount, totalScenes,
    isChapterFullyDone, sendToStudio,
    partGroups, partlessIndices,
  } = useParserHelpers({ tocEntries, chapterResults, selectedIdx, fileName });

  const handleReset = () => {
    bookReset();
    setSelectedIdx(null);
    setExpandedNodes(new Set());
    resetAnalysis();
  };

  const toggleNode = (key: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const changeLevel = (idx: number, delta: number) => {
    setTocEntries(prev => {
      const next = prev.map(e => ({ ...e }));
      const entry = next[idx];
      const newLevel = entry.level + delta;
      if (newLevel < 0) return prev;
      const affectedIndices = [idx];
      for (let i = idx + 1; i < next.length; i++) {
        if (next[i].level <= entry.level) break;
        if (next[i].sectionType !== entry.sectionType) break;
        affectedIndices.push(i);
      }
      next[idx].level = newLevel;
      for (const ci of affectedIndices.slice(1)) {
        next[ci].level += delta;
        if (next[ci].level < 0) next[ci].level = 0;
      }
      // Auto-save levels to DB
      for (const ci of affectedIndices) {
        const chapterId = chapterIdMap.get(ci);
        if (chapterId) {
          supabase.from('book_chapters').update({ level: next[ci].level } as any).eq('id', chapterId).then();
        }
      }
      return next;
    });
  };

  const deleteEntry = (idx: number) => {
    const entry = tocEntries[idx];
    const title = entry.title;
    const confirmMsg = t("deleteEntryConfirm", isRu).replace("{title}", title);
    if (!window.confirm(confirmMsg)) return;

    // Collect indices to delete (entry + all deeper children)
    const toDelete = [idx];
    for (let i = idx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      toDelete.push(i);
    }

    // Delete from DB
    for (const di of toDelete) {
      const chapterId = chapterIdMap.get(di);
      if (chapterId) {
        supabase.from('book_scenes').delete().eq('chapter_id', chapterId).then();
        supabase.from('book_chapters').delete().eq('id', chapterId).then();
      }
    }

    // Remove from state
    const deleteSet = new Set(toDelete);
    const newEntries = tocEntries.filter((_, i) => !deleteSet.has(i));
    setTocEntries(newEntries);

    // Rebuild chapterIdMap with new indices
    const oldMap = chapterIdMap;
    const newMap = new Map<number, string>();
    let newIdx = 0;
    for (let i = 0; i < tocEntries.length; i++) {
      if (deleteSet.has(i)) continue;
      const oldId = oldMap.get(i);
      if (oldId) newMap.set(newIdx, oldId);
      newIdx++;
    setChapterIdMap(newMap);

    
    // Clear selection if deleted
    if (selectedIdx !== null && deleteSet.has(selectedIdx)) {
      setSelectedIdx(null);
    }

    // Rebuild chapterResults
    const newResults = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
    newIdx = 0;
    for (let i = 0; i < tocEntries.length; i++) {
      if (deleteSet.has(i)) continue;
      const oldResult = chapterResults.get(i);
      if (oldResult) newResults.set(newIdx, oldResult);
      newIdx++;
    }
    setChapterResults(newResults);
  };

  useEffect(() => {
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
  }, [tocEntries]);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('api_keys').eq('id', user.id).single()
      .then(({ data }) => {
        if (data?.api_keys) setUserApiKeys(data.api_keys as Record<string, string>);
      });
  }, [user]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{t("parserTitle", isRu)}</h1>
          <p className="text-sm text-muted-foreground font-body">{t("parserSubtitle", isRu)}</p>
        </div>
        {step === "workspace" && (
          <div className="flex items-center gap-3">
            <ModelSelector value={selectedModel} onChange={setSelectedModel} isRu={isRu} userApiKeys={userApiKeys} />
            <div className="text-xs text-muted-foreground">
              {analyzedCount}/{tocEntries.length} {t("chapters", isRu)} • {totalScenes} {t("scenes", isRu)}
            </div>
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
              <ArrowLeft className="h-3 w-3" />
              {t("libraryBack", isRu)}
            </Button>
          </div>
        )}
        {step === "upload" && (
          <Button variant="ghost" size="sm" onClick={() => setStep("library")} className="gap-1.5">
            <ArrowLeft className="h-3 w-3" />
            {t("libraryBack", isRu)}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {step === "library" && (
            <LibraryView
              isRu={isRu} books={books} loadingLibrary={loadingLibrary}
              onUpload={() => setStep("upload")} onOpen={openSavedBook} onDelete={deleteBook}
            />
          )}
          {step === "upload" && (
            <UploadView isRu={isRu} fileInputRef={fileInputRef} onFileSelect={handleFileSelect} />
          )}
          {step === "extracting_toc" && (
            <ExtractingTocView fileName={fileName} isRu={isRu} />
          )}
          {step === "error" && (
            <ErrorView errorMsg={errorMsg} isRu={isRu} onReset={handleReset} />
          )}
          {step === "workspace" && (
            <motion.div key="workspace" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex h-full min-h-0 overflow-hidden">
              <ResizablePanelGroup direction="horizontal" autoSaveId={NAV_WIDTH_KEY} className="h-full min-h-0">
                <ResizablePanel defaultSize={22} minSize={14} maxSize={45} className="min-h-0 overflow-hidden">
                  <NavSidebar
                    isRu={isRu} fileName={fileName} totalPages={totalPages}
                    tocEntries={tocEntries} chapterResults={chapterResults}
                    selectedIdx={selectedIdx} expandedNodes={expandedNodes}
                    contentEntries={contentEntries} supplementaryEntries={supplementaryEntries}
                    partGroups={partGroups} partlessIndices={partlessIndices}
                    onSelectChapter={setSelectedIdx} onAnalyzeChapter={analyzeChapter}
                    onToggleNode={toggleNode} onSendToStudio={sendToStudio}
                    isChapterFullyDone={isChapterFullyDone}
                    onChangeLevel={changeLevel}
                    onDeleteEntry={deleteEntry}
                  />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={78} className="min-h-0 overflow-hidden">
                  <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
                    <ChapterDetailPanel
                      isRu={isRu} selectedIdx={selectedIdx}
                      selectedEntry={selectedEntry} selectedResult={selectedResult}
                      analysisLog={analysisLog} onAnalyze={analyzeChapter}
                    />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
