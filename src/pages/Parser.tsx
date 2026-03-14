import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Bot } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAiRoles } from "@/hooks/useAiRoles";
import { useLanguage } from "@/hooks/useLanguage";
import { usePageHeader } from "@/hooks/usePageHeader";
import { t } from "@/pages/parser/i18n";
import { NAV_WIDTH_KEY, NAV_STATE_KEY } from "@/pages/parser/types";
import type { Scene, ChapterStatus } from "@/pages/parser/types";
import type { AiRoleId } from "@/config/aiRoles";
import { useToast } from "@/hooks/use-toast";
import { useChapterAnalysis } from "@/hooks/useChapterAnalysis";
import { useBookManager } from "@/hooks/useBookManager";
import { useParserHelpers } from "@/hooks/useParserHelpers";

import LibraryView from "@/components/parser/LibraryView";
import UploadView from "@/components/parser/UploadView";
import { ExtractingTocView, ErrorView } from "@/components/parser/StatusViews";
import NavSidebar from "@/components/parser/NavSidebar";
import ChapterDetailPanel from "@/components/parser/ChapterDetailPanel";
import { AiRolesTab } from "@/components/profile/tabs/AiRolesTab";

export default function Parser() {
  const { user } = useAuth();
  const { isRu } = useLanguage();
  const { setPageHeader } = usePageHeader();

  const userApiKeys = useUserApiKeys();
  const [aiRolesOpen, setAiRolesOpen] = useState(false);
  const { getModelForRole } = useAiRoles(userApiKeys);
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
    step, setStep, books, loadingLibrary, fileName, errorMsg, bookId,
    chapterIdMap, setChapterIdMap, tocEntries, setTocEntries, pdfRef, totalPages, file,
    partIdMap, chapterResults, setChapterResults, fileInputRef,
    openSavedBook, deleteBook, handleFileSelect, handleReset: bookReset,
  } = useBookManager({ userId: user?.id, isRu });

  const { analysisLog, analyzeChapter, resetAnalysis } = useChapterAnalysis({
    isRu, pdfRef, userId: user?.id, userApiKeys, getModelForRole,
    tocEntries, chapterIdMap, chapterResults, setChapterResults,
  });

  const selectedIdx = selectedIndices.size === 1 ? Array.from(selectedIndices)[0] : null;

  const {
    selectedEntry, selectedResult, selectedChildCount,
    contentEntries, supplementaryEntries,
    analyzedCount, totalScenes,
    isChapterFullyDone, sendToStudio,
    partGroups, partlessIndices,
  } = useParserHelpers({ tocEntries, chapterResults, selectedIdx, fileName, bookId: bookId ?? undefined });

  // ── Warn when analysis-relevant models change ──
  const handleRoleModelChanged = useCallback((roleId: AiRoleId) => {
    if (roleId !== "screenwriter" && roleId !== "director") return;
    let analyzedCount = 0;
    chapterResults.forEach((r) => { if (r.status === "done") analyzedCount++; });
    if (analyzedCount > 0) {
      toast({
        title: isRu ? "Модель изменена" : "Model changed",
        description: isRu
          ? `${analyzedCount} гл. проанализированы прежней моделью. Используйте «Повторить» для обновления.`
          : `${analyzedCount} ch. analyzed with previous model. Use "Reanalyze" to update.`,
        duration: 6000,
      });
    }
  }, [chapterResults, isRu, toast]);

  // ── Reset handler (must be above headerRight useMemo) ──
  const handleReset = () => {
    bookReset();
    setSelectedIndices(new Set());
    setLastClickedIdx(null);
    setExpandedNodes(new Set());
    resetAnalysis();
    sessionStorage.removeItem(NAV_STATE_KEY);
  };

  // ── Page header (unified with AppLayout) ──
  const headerRight = useMemo(() => {
    if (step === "workspace") {
      return (
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground font-body">
            {analyzedCount}/{tocEntries.length} {t("chapters", isRu)} · {totalScenes} {t("scenes", isRu)}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setAiRolesOpen(true)} className="gap-1.5">
            <Bot className="h-3.5 w-3.5" />
            {isRu ? "AI Роли" : "AI Roles"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
            <ArrowLeft className="h-3 w-3" />
            {t("libraryBack", isRu)}
          </Button>
        </div>
      );
    }
    if (step === "upload") {
      return (
        <Button variant="ghost" size="sm" onClick={() => setStep("library")} className="gap-1.5">
          <ArrowLeft className="h-3 w-3" />
          {t("libraryBack", isRu)}
        </Button>
      );
    }
    return undefined;
  }, [step, isRu, analyzedCount, tocEntries.length, totalScenes, handleReset, setStep]);

  useEffect(() => {
    const title = t("parserTitle", isRu);
    const subtitle = step === "workspace" && fileName
      ? fileName.replace('.pdf', '')
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

  const changeLevel = (indices: number[], delta: number) => {
    setTocEntries(prev => {
      const next = prev.map(e => ({ ...e }));
      const allAffected = new Set<number>();
      
      for (const idx of indices) {
        const entry = next[idx];
        const newLevel = entry.level + delta;
        if (newLevel < 0) continue;
        
        const affected = [idx];
        for (let i = idx + 1; i < next.length; i++) {
          if (next[i].level <= entry.level) break;
          if (next[i].sectionType !== entry.sectionType) break;
          affected.push(i);
        }
        
        next[idx].level = newLevel;
        for (const ci of affected.slice(1)) {
          next[ci].level += delta;
          if (next[ci].level < 0) next[ci].level = 0;
        }
        affected.forEach(i => allAffected.add(i));
      }
      
      // Auto-save levels to DB
      for (const ci of allAffected) {
        const chapterId = chapterIdMap.get(ci);
        if (chapterId) {
          supabase.from('book_chapters').update({ level: next[ci].level }).eq('id', chapterId).then();
        }
      }
      return next;
    });
  };

  const renameEntry = (idx: number, newTitle: string) => {
    setTocEntries(prev => prev.map((e, i) => i === idx ? { ...e, title: newTitle } : e));
    const chapterId = chapterIdMap.get(idx);
    if (chapterId) {
      supabase.from('book_chapters').update({ title: newTitle }).eq('id', chapterId).then();
    }
  };

  const changeStartPage = (idx: number, newPage: number) => {
    setTocEntries(prev => {
      const next = prev.map((e, i) => i === idx ? { ...e, startPage: newPage } : e);
      // Also update endPage of previous entry if applicable
      if (idx > 0 && next[idx - 1].endPage === prev[idx].startPage) {
        next[idx - 1] = { ...next[idx - 1], endPage: newPage };
      }
      return next;
    });
  };

  const renamePart = (oldTitle: string, newTitle: string) => {
    setTocEntries(prev => prev.map(e => e.partTitle === oldTitle ? { ...e, partTitle: newTitle } : e));
    const partId = partIdMap.get(oldTitle);
    if (partId) {
      supabase.from('book_parts').update({ title: newTitle }).eq('id', partId).then();
    }
  };

  const deleteEntry = (indices: number[]) => {
    const count = indices.length;
    const confirmMsg = count === 1
      ? t("deleteEntryConfirm", isRu).replace("{title}", tocEntries[indices[0]]?.title || "")
      : t("deleteMultiConfirm", isRu).replace("{count}", String(count));
    if (!window.confirm(confirmMsg)) return;

    // Collect all indices to delete (each entry + deeper children)
    const toDelete = new Set<number>();
    for (const idx of indices) {
      toDelete.add(idx);
      const entry = tocEntries[idx];
      for (let i = idx + 1; i < tocEntries.length; i++) {
        if (tocEntries[i].level <= entry.level) break;
        if (tocEntries[i].sectionType !== entry.sectionType) break;
        toDelete.add(i);
      }
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
    const newEntries = tocEntries.filter((_, i) => !toDelete.has(i));
    setTocEntries(newEntries);

    // Rebuild chapterIdMap
    const oldMap = chapterIdMap;
    const newMap = new Map<number, string>();
    let newIdx = 0;
    for (let i = 0; i < tocEntries.length; i++) {
      if (toDelete.has(i)) continue;
      const oldId = oldMap.get(i);
      if (oldId) newMap.set(newIdx, oldId);
      newIdx++;
    }
    setChapterIdMap(newMap);

    // Clear selection
    setSelectedIndices(prev => {
      const next = new Set(prev);
      for (const di of toDelete) next.delete(di);
      return next.size > 0 ? next : new Set<number>();
    });

    // Rebuild chapterResults
    const newResults = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
    newIdx = 0;
    for (let i = 0; i < tocEntries.length; i++) {
      if (toDelete.has(i)) continue;
      const oldResult = chapterResults.get(i);
      if (oldResult) newResults.set(newIdx, oldResult);
      newIdx++;
    }
    setChapterResults(newResults);
  };

  useEffect(() => {
    // Skip auto-expand if nav state was restored from sessionStorage
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

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('api_keys').eq('id', user.id).single()
      .then(({ data }) => {
        if (data?.api_keys) setUserApiKeys(data.api_keys as Record<string, string>);
      });
  }, [user]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col h-full">
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
                    selectedIndices={selectedIndices} expandedNodes={expandedNodes}
                    contentEntries={contentEntries} supplementaryEntries={supplementaryEntries}
                    partGroups={partGroups} partlessIndices={partlessIndices}
                    onSelectChapter={handleSelectChapter} onAnalyzeChapter={analyzeChapter}
                    onToggleNode={toggleNode} onSendToStudio={sendToStudio}
                    isChapterFullyDone={isChapterFullyDone}
                    onChangeLevel={changeLevel}
                    onDeleteEntry={deleteEntry}
                    onRenameEntry={renameEntry}
                    onChangeStartPage={changeStartPage}
                    onOpenPdf={handleOpenPdf}
                    onRenamePart={renamePart}
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
                       childCount={selectedChildCount}
                       roleModels={{
                         screenwriter: getModelForRole("screenwriter"),
                         director: getModelForRole("director"),
                       }}
                     />
                   </div>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
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
    </motion.div>
  );
}
