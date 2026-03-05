import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import ModelSelector from "@/components/ModelSelector";
import { DEFAULT_MODEL_ID } from "@/config/modelRegistry";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import { useLanguage } from "@/hooks/useLanguage";
import { saveStudioChapter } from "@/lib/studioChapter";
import { t } from "@/pages/parser/i18n";
import type { Scene, ChapterStatus } from "@/pages/parser/types";
import { NAV_WIDTH_KEY } from "@/pages/parser/types";
import { useChapterAnalysis } from "@/hooks/useChapterAnalysis";
import { useBookManager } from "@/hooks/useBookManager";

// UI components
import LibraryView from "@/components/parser/LibraryView";
import UploadView from "@/components/parser/UploadView";
import { ExtractingTocView, ErrorView } from "@/components/parser/StatusViews";
import NavSidebar from "@/components/parser/NavSidebar";
import ChapterDetailPanel from "@/components/parser/ChapterDetailPanel";

export default function Parser() {
  const { user } = useAuth();
  const { isRu } = useLanguage();
  const navigate = useNavigate();

  const { value: selectedModel, update: setSelectedModel } = useCloudSettings('parser-model', DEFAULT_MODEL_ID);
  const [userApiKeys, setUserApiKeys] = useState<Record<string, string>>({});
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // ─── Book manager hook ─────────────────────────────────────
  const {
    step, setStep, books, loadingLibrary, fileName, errorMsg,
    chapterIdMap, tocEntries, pdfRef, totalPages,
    chapterResults, setChapterResults, fileInputRef,
    openSavedBook, deleteBook, handleFileSelect, handleReset: bookReset,
  } = useBookManager({ userId: user?.id, isRu });

  // ─── Analysis hook ─────────────────────────────────────────
  const { analysisLog, analyzeChapter, resetAnalysis } = useChapterAnalysis({
    isRu, pdfRef, userId: user?.id, selectedModel, userApiKeys,
    tocEntries, chapterIdMap, chapterResults, setChapterResults,
  });

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

  // Auto-expand all nodes on first load
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

  // ─── Load user API keys ─────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('api_keys').eq('id', user.id).single()
      .then(({ data }) => {
        if (data?.api_keys) setUserApiKeys(data.api_keys as Record<string, string>);
      });
  }, [user]);

  // ─── Computed helpers ──────────────────────────────────────
  const selectedEntry = selectedIdx !== null ? tocEntries[selectedIdx] : null;
  const selectedResult = selectedIdx !== null ? chapterResults.get(selectedIdx) : null;

  const contentEntries = tocEntries.filter(e => e.sectionType === "content");
  const supplementaryEntries = tocEntries.filter(e => e.sectionType !== "content");

  const analyzedCount = Array.from(chapterResults.values()).filter(r => r.status === "done").length;
  const totalScenes = Array.from(chapterResults.values()).reduce((a, r) => a + r.scenes.length, 0);

  const isChapterFullyDone = (idx: number): boolean => {
    const entry = tocEntries[idx];
    const result = chapterResults.get(idx);
    if (!result || result.status !== "done" || result.scenes.length === 0) return false;
    for (let i = idx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      const childResult = chapterResults.get(i);
      if (!childResult || childResult.status !== "done" || childResult.scenes.length === 0) return false;
    }
    return true;
  };

  const sendToStudio = (idx: number) => {
    const entry = tocEntries[idx];
    const result = chapterResults.get(idx);
    if (!result) return;
    const allScenes = [...result.scenes];
    for (let i = idx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      const childResult = chapterResults.get(i);
      if (childResult) allScenes.push(...childResult.scenes);
    }
    saveStudioChapter({ chapterTitle: entry.title, bookTitle: fileName.replace('.pdf', ''), scenes: allScenes });
    navigate("/studio");
  };

  // Part grouping
  const partGroups: { title: string; indices: number[] }[] = [];
  const partlessIndices: number[] = [];
  const partMap = new Map<string, number[]>();
  const childOfAnother = new Set<number>();

  tocEntries.forEach((entry, idx) => {
    if (entry.sectionType !== "content") return;
    for (let i = idx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      childOfAnother.add(i);
    }
  });

  tocEntries.forEach((entry, idx) => {
    if (entry.sectionType !== "content") return;
    const key = entry.partTitle || "";
    if (key) {
      if (!partMap.has(key)) {
        partMap.set(key, []);
        partGroups.push({ title: key, indices: partMap.get(key)! });
      }
      if (!childOfAnother.has(idx)) partMap.get(key)!.push(idx);
    } else {
      if (!childOfAnother.has(idx)) partlessIndices.push(idx);
    }
  });

  // ─── Render ────────────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col h-full">
      {/* Header */}
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

      {/* Content */}
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
              <ResizablePanelGroup direction="horizontal" autoSaveId={NAV_WIDTH_KEY}>
                <ResizablePanel defaultSize={22} minSize={14} maxSize={45}>
                  <NavSidebar
                    isRu={isRu} fileName={fileName} totalPages={totalPages}
                    tocEntries={tocEntries} chapterResults={chapterResults}
                    selectedIdx={selectedIdx} expandedNodes={expandedNodes}
                    contentEntries={contentEntries} supplementaryEntries={supplementaryEntries}
                    partGroups={partGroups} partlessIndices={partlessIndices}
                    onSelectChapter={setSelectedIdx} onAnalyzeChapter={analyzeChapter}
                    onToggleNode={toggleNode} onSendToStudio={sendToStudio}
                    isChapterFullyDone={isChapterFullyDone}
                  />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={78}>
                  <div className="flex-1 flex flex-col h-full overflow-hidden">
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
