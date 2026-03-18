import { useState } from "react";
import { motion } from "framer-motion";
import { Upload, BookOpen, Library, Trash2, FolderOpen, Clock, Loader2, Eraser, Pencil, Check, X } from "lucide-react";
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

interface LibraryViewProps {
  isRu: boolean;
  books: BookRecord[];
  loadingLibrary: boolean;
  onUpload: () => void;
  onOpen: (book: BookRecord) => void;
  onDelete: (bookId: string) => void;
  onClearAll?: () => void;
  onRename?: (bookId: string, newTitle: string) => void;
}

export default function LibraryView({ isRu, books, loadingLibrary, onUpload, onOpen, onDelete, onClearAll, onRename }: LibraryViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

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
  return (
    <motion.div key="library" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      className="flex-1 h-full overflow-auto">
      <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
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
        ) : books.length === 0 ? (
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
        ) : (
          <div className="space-y-2">
            {books.map(book => (
              <Card key={book.id} className="hover:border-primary/30 transition-colors group">
                <CardContent className="py-3 px-4 flex items-center gap-4">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <BookOpen className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
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
                      <p className="font-medium text-sm text-foreground truncate">{book.title}</p>
                    )}
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(book.created_at).toLocaleDateString(isRu ? 'ru-RU' : 'en-US')}
                      </span>
                      {(book.chapter_count || 0) > 0 && (
                        <span>{book.chapter_count} {t("libraryChapters", isRu)}</span>
                      )}
                      {(book.scene_count || 0) > 0 && (
                        <span>{book.scene_count} {t("libraryScenes", isRu)}</span>
                      )}
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {book.file_name?.match(/\.fb2$/i) ? "FB2" : book.file_name?.match(/\.(docx?)$/i) ? "DOCX" : "PDF"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {(book.chapter_count || 0) > 0 ? t("libraryAnalyzed", isRu) : t("libraryUploaded", isRu)}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onRename && (
                      <Button variant="ghost" size="sm" onClick={() => startRename(book)} className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => onOpen(book)} className="gap-1.5 text-xs">
                      <FolderOpen className="h-3 w-3" />
                      {t("libraryOpen", isRu)}
                    </Button>
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
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
