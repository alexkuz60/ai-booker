import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { syncStructureToLocal } from "@/lib/localSync";
import type {
  ChapterStatus,
  Scene,
  TocChapter,
} from "@/pages/parser/types";
import {
  PROJECT_META_VERSION,
  type ProjectMeta,
  type ProjectStorage,
} from "@/lib/projectStorage";
import {
  getLeafIndices,
  sanitizeChapterResultsForStructure,
} from "@/lib/tocStructure";
import { findSourceBlob, getMimeType } from "@/lib/fileFormatUtils";

export interface LocalBookSnapshot {
  toc: TocChapter[];
  parts: Array<{ id: string; title: string; partNumber: number }>;
  chapterIdMap: Map<number, string>;
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
}

interface UseSaveBookToProjectParams {
  isRu: boolean;
  currentBookId?: string | null;
  /** In-memory snapshot — primary source of truth */
  localSnapshot?: LocalBookSnapshot;
}

function getErrorMessage(error: unknown, isRu: boolean): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const msg = "message" in error ? (error as { message?: unknown }).message : undefined;
    if (typeof msg === "string" && msg.trim()) return msg;
    try { const j = JSON.stringify(error); if (j && j !== "{}") return j; } catch {}
  }
  return isRu ? "Неизвестная ошибка" : "Unknown error";
}

/**
 * Auto-save: writes current in-memory state to local ProjectStorage.
 * Called automatically by Parser on every structural change.
 */
export async function autoSaveToLocal(
  storage: ProjectStorage,
  bookId: string,
  fileName: string,
  snapshot: LocalBookSnapshot,
): Promise<void> {
  await syncStructureToLocal(storage, {
    bookId,
    title: fileName.replace(/\.(pdf|docx?)$/i, ""),
    fileName,
    toc: snapshot.toc,
    parts: snapshot.parts,
    chapterIdMap: snapshot.chapterIdMap,
    chapterResults: snapshot.chapterResults,
  });
}

