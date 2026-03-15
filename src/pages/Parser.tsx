import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useUserApiKeys } from "@/hooks/useUserApiKeys";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Bot, Library, PlusCircle, Network, FileText, Users, RefreshCw, CloudUpload, Undo2, Redo2 } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
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
import { useStructureUndo } from "@/hooks/useStructureUndo";
import type { StructureSnapshot } from "@/hooks/useStructureUndo";
import { useSaveBookToProject, autoSaveToLocal } from "@/hooks/useSaveBookToProject";

import LibraryView from "@/components/parser/LibraryView";
import UploadView from "@/components/parser/UploadView";
import { ExtractingTocView, ErrorView } from "@/components/parser/StatusViews";
import NavSidebar from "@/components/parser/NavSidebar";
import ChapterDetailPanel from "@/components/parser/ChapterDetailPanel";
import { AiRolesTab } from "@/components/profile/tabs/AiRolesTab";
import { SaveBookButton } from "@/components/SaveBookButton";

export default function Parser() {
  const { user } = useAuth();
  const { isRu } = useLanguage();
  const { setPageHeader } = usePageHeader();

  const userApiKeys = useUserApiKeys();
  const [aiRolesOpen, setAiRolesOpen] = useState(false);
  const [parserTab, setParserTab] = useState<"structure" | "content" | "characters">("structure");
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const { backend: storageBackend, createProject, openProject, storage: projectStorage } = useProjectStorageContext();
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
    openSavedBook, deleteBook, handleFileSelect, handleReset: bookReset, reloadBook, ensurePdfLoaded,
  } = useBookManager({ userId: user?.id, isRu, projectStorage });


  const { analysisLog, analyzeChapter, resetAnalysis, stopAnalysis, isAnalyzing } = useChapterAnalysis({
    isRu, pdfRef, userId: user?.id, userApiKeys, getModelForRole,
    tocEntries, chapterIdMap, chapterResults, setChapterResults, ensurePdfLoaded,
  });

  const { pushSnapshot, undo, redo, canUndo, canRedo, resetStacks } = useStructureUndo(bookId);

  const getCurrentSnapshot = useCallback((): StructureSnapshot => ({
    tocEntries: tocEntries.map(e => ({ ...e })),
    chapterIdMap: new Map(chapterIdMap),
    chapterResults: new Map(
      Array.from(chapterResults.entries()).map(([k, v]) => [k, { scenes: [...v.scenes], status: v.status }])
    ),
    selectedIndices: new Set(selectedIndices),
  }), [tocEntries, chapterIdMap, chapterResults, selectedIndices]);

  const restoreSnapshot = useCallback((s: StructureSnapshot) => {
    setTocEntries(s.tocEntries);
    setChapterIdMap(s.chapterIdMap);
    setChapterResults(s.chapterResults);
    setSelectedIndices(s.selectedIndices);
  }, [setTocEntries, setChapterIdMap, setChapterResults]);

  const handleUndo = useCallback(() => {
    undo(getCurrentSnapshot(), restoreSnapshot);
  }, [undo, getCurrentSnapshot, restoreSnapshot]);

  const handleRedo = useCallback(() => {
    redo(getCurrentSnapshot(), restoreSnapshot);
  }, [redo, getCurrentSnapshot, restoreSnapshot]);

  // Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (step !== "workspace") return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step, handleUndo, handleRedo]);



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

  // ── Auto-save structural changes to local project (only on real changes) ──
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedHash = useRef<string>("");
  useEffect(() => {
    if (!projectStorage?.isReady || !bookId || tocEntries.length === 0) return;

    // Cheap fingerprint: compare serialised lengths + key counts to avoid JSON.stringify on every render
    const hash = `${tocEntries.length}:${chapterResults.size}:${chapterIdMap.size}:${
      tocEntries.map(e => e.title + e.level + e.startPage).join("|")
    }:${
      Array.from(chapterResults.entries()).map(([k, v]) => `${k}:${v.status}:${v.scenes.length}:${v.scenes.reduce((s, sc) => s + (sc.content?.length ?? 0), 0)}`).join("|")
    }`;
    if (hash === lastSavedHash.current) return;

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      lastSavedHash.current = hash;
      autoSaveToLocal(projectStorage, bookId, fileName, {
        toc: tocEntries,
        parts: localPartsForSave,
        chapterIdMap,
        chapterResults,
      }).catch((err) => console.warn("[AutoSave] local write failed:", err));
    }, 800);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [projectStorage, bookId, tocEntries, chapterResults, chapterIdMap, fileName, localPartsForSave]);

  const { saveBook, saving: savingBook, isProjectOpen, downloadZip, importZip } = useSaveBookToProject({
    isRu,
    currentBookId: bookId,
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
    resetStacks();
    sessionStorage.removeItem(NAV_STATE_KEY);
  };

  // ── Page header (unified with AppLayout) ──
  const headerRight = useMemo(() => {
    const navButtons = (
      <div className="flex items-center gap-1">
        <Button
          variant={step === "library" ? "secondary" : "ghost"} size="sm"
          onClick={() => { if (step === "workspace") handleReset(); else setStep("library"); }}
          className="gap-1.5 text-xs"
        >
          <Library className="h-3.5 w-3.5" />
          {isRu ? "Библиотека" : "Library"}
        </Button>
        <Button
          variant={step === "upload" ? "secondary" : "ghost"} size="sm"
          onClick={() => setStep("upload")}
          className="gap-1.5 text-xs"
        >
          <PlusCircle className="h-3.5 w-3.5" />
          {isRu ? "Новая книга" : "New Book"}
        </Button>
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
              variant={parserTab === "content" ? "secondary" : "ghost"} size="sm"
              onClick={() => setParserTab("content")}
              className="gap-1.5 text-xs"
            >
              <FileText className="h-3.5 w-3.5" />
              {isRu ? "Контент" : "Content"}
            </Button>
            <Button
              variant={parserTab === "characters" ? "secondary" : "ghost"} size="sm"
              onClick={() => setParserTab("characters")}
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
  }, [step, isRu, analyzedCount, tocEntries.length, totalScenes, handleReset, setStep, parserTab, reloadBook, saveBook, savingBook, bookId]);

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
    pushSnapshot(getCurrentSnapshot());
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
    pushSnapshot(getCurrentSnapshot());
    setTocEntries(prev => prev.map((e, i) => i === idx ? { ...e, title: newTitle } : e));
    const chapterId = chapterIdMap.get(idx);
    if (chapterId) {
      supabase.from('book_chapters').update({ title: newTitle }).eq('id', chapterId).then();
    }
  };

  const changeStartPage = (idx: number, newPage: number) => {
    pushSnapshot(getCurrentSnapshot());
    setTocEntries(prev => {
      const next = prev.map((e, i) => i === idx ? { ...e, startPage: newPage } : e);
      if (idx > 0 && next[idx - 1].endPage === prev[idx].startPage) {
        next[idx - 1] = { ...next[idx - 1], endPage: newPage };
        // Persist previous entry's endPage
        const prevChId = chapterIdMap.get(idx - 1);
        if (prevChId) supabase.from('book_chapters').update({ end_page: newPage }).eq('id', prevChId).then();
      }
      return next;
    });
    // Persist to DB
    const chId = chapterIdMap.get(idx);
    if (chId) supabase.from('book_chapters').update({ start_page: newPage }).eq('id', chId).then();
  };

  const renamePart = (oldTitle: string, newTitle: string) => {
    pushSnapshot(getCurrentSnapshot());
    setTocEntries(prev => prev.map(e => e.partTitle === oldTitle ? { ...e, partTitle: newTitle } : e));
    const partId = partIdMap.get(oldTitle);
    if (partId) {
      supabase.from('book_parts').update({ title: newTitle }).eq('id', partId).then();
    }
  };

  const deleteEntry = (indices: number[]) => {
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
    // Show confirmation dialog with details
    setPendingDelete({ indices, toDelete });
  };

  const [pendingDelete, setPendingDelete] = useState<{ indices: number[]; toDelete: Set<number> } | null>(null);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const { toDelete } = pendingDelete;
    pushSnapshot(getCurrentSnapshot());

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
    setPendingDelete(null);
  };

  const mergeEntries = (indices: number[]) => {
    if (indices.length < 2) return;
    pushSnapshot(getCurrentSnapshot());
    const sorted = [...indices].sort((a, b) => a - b);
    const firstIdx = sorted[0];
    const lastIdx = sorted[sorted.length - 1];
    const first = tocEntries[firstIdx];
    const last = tocEntries[lastIdx];

    // Merge into first entry: extend endPage, combine scenes
    const mergedEntry: TocChapter = {
      ...first,
      endPage: Math.max(first.endPage, last.endPage),
    };

    // Merge scenes from all selected
    const mergedScenes: Scene[] = [];
    for (const idx of sorted) {
      const result = chapterResults.get(idx);
      if (result?.scenes) mergedScenes.push(...result.scenes);
    }
    // Renumber scenes
    mergedScenes.forEach((sc, i) => { sc.scene_number = i + 1; });

    const toRemove = new Set(sorted.slice(1));

    // Delete merged chapters from DB
    for (const di of toRemove) {
      const chapterId = chapterIdMap.get(di);
      if (chapterId) {
        supabase.from('book_scenes').delete().eq('chapter_id', chapterId).then();
        supabase.from('book_chapters').delete().eq('id', chapterId).then();
      }
    }

    // Update entries
    const newEntries = tocEntries.map((e, i) => i === firstIdx ? mergedEntry : e).filter((_, i) => !toRemove.has(i));
    setTocEntries(newEntries);

    // Rebuild maps
    const newChapterMap = new Map<number, string>();
    const newResults = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
    let newIdx = 0;
    for (let i = 0; i < tocEntries.length; i++) {
      if (toRemove.has(i)) continue;
      const oldId = chapterIdMap.get(i);
      if (oldId) newChapterMap.set(newIdx, oldId);
      if (i === firstIdx) {
        newResults.set(newIdx, { scenes: mergedScenes, status: mergedScenes.length > 0 ? "done" : "pending" });
      } else {
        const oldResult = chapterResults.get(i);
        if (oldResult) newResults.set(newIdx, oldResult);
      }
      newIdx++;
    }
    setChapterIdMap(newChapterMap);
    setChapterResults(newResults);
    setSelectedIndices(new Set([firstIdx]));
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

  // Handle scene content updates from cleanup actions
  // Only updates in-memory state; auto-save effect persists to local storage
  // IMPORTANT: when a parent node is selected, selectedResult aggregates scenes
  // from multiple children — we must distribute edits back to correct chapter indices.
  const handleScenesUpdate = useCallback((updatedScenes: Scene[]) => {
    if (selectedIdx === null) return;

    const entry = tocEntries[selectedIdx];

    // Collect child indices (same logic as useParserHelpers)
    const childIndices: number[] = [];
    for (let i = selectedIdx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      childIndices.push(i);
    }

    // No children — simple case, update selectedIdx directly
    if (childIndices.length === 0) {
      setChapterResults(prev => {
        const next = new Map(prev);
        const existing = next.get(selectedIdx);
        if (existing) {
          next.set(selectedIdx, { ...existing, scenes: updatedScenes });
        }
        return next;
      });
      return;
    }

    // Parent with children: distribute scenes back to their original chapters.
    // The aggregated list was built by concatenating scenes from [selectedIdx, ...childIndices]
    // in order, so we split updatedScenes back using the original scene counts.
    const indices = [selectedIdx, ...childIndices];
    setChapterResults(prev => {
      const next = new Map(prev);
      let offset = 0;
      for (const idx of indices) {
        const existing = prev.get(idx);
        if (!existing) continue;
        const count = existing.scenes.length;
        const slice = updatedScenes.slice(offset, offset + count);
        // Restore original scene_number values for each chapter's scenes
        const restored = slice.map((sc, i) => ({
          ...sc,
          scene_number: existing.scenes[i]?.scene_number ?? i + 1,
        }));
        next.set(idx, { ...existing, scenes: restored });
        offset += count;
      }
      return next;
    });
  }, [selectedIdx, tocEntries, setChapterResults]);


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
            <UploadView
              isRu={isRu}
              fileInputRef={fileInputRef}
              onFileSelect={handleFileSelect}
              storageBackend={storageBackend}
              onCreateLocalProject={() => {
                setNewProjectName("");
                setNewProjectDialogOpen(true);
              }}
              onOpenLocalProject={async () => {
                try {
                  const store = await openProject();
                  toast({ title: isRu ? "Проект открыт" : "Project opened", description: store.projectName });
                } catch (err: any) {
                  if (err?.name !== "AbortError") {
                    toast({ title: isRu ? "Ошибка" : "Error", description: String(err?.message || err), variant: "destructive" });
                  }
                }
              }}
            />
          )}
          {step === "extracting_toc" && (
            <ExtractingTocView fileName={fileName} isRu={isRu} />
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
                    onChangeLevel={changeLevel}
                    onDeleteEntry={deleteEntry}
                    onRenameEntry={renameEntry}
                    onChangeStartPage={changeStartPage}
                    onOpenPdf={handleOpenPdf}
                    onRenamePart={renamePart}
                    onMergeEntries={mergeEntries}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    canUndo={canUndo}
                    canRedo={canRedo}
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
                        onScenesUpdate={handleScenesUpdate}
                      />
                   </div>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </motion.div>
          )}
          {step === "workspace" && parserTab === "content" && (
            <motion.div key="workspace-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex items-center justify-center h-full">
              <div className="text-center space-y-3">
                <FileText className="h-12 w-12 text-muted-foreground/40 mx-auto" />
                <h2 className="text-lg font-display text-muted-foreground">
                  {isRu ? "Анализ контента" : "Content Analysis"}
                </h2>
                <p className="text-sm text-muted-foreground/60 max-w-md">
                  {isRu
                    ? "Детальный анализ текста каждой сцены: стиль, ритм, ключевые события. Скоро."
                    : "Detailed analysis of each scene's text: style, rhythm, key events. Coming soon."}
                </p>
              </div>
            </motion.div>
          )}
          {step === "workspace" && parserTab === "characters" && (
            <motion.div key="workspace-characters" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex items-center justify-center h-full">
              <div className="text-center space-y-3">
                <Users className="h-12 w-12 text-muted-foreground/40 mx-auto" />
                <h2 className="text-lg font-display text-muted-foreground">
                  {isRu ? "Список персонажей" : "Characters"}
                </h2>
                <p className="text-sm text-muted-foreground/60 max-w-md">
                  {isRu
                    ? "Автоматическое определение и профилирование персонажей книги. Скоро."
                    : "Automatic detection and profiling of book characters. Coming soon."}
                </p>
              </div>
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

      {/* ── New Project Name Dialog ── */}
      <Dialog open={newProjectDialogOpen} onOpenChange={setNewProjectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isRu ? "Название проекта" : "Project Name"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="project-name">{isRu ? "Имя папки проекта" : "Project folder name"}</Label>
            <Input
              id="project-name"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder={isRu ? "Моя книга" : "My Book"}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && newProjectName.trim()) {
                  e.preventDefault();
                  document.getElementById("create-project-btn")?.click();
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              {storageBackend === "fs-access"
                ? (isRu ? "Далее выберите родительскую папку на диске" : "Next you'll pick a parent folder on disk")
                : (isRu ? "Проект будет сохранён в браузерном хранилище" : "Project will be saved in browser storage")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewProjectDialogOpen(false)}>
              {isRu ? "Отмена" : "Cancel"}
            </Button>
            <Button
              id="create-project-btn"
              disabled={!newProjectName.trim()}
              onClick={async () => {
                setNewProjectDialogOpen(false);
                try {
                  await createProject(newProjectName.trim(), "", user?.id || "", isRu ? "ru" : "en");
                  toast({ title: isRu ? "Проект создан" : "Project created", description: newProjectName.trim() });
                } catch (err: any) {
                  if (err?.name !== "AbortError") {
                    toast({ title: isRu ? "Ошибка" : "Error", description: String(err?.message || err), variant: "destructive" });
                  }
                }
              }}
            >
              {isRu ? "Создать" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isRu ? "Удалить из структуры?" : "Remove from structure?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {pendingDelete && pendingDelete.indices.length === 1 ? (
                <span>{t("deleteEntryConfirm", isRu).replace("{title}", tocEntries[pendingDelete.indices[0]]?.title || "")}</span>
              ) : pendingDelete ? (
                <span>{t("deleteMultiConfirm", isRu).replace("{count}", String(pendingDelete.indices.length))}</span>
              ) : null}
              {pendingDelete && pendingDelete.toDelete.size > pendingDelete.indices.length && (
                <span className="block text-xs text-muted-foreground">
                  {isRu
                    ? `Включая ${pendingDelete.toDelete.size - pendingDelete.indices.length} вложенных элементов`
                    : `Including ${pendingDelete.toDelete.size - pendingDelete.indices.length} nested items`}
                </span>
              )}
              {pendingDelete && (() => {
                let sceneCount = 0;
                for (const di of pendingDelete.toDelete) {
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
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isRu ? "Удалить" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
