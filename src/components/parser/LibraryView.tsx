import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, BookOpen, Library, Trash2, Clock, Loader2, Eraser, Pencil, Check, X, Cloud, Download, CalendarClock, Languages, ChevronDown, FolderOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/pages/parser/i18n";
import type { BookRecord } from "@/pages/parser/types";
import { PipelineTimeline } from "@/components/library/PipelineTimeline";
import { TranslationTimeline } from "@/components/library/TranslationTimeline";
import type { PipelineProgress, PipelineStepId, ProjectMeta } from "@/lib/projectStorage";
import { createEmptyPipelineProgress, getProjectTranslationLanguages } from "@/lib/projectStorage";
import { writePipelineStep } from "@/hooks/usePipelineProgress";
import { OPFSStorage } from "@/lib/projectStorage";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { checkTranslationReadiness } from "@/lib/translationProject";
import { paths } from "@/lib/projectPaths";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
interface LibraryViewProps {
  isRu: boolean;
  books: BookRecord[];
  loadingLibrary: boolean;
  onUpload: () => void;
  onOpen: (book: BookRecord) => void;
  onDelete: (bookId: string) => void;
  onClearAll?: () => void;
  onRename?: (bookId: string, newTitle: string) => void;
  serverBooks?: BookRecord[];
  loadingServerBooks?: boolean;
  onOpenServerBook?: (book: BookRecord) => void;
  onDeleteServerBook?: (bookId: string) => void;
  /** Called when a pipeline stage icon is clicked — opens book & navigates to route */
  onStageNavigate?: (book: BookRecord, route: string) => void;
  /** Called when user confirms project reset (first stage "Project" click) */
  onProjectReset?: (book: BookRecord) => void;
  /** Pipeline progress map pre-loaded from useLibrary */
  progressMap?: Record<string, PipelineProgress>;
  /** Setter for progressMap (for local updates after toggle) */
  setProgressMap?: React.Dispatch<React.SetStateAction<Record<string, PipelineProgress>>>;
  /** Pre-built bookId → project names map */
  localProjectNamesByBookId?: Map<string, string[]>;
}