export function useSaveBookToProject({ isRu, currentBookId, localSnapshot }: UseSaveBookToProjectParams) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { storage, openProject, backend, meta, downloadProjectAsZip, importProjectFromZip } = useProjectStorageContext();
  const [saving, setSaving] = useState(false);

  /**
   * SAVE = push local state → server (Supabase DB + Storage).
   * Used for cross-device sync / backup.
   * Source of truth: localSnapshot (in-memory state).
   */
  const saveBook = useCallback(async () => {
    if (!currentBookId || !localSnapshot) {
      toast({
        title: isRu ? "Нечего сохранять" : "Nothing to save",
        description: isRu ? "Откройте книгу и начните работу" : "Open a book and start working",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const { toc, parts, chapterIdMap, chapterResults } = localSnapshot;

      if (toc.length === 0) {
        throw new Error(isRu ? "Нет данных для синхронизации" : "No data to sync");
      }

      // ── 1. Upsert chapters to DB ──
      const chapterUpserts: Array<{
        id: string;
        book_id: string;
        chapter_number: number;
        title: string;
        level: number;
        start_page: number;
        end_page: number;
      }> = [];

      toc.forEach((entry, idx) => {
        const chId = chapterIdMap.get(idx);
        if (!chId) return;
        chapterUpserts.push({
          id: chId,
          book_id: currentBookId,
          chapter_number: idx + 1,
          title: entry.title,
          level: entry.level,
          start_page: entry.startPage,
          end_page: entry.endPage,
        });
      });

      if (chapterUpserts.length > 0) {
        const { error } = await supabase.from("book_chapters").upsert(chapterUpserts);
        if (error) console.warn("[SaveToServer] chapters upsert:", error);
      }

      // ── 2. Delete old scenes & insert current ones (leaf-only) ──
      const normalizedResults = sanitizeChapterResultsForStructure(toc, chapterResults);
      const leafIndices = getLeafIndices(toc);
      const allChapterIds = chapterUpserts.map((ch) => ch.id);

      // Delete ALL existing scenes for all chapter rows (removes stale/duplicate/folder scenes)
      if (allChapterIds.length > 0) {
        const { error: delErr } = await supabase
          .from("book_scenes")
          .delete()
          .in("chapter_id", allChapterIds);
        if (delErr) console.warn("[SaveToServer] scenes delete:", delErr);
      }

      // Insert fresh scenes only for leaf chapters
      const sceneInserts: Array<{
        id?: string;
        chapter_id: string;
        scene_number: number;
        title: string;
        content: string;
        scene_type: string;
        mood: string;
        bpm: number;
      }> = [];

      for (const idx of leafIndices) {
        const chId = chapterIdMap.get(idx);
        const result = normalizedResults.get(idx);
        if (!chId || !result) continue;

        for (const sc of result.scenes) {
          sceneInserts.push({
            ...(sc.id ? { id: sc.id } : {}),
            chapter_id: chId,
            scene_number: sc.scene_number,
            title: sc.title,
            content: sc.content || "",
            scene_type: sc.scene_type || "mixed",
            mood: sc.mood || "neutral",
            bpm: sc.bpm || 120,
          });
        }
      }

      if (sceneInserts.length > 0) {
        const { error } = await supabase.from("book_scenes").insert(sceneInserts);
        if (error) console.warn("[SaveToServer] scenes insert:", error);
      }

      // ── 3. Upsert parts to DB ──
      if (parts.length > 0) {
        const partUpserts = parts
          .filter((p) => p.id)
          .map((p) => ({
            id: p.id,
            book_id: currentBookId,
            part_number: p.partNumber,
            title: p.title,
          }));

        if (partUpserts.length > 0) {
          const { error } = await supabase.from("book_parts").upsert(partUpserts);
          if (error) console.warn("[SaveToServer] parts upsert:", error);
        }
      }

      // ── 4. Upload PDF to server if not already there ──
      if (storage) {
        const localPdfExists = await storage.exists("source/book.pdf");
        if (localPdfExists) {
          // Check if server already has the file
          const { data: bookRow } = await supabase
            .from("books")
            .select("file_path")
            .eq("id", currentBookId)
            .maybeSingle();

          const serverHasPdf = !!bookRow?.file_path;

          if (!serverHasPdf && user?.id) {
            const pdfBlob = await storage.readBlob("source/book.pdf");
            if (pdfBlob) {
              const filePath = `${user.id}/${Date.now()}_book.pdf`;
              const { error: uploadError } = await supabase.storage
                .from("book-uploads")
                .upload(filePath, pdfBlob);

              if (!uploadError) {
                await supabase
                  .from("books")
                  .update({ file_path: filePath })
                  .eq("id", currentBookId);
              }
            }
          }
        }
      }

      // ── 5. Also ensure local storage is up-to-date ──
      if (storage) {
        const nowIso = new Date().toISOString();
        const nextMeta: ProjectMeta = {
          version: PROJECT_META_VERSION,
          bookId: currentBookId,
          title: toc[0]?.title || "Book",
          userId: meta?.userId || user?.id || "",
          createdAt: meta?.createdAt || nowIso,
          updatedAt: nowIso,
          language: meta?.language || (isRu ? "ru" : "en"),
        };
        await storage.writeJSON("project.json", nextMeta);
      }

      // ── 6. Update books.updated_at so other devices can detect newer version ──
      const serverNow = new Date().toISOString();
      await supabase
        .from("books")
        .update({ updated_at: serverNow })
        .eq("id", currentBookId);

      const sceneCount = sceneInserts.length;
      toast({
        title: isRu ? "Синхронизировано с сервером" : "Synced to server",
        description: `${chapterUpserts.length} ${isRu ? "глав" : "chapters"}, ${sceneCount} ${isRu ? "сцен" : "scenes"}`,
      });
    } catch (error) {
      const message = getErrorMessage(error, isRu);
      toast({
        title: isRu ? "Ошибка синхронизации" : "Sync failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [currentBookId, localSnapshot, storage, isRu, toast, meta, user?.id]);

  const downloadZip = useCallback(async () => {
    try {
      setSaving(true);
      await downloadProjectAsZip();
      toast({
        title: isRu ? "Проект скачан" : "Project downloaded",
        description: isRu ? "ZIP-файл сохранён в папку загрузок" : "ZIP file saved to downloads",
      });
    } catch (error) {
      toast({
        title: isRu ? "Ошибка скачивания" : "Download failed",
        description: getErrorMessage(error, isRu),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [downloadProjectAsZip, isRu, toast]);

  const importZip = useCallback(async (file: File) => {
    try {
      setSaving(true);
      await importProjectFromZip(file);
      toast({
        title: isRu ? "Проект загружен" : "Project imported",
        description: file.name,
      });
    } catch (error) {
      toast({
        title: isRu ? "Ошибка импорта" : "Import failed",
        description: getErrorMessage(error, isRu),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [importProjectFromZip, isRu, toast]);

  return {
    saveBook,
    saving,
    backend,
    isProjectOpen: !!storage,
    downloadZip,
    importZip,
  };
}
