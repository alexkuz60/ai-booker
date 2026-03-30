import { useState, useMemo, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { Upload, BookOpen, Library, Trash2, Clock, Loader2, Eraser, Pencil, Check, X, Cloud, Download, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { t } from "@/pages/parser/i18n";
import type { BookRecord } from "@/pages/parser/types";
import { PipelineTimeline } from "@/components/library/PipelineTimeline";
import { TranslationTimeline } from "@/components/library/TranslationTimeline";
import type { PipelineProgress, PipelineStepId } from "@/lib/projectStorage";
import { createEmptyPipelineProgress } from "@/lib/projectStorage";
import { readPipelineProgress, writePipelineStep } from "@/hooks/usePipelineProgress";
import { OPFSStorage } from "@/lib/projectStorage";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";

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
}

function LibraryViewInner({
  isRu, books, loadingLibrary, onUpload, onOpen, onDelete, onClearAll, onRename,
  serverBooks = [], loadingServerBooks = false, onOpenServerBook, onDeleteServerBook,
  onStageNavigate, onProjectReset,
}: LibraryViewProps) {
  const { bumpProgressVersion } = useProjectStorageContext();
  const syncedBookIds = useMemo(() => new Set(serverBooks.map(b => b.id)), [serverBooks]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Pipeline progress per book (read from OPFS project.json)
  const [progressMap, setProgressMap] = useState<Record<string, PipelineProgress>>({});

  // Load pipeline progress for all local books
  useEffect(() => {
    if (books.length === 0) return;
    let cancelled = false;

    (async () => {
      const map: Record<string, PipelineProgress> = {};
      for (const book of books) {
        if (cancelled) return;
        try {
          // Find OPFS project for this book
          const projects = await OPFSStorage.listProjects();
          for (const pn of projects) {
            const store = await OPFSStorage.openOrCreate(pn);
            const meta = await store.readJSON<Record<string, unknown>>("project.json");
            if (meta?.bookId === book.id && !meta?.targetLanguage && !meta?.sourceProjectName) {
              map[book.id] = await readPipelineProgress(store);
              break;
            }
          }
        } catch { /* skip */ }
        if (!map[book.id]) {
          // Fallback: infer from BookRecord data
          const p = createEmptyPipelineProgress();
          p.file_uploaded = true;
          p.opfs_created = true;
          if ((book.chapter_count || 0) > 0) p.toc_extracted = true;
          if ((book.scene_count || 0) > 0) p.scenes_analyzed = true;
          map[book.id] = p;
        }
      }
      if (!cancelled) setProgressMap(map);
    })();

    return () => { cancelled = true; };
  }, [books]);

  const getProgress = useCallback((bookId: string): PipelineProgress => {
    return progressMap[bookId] ?? createEmptyPipelineProgress();
  }, [progressMap]);

  const handleToggleStep = useCallback(async (bookId: string, stepId: PipelineStepId, done: boolean) => {
    // Update local state immediately
    setProgressMap(prev => ({
      ...prev,
      [bookId]: { ...(prev[bookId] ?? createEmptyPipelineProgress()), [stepId]: done },
    }));

    // Persist to OPFS
    try {
      const projects = await OPFSStorage.listProjects();
      for (const pn of projects) {
        const store = await OPFSStorage.openOrCreate(pn);
        const meta = await store.readJSON<Record<string, unknown>>("project.json");
        if (meta?.bookId === bookId && !meta?.targetLanguage && !meta?.sourceProjectName) {
          await writePipelineStep(store, stepId, done);
          // Notify sidebar and other consumers to re-read progress
          bumpProgressVersion();
          break;
        }
      }
    } catch (e) {
      console.error("[LibraryView] Failed to persist pipeline step:", e);
    }
  }, [bumpProgressVersion]);

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

  const renderBookCard = (book: BookRecord, actions: React.ReactNode, timeline?: React.ReactNode) => (
    <Card key={book.id} className="hover:border-primary/30 transition-colors group">
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-shrink-0 max-w-[260px]">
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
          {/* Timeline takes remaining space */}
          <div className="flex-1 min-w-0">
            {timeline}
          </div>
        </div>
      </CardContent>
    </Card>
  );

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
                    {onRename && (
                      <Button variant="ghost" size="sm" onClick={() => startRename(book)} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                        <Pencil className="h-3 w-3" />
                      </Button>
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
                  </>
                ), (
                  <div>
                    <PipelineTimeline
                      progress={getProgress(book.id)}
                      isRu={isRu}
                      onToggleStep={(stepId, done) => handleToggleStep(book.id, stepId, done)}
                      onStageClick={(route) => onStageNavigate?.(book, route)}
                      onProjectReset={() => onProjectReset?.(book)}
                    />
                    <TranslationTimeline
                      progress={getProgress(book.id)}
                      isRu={isRu}
                      onToggleStep={(stepId, done) => handleToggleStep(book.id, stepId, done)}
                    />
                  </div>
                )))}
              </div>
            )}

            {/* Empty state */}
            {books.length === 0 && serverBooks.length === 0 && !loadingServerBooks && (
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

            {/* Server books section */}
            {(loadingServerBooks || serverBooks.length > 0) && (
              <div className="space-y-2 pt-4 border-t border-border">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Cloud className="h-3.5 w-3.5" />
                  {t("libraryServerTitle", isRu)}
                </h3>
                {loadingServerBooks ? (
                  <div className="flex items-center justify-center py-8 gap-3 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">{t("libraryServerLoading", isRu)}</span>
                  </div>
                ) : (
                  serverBooks.map(book => renderBookCard(book, (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenServerBook?.(book)}
                        className="gap-1.5 text-xs"
                      >
                        <Download className="h-3 w-3" />
                        {t("libraryServerDownload", isRu)}
                      </Button>
                      {onDeleteServerBook && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-8 w-8 p-0">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
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
                    </div>
                  )))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

export default LibraryViewInner;