function LibraryViewInner({
  isRu, books, loadingLibrary, onUpload, onOpen, onDelete, onClearAll, onRename,
  serverBooks = [], loadingServerBooks = false, onOpenServerBook, onDeleteServerBook,
  onStageNavigate, onProjectReset,
  progressMap: externalProgressMap, setProgressMap: externalSetProgressMap,
  localProjectNamesByBookId = new Map(),
}: LibraryViewProps) {
  const { bumpProgressVersion, storage: activeStorage, meta: activeMeta } = useProjectStorageContext();
  const syncedBookIds = useMemo(() => new Set(serverBooks.map(b => b.id)), [serverBooks]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [expandedTranslation, setExpandedTranslation] = useState<Set<string>>(new Set());
  const [transCreateConfirm, setTransCreateConfirm] = useState<{ book: BookRecord; exists: boolean } | null>(null);
  const [transCreating, setTransCreating] = useState(false);
  // Pipeline progress per book — prefer externally provided map
  const [localProgressMap, setLocalProgressMap] = useState<Record<string, PipelineProgress>>({});
  const progressMap = externalProgressMap ?? localProgressMap;
  const setProgressMap = externalSetProgressMap ?? setLocalProgressMap;

  const getProgress = useCallback((bookId: string): PipelineProgress => {
    return progressMap[bookId] ?? createEmptyPipelineProgress();
  }, [progressMap]);

  const resolveSourceProject = useCallback(async (bookId: string) => {
    if (activeStorage && activeMeta?.bookId === bookId) {
      return { store: activeStorage, meta: activeMeta };
    }

    // One book = one folder. Use pre-built map for direct lookup.
    const projectNames = localProjectNamesByBookId.get(bookId);
    if (!projectNames?.length) return null;

    const store = await OPFSStorage.openExisting(projectNames[0]);
    if (!store) return null;

    const rawMeta = await store.readJSON<Record<string, unknown>>("project.json");
    const meta = rawMeta ? {
      ...rawMeta,
      translationLanguages: getProjectTranslationLanguages(rawMeta),
    } as ProjectMeta : null;
    if (meta?.bookId === bookId) return { store, meta };

    return null;
  }, [activeStorage, activeMeta, localProjectNamesByBookId]);

  const handleToggleStep = useCallback(async (bookId: string, stepId: PipelineStepId, done: boolean) => {
    // Update local state immediately
    setProgressMap(prev => ({
      ...prev,
      [bookId]: { ...(prev[bookId] ?? createEmptyPipelineProgress()), [stepId]: done },
    }));

    // Persist to OPFS
    try {
      const source = await resolveSourceProject(bookId);
      if (source) {
        await writePipelineStep(source.store, stepId, done);
        // Notify sidebar and other consumers to re-read progress
        bumpProgressVersion();
      }
    } catch (e) {
      console.error("[LibraryView] Failed to persist pipeline step:", e);
    }
  }, [bumpProgressVersion, resolveSourceProject]);

  const startRename = (book: BookRecord) => {
    setEditingId(book.id);
    setEditValue(book.title);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename?.(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const cancelRename = () => setEditingId(null);

  const fmtDate = (val: string) => new Date(val).toLocaleDateString(isRu ? 'ru-RU' : 'en-US');
  const fmtDateTime = (val: string) => {
    const d = new Date(val);
    return `${d.toLocaleDateString(isRu ? 'ru-RU' : 'en-US')} ${d.toLocaleTimeString(isRu ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' })}`;
  };

  const toggleTranslation = useCallback((bookId: string) => {
    setExpandedTranslation(prev => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId); else next.add(bookId);
      return next;
    });
  }, []);

  const doCreateTranslationProject = useCallback(async (book: BookRecord) => {
    setTransCreating(true);
    try {
      const source = await resolveSourceProject(book.id);
      if (!source) return;

      const readiness = await checkTranslationReadiness(source.store);
      const readyIndices = Array.from(readiness.readyChapters.keys());
      if (readyIndices.length === 0) {
        toast.error(isRu
          ? "Нет глав, готовых к переводу. Выполните раскадровку в Студии."
          : "No chapters ready for translation. Complete storyboarding in Studio.");
        return;
      }

      const tLang = source.meta.language === "ru" ? "en" : "ru";

      // Write translationLanguages to project.json (unified storage — no separate OPFS project)
      const freshMeta = await source.store.readJSON<Record<string, unknown>>(paths.projectMeta());
      if (freshMeta) {
        const existing = getProjectTranslationLanguages(freshMeta);
        if (!existing.includes(tLang)) {
          const { sanitizeProjectMeta } = await import("@/lib/projectStorage");
          await source.store.writeJSON(paths.projectMeta(), sanitizeProjectMeta({
            ...freshMeta,
            translationLanguages: [...existing, tLang],
            updatedAt: new Date().toISOString(),
          }));
        }
      }

      // Rebuild book map with new lang & seed empty translation files
      const { readStructureFromLocal, syncStructureToLocal } = await import("@/lib/localSync");
      const local = await readStructureFromLocal(source.store);
      if (local?.structure) {
        // Force rebuild book map (readStructureFromLocal only rebuilds if missing)
        const { buildBookMap, writeBookMap } = await import("@/lib/bookMap");
        const updatedLangs = [...new Set([...getProjectTranslationLanguages(source.meta as unknown as Record<string, unknown>), tLang])];
        const newMap = buildBookMap(local.structure.bookId, local.structure.toc, local.chapterIdMap, local.chapterResults, updatedLangs);
        await writeBookMap(source.store, newMap);
      }
      toast.success(isRu
        ? `Перевод активирован (${readyIndices.length} глав)`
        : `Translation activated (${readyIndices.length} chapters)`);

      // Update progress flag
      await handleToggleStep(book.id, "trans_activated" as PipelineStepId, true);
    } catch (err) {
      console.error("[LibraryView] create translation error:", err);
      toast.error(isRu ? "Ошибка активации перевода" : "Failed to activate translation");
    } finally {
      setTransCreating(false);
      setTransCreateConfirm(null);
    }
  }, [isRu, handleToggleStep, resolveSourceProject]);

  const handleTranslationStageClick = useCallback(async (book: BookRecord, stageId: string) => {
    if (stageId === "trans_project") {
      // First stage — activate translation
      try {
        const source = await resolveSourceProject(book.id);
        if (!source) return;

        const hasLangs = getProjectTranslationLanguages(source.meta as unknown as Record<string, unknown>).length > 0;
        if (hasLangs) {
          setTransCreateConfirm({ book, exists: true });
        } else {
          await doCreateTranslationProject(book);
        }
      } catch (err) {
        console.error("[LibraryView] translation stage click error:", err);
      }
    } else {
      // Other stages — navigate to translation page
      onStageNavigate?.(book, "/translation");
    }
  }, [doCreateTranslationProject, onStageNavigate, resolveSourceProject]);

  const renderBookCard = (book: BookRecord, actions: React.ReactNode, timeline?: React.ReactNode, translationTimeline?: React.ReactNode) => {
    const hasTranslation = !!translationTimeline;
    const isTranslationExpanded = expandedTranslation.has(book.id);
    const progress = getProgress(book.id);
    const translationActive = !!progress.storyboard_done;

    return (
      <Card key={book.id} className="hover:border-primary/30 transition-colors group">
        <CardContent className="py-3 px-4">
          <div className="flex items-stretch gap-0">
            {/* Left column: icon + title */}
            <div className="min-w-0 flex-shrink-0 max-w-[260px] flex flex-col">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mb-1.5">
                <BookOpen className="h-4 w-4 text-primary" />
              </div>
              {editingId === book.id ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") cancelRename(); }}
                    className="h-7 text-sm"
                    autoFocus
                  />
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={commitRename}>
                    <Check className="h-3.5 w-3.5 text-primary" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={cancelRename}>
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ) : (
                <p className="font-medium text-sm text-foreground truncate flex items-center gap-1.5">
                  {book.title}
                  {syncedBookIds.has(book.id) && (
                    <span title={isRu ? "Синхронизировано с сервером" : "Synced to server"}>
                      <Cloud className="h-3.5 w-3.5 text-primary/60 flex-shrink-0" />
                    </span>
                  )}
                </p>
              )}
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {fmtDate(book.created_at)}
                </span>
                {(book.chapter_count || 0) > 0 && (
                  <span>{book.chapter_count} {t("libraryChapters", isRu)}</span>
                )}
                <Badge variant="outline" className="text-[10px] font-mono">
                  {book.file_format === "fb2" ? "FB2" : book.file_format === "docx" ? "DOCX" : (book.file_name?.match(/\.fb2$/i) ? "FB2" : book.file_name?.match(/\.(docx?)$/i) ? "DOCX" : "PDF")}
                </Badge>
              </div>
              {/* Action buttons under the title */}
              <div className="flex items-center gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {actions}
              </div>
            </div>

            {/* Vertical separator */}
            <div className="w-px bg-border mx-3 self-stretch" />

            {/* Timeline */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              {timeline}
            </div>

            {/* Vertical separator + Art Translation button */}
            {hasTranslation && (
              <>
                <div className="w-px bg-border mx-3 self-stretch" />
                <div className="flex items-center flex-shrink-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={isTranslationExpanded ? "secondary" : "outline"}
                        size="icon"
                        className="h-12 w-12 flex flex-col gap-0.5"
                        disabled={!translationActive}
                        onClick={() => toggleTranslation(book.id)}
                      >
                        <Languages className="h-5 w-5" />
                        <ChevronDown className={`h-3 w-3 transition-transform ${isTranslationExpanded ? "rotate-180" : ""}`} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      {!translationActive
                        ? (isRu ? "Требуется раскадровка" : "Storyboard required")
                        : (isRu ? "Арт-перевод" : "Art Translation")}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </>
            )}
          </div>

          {/* Collapsible translation section */}
          <AnimatePresence>
            {hasTranslation && isTranslationExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-2 pt-2 border-t border-border/50">
                  {translationTimeline}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    );
  };

  return (
    <motion.div key="library" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      className="flex-1 h-full overflow-auto">
      <div className="py-8 px-6 space-y-6 w-full">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-foreground">{t("libraryTitle", isRu)}</h2>
          <div className="flex items-center gap-2">
            {onClearAll && books.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-destructive hover:text-destructive">
                    <Eraser className="h-3.5 w-3.5" />
                    {isRu ? "Очистить всё" : "Clear all"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{isRu ? "Удалить все проекты?" : "Delete all projects?"}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {isRu
                        ? "Все локальные проекты будут безвозвратно удалены из браузерного хранилища."
                        : "All local projects will be permanently deleted from browser storage."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel", isRu)}</AlertDialogCancel>
                    <AlertDialogAction onClick={onClearAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      {isRu ? "Удалить всё" : "Delete all"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button variant="outline" size="sm" onClick={onUpload} className="gap-2">
              <Upload className="h-4 w-4" />
              {t("libraryUpload", isRu)}
            </Button>
          </div>
        </div>

        {loadingLibrary ? (
          <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">{t("libraryLoading", isRu)}</span>
          </div>
        ) : (
          <>
            {/* Local projects */}
            {books.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t("libraryLocalTitle", isRu)}
                </h3>
                {books.map(book => renderBookCard(book, (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={() => onOpen(book)} className="h-7 w-7 p-0 text-primary hover:text-primary">
                          <FolderOpen className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{isRu ? "Открыть" : "Open"}</TooltipContent>
                    </Tooltip>
                    {onRename && (
                      <Button variant="ghost" size="sm" onClick={() => startRename(book)} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                    {syncedBookIds.has(book.id) && onOpenServerBook && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={() => onOpenServerBook(book)} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                            <Download className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{isRu ? "Скачать с сервера" : "Download from server"}</TooltipContent>
                      </Tooltip>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-7 w-7 p-0">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("deleteBookTitle", isRu)}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {isRu ? `«${book.title}» ` : `"${book.title}" `}{t("deleteBookDesc", isRu)}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("cancel", isRu)}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => onDelete(book.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            {t("libraryDelete", isRu)}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    {syncedBookIds.has(book.id) && onDeleteServerBook && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-destructive/60 hover:text-destructive h-7 w-7 p-0">
                                <Cloud className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{isRu ? "Удалить с сервера" : "Delete from server"}</TooltipContent>
                          </Tooltip>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("deleteBookTitle", isRu)}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {isRu ? `«${book.title}» ` : `"${book.title}" `}{t("libraryServerDeleteDesc", isRu)}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("cancel", isRu)}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => onDeleteServerBook(book.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              {t("libraryServerDelete", isRu)}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </>
                ), (
                  <PipelineTimeline
                    progress={getProgress(book.id)}
                    isRu={isRu}
                    onToggleStep={(stepId, done) => handleToggleStep(book.id, stepId, done)}
                    onStageClick={(route) => onStageNavigate?.(book, route)}
                    onProjectReset={() => onProjectReset?.(book)}
                  />
                ), (
                  <TranslationTimeline
                    progress={getProgress(book.id)}
                    isRu={isRu}
                    onToggleStep={(stepId, done) => handleToggleStep(book.id, stepId, done)}
                    onStageClick={(stageId) => handleTranslationStageClick(book, stageId)}
                  />
                )))}
              </div>
            )}

            {/* Empty state */}
            {books.length === 0 && !loadingServerBooks && (
              <Card className="border-dashed">
                <CardContent className="py-16 flex flex-col items-center gap-4 text-muted-foreground">
                  <Library className="h-12 w-12 opacity-30" />
                  <p className="text-sm">{t("libraryEmpty", isRu)}</p>
                  <Button variant="outline" onClick={onUpload} className="gap-2">
                    <Upload className="h-4 w-4" />
                    {t("libraryUpload", isRu)}
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Translation project creation confirmation dialog */}
      <Dialog open={!!transCreateConfirm} onOpenChange={(open) => { if (!open) setTransCreateConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isRu ? "Проект перевода уже существует" : "Translation project already exists"}
            </DialogTitle>
            <DialogDescription>
              {isRu
                ? `Для книги «${transCreateConfirm?.book.title}» уже создан проект арт-перевода. Создать заново? Существующий проект будет перезаписан.`
                : `Book "${transCreateConfirm?.book.title}" already has a translation project. Create again? The existing project will be overwritten.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransCreateConfirm(null)} disabled={transCreating}>
              {t("cancel", isRu)}
            </Button>
            <Button
              variant="destructive"
              onClick={() => transCreateConfirm && doCreateTranslationProject(transCreateConfirm.book)}
              disabled={transCreating}
            >
              {transCreating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              {isRu ? "Пересоздать" : "Recreate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

export default LibraryViewInner;
