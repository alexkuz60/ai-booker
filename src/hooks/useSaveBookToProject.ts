import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { syncStructureToLocal, readStructureFromLocal } from "@/lib/localSync";
import { useStoryboardPersistence } from "@/hooks/useStoryboardPersistence";
import { readCharacterIndex } from "@/lib/localCharacters";
import type { CharacterIndex } from "@/pages/parser/types";
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
import { findSourceBlob } from "@/lib/fileFormatUtils";

export interface LocalBookSnapshot {
  toc: TocChapter[];
  parts: Array<{ id: string; title: string; partNumber: number }>;
  chapterIdMap: Map<number, string>;
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
}

interface UseSaveBookToProjectParams {
  isRu: boolean;
  currentBookId?: string | null;
  /** File name for first-push book title */
  fileName?: string;
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
  // Prefer project title from project.json over fileName-derived title
  let projectTitle = fileName.replace(/\.(pdf|docx?|fb2)$/i, "");
  try {
    const meta = await storage.readJSON<{ title?: string }>("project.json");
    if (meta?.title) projectTitle = meta.title;
  } catch {}

  await syncStructureToLocal(storage, {
    bookId,
    title: projectTitle,
    fileName,
    toc: snapshot.toc,
    parts: snapshot.parts,
    chapterIdMap: snapshot.chapterIdMap,
    chapterResults: snapshot.chapterResults,
  });
}

export function useSaveBookToProject({ isRu, currentBookId, fileName, localSnapshot }: UseSaveBookToProjectParams) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { storage, openProject, backend, meta, downloadProjectAsZip, importProjectFromZip } = useProjectStorageContext();
  const { pushAllToDb } = useStoryboardPersistence(null);
  const [saving, setSaving] = useState(false);

  /**
   * SAVE = push local state → server (Supabase DB + Storage).
   * Used for cross-device sync / backup.
   * Handles first-push: creates books row if it doesn't exist yet.
   */
  const saveBook = useCallback(async () => {
    if (!currentBookId) {
      toast({
        title: isRu ? "Нечего сохранять" : "Nothing to save",
        description: isRu ? "Откройте книгу и начните работу" : "Open a book and start working",
        variant: "destructive",
      });
      return;
    }

    // If no in-memory snapshot provided (e.g. Studio), read from OPFS
    let snapshot = localSnapshot;
    if (!snapshot && storage) {
      try {
        const fromLocal = await readStructureFromLocal(storage);
        if (fromLocal?.structure && fromLocal.structure.toc?.length > 0) {
          snapshot = {
            toc: fromLocal.structure.toc as TocChapter[],
            parts: fromLocal.structure.parts || [],
            chapterIdMap: fromLocal.chapterIdMap,
            chapterResults: fromLocal.chapterResults,
          };
        }
      } catch (e) {
        console.warn("[SaveToServer] Failed to read snapshot from OPFS:", e);
      }
    }

    if (!snapshot) {
      toast({
        title: isRu ? "Нечего сохранять" : "Nothing to save",
        description: isRu ? "Откройте книгу и начните работу" : "Open a book and start working",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const { toc, parts, chapterIdMap, chapterResults } = snapshot;

      if (toc.length === 0) {
        throw new Error(isRu ? "Нет данных для синхронизации" : "No data to sync");
      }

      // LIR-3: verify storage bookId matches before any DB writes
      if (storage) {
        try {
          const storedMeta = await storage.readJSON<{ bookId?: string }>("project.json");
          if (storedMeta?.bookId && storedMeta.bookId !== currentBookId) {
            throw new Error(
              isRu
                ? `Несоответствие проекта: хранилище содержит ${storedMeta.bookId}, ожидается ${currentBookId}`
                : `Project mismatch: storage has ${storedMeta.bookId}, expected ${currentBookId}`
            );
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes("mismatch")) throw e;
          // If project.json can't be read, proceed cautiously
        }
      }

      // ── 0. Ensure books row exists (first-push from OPFS-only workflow) ──
      const { data: existingBook } = await supabase
        .from("books")
        .select("id")
        .eq("id", currentBookId)
        .maybeSingle();

      if (!existingBook && user?.id) {
        let bookTitle: string | undefined;
        try {
          const pjMeta = await storage?.readJSON<{ title?: string }>("project.json");
          if (pjMeta?.title) bookTitle = pjMeta.title;
        } catch {}
        if (!bookTitle) {
          bookTitle = fileName
            ? fileName.replace(/\.(pdf|docx?|fb2)$/i, "")
            : (toc[0]?.title || "Book");
        }
        // LIR-5: preserve actual file format, don't hardcode .pdf
        const resolvedFileName = fileName || `${bookTitle}.pdf`;
        const { error: bookErr } = await supabase
          .from("books")
          .insert({
            id: currentBookId,
            user_id: user.id,
            title: bookTitle,
            file_name: resolvedFileName,
            status: "uploaded",
          });
        if (bookErr) throw bookErr;
        console.log("[SaveToServer] Created books row for first push:", currentBookId);
      }

      // ── 1. Delete all existing chapters, then insert fresh ones ──
      const { count: deletedChaptersCount } = await supabase
        .from("book_chapters")
        .delete({ count: "exact" })
        .eq("book_id", currentBookId);
      console.log(`[SaveToServer] Deleted ${deletedChaptersCount ?? "?"} chapters (cascade: scenes, segments, phrases)`);

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
        const { error } = await supabase.from("book_chapters").insert(chapterUpserts);
        if (error) console.warn("[SaveToServer] chapters insert:", error);
        else console.log(`[SaveToServer] Inserted ${chapterUpserts.length} chapters`);
      }

      // ── 2. Insert scenes for leaf chapters only ──
      const normalizedResults = sanitizeChapterResultsForStructure(toc, chapterResults);
      const leafIndices = getLeafIndices(toc);

      const sceneInserts: Array<{
        id?: string;
        chapter_id: string;
        scene_number: number;
        title: string;
        content: string;
        scene_type: string;
        mood: string;
        bpm: number;
        content_dirty: boolean;
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
            content_dirty: sc.dirty ?? false,
          });
        }
      }

      if (sceneInserts.length > 0) {
        const { error } = await supabase.from("book_scenes").insert(sceneInserts);
        if (error) console.warn("[SaveToServer] scenes insert:", error);
        else console.log(`[SaveToServer] Inserted ${sceneInserts.length} scenes`);
      }

      // ── 3. Replace parts ──
      await supabase.from("book_parts").delete().eq("book_id", currentBookId);
      if (parts.length > 0) {
        const partInserts = parts
          .filter((p) => p.id)
          .map((p) => ({
            id: p.id,
            book_id: currentBookId,
            part_number: p.partNumber,
            title: p.title,
          }));

        if (partInserts.length > 0) {
          const { error } = await supabase.from("book_parts").insert(partInserts);
          if (error) console.warn("[SaveToServer] parts insert:", error);
        }
      }

      // ── 4. Sync characters to book_characters ──
      let savedCharCount = 0;
      let savedProfileCount = 0;
      if (storage) {
        const localChars = await readCharacterIndex(storage);
        if (localChars.length > 0) {
          // Delete existing characters for this book, then insert fresh
          await supabase.from("book_characters").delete().eq("book_id", currentBookId);

          const charInserts = localChars.map((c: CharacterIndex) => ({
            id: c.id, // Preserve original UUID for FK integrity (scene_type_mappings)
            book_id: currentBookId,
            name: c.name,
            aliases: c.aliases || [],
            gender: c.gender || "unknown",
            age_group: c.age_group || "unknown",
            temperament: c.temperament || null,
            speech_style: c.speech_style || null,
            description: c.description || null,
            speech_tags: c.speech_tags || [],
            psycho_tags: c.psycho_tags || [],
            sort_order: c.sort_order || 0,
            color: c.color || null,
            voice_config: JSON.parse(JSON.stringify(c.voice_config || {})),
          }));

          const { error: charErr } = await supabase.from("book_characters").insert(charInserts);
          if (charErr) console.warn("[SaveToServer] characters insert:", charErr);
          else {
            savedCharCount = charInserts.length;
            savedProfileCount = localChars.filter(c => c.description).length;
            console.log(`[SaveToServer] Saved ${savedCharCount} characters (K4), ${savedProfileCount} profiles`);
          }
        }
      }

      // ── 4b. Push storyboard data (segments/phrases/mappings) to DB ──
      let savedStoryboardCount = 0;
      try {
        savedStoryboardCount = await pushAllToDb();
        if (savedStoryboardCount > 0) {
          console.log(`[SaveToServer] Pushed ${savedStoryboardCount} storyboarded scenes`);
        }
      } catch (e) {
        console.warn("[SaveToServer] Storyboard push failed:", e);
      }

      // ── 5. Upload source file to server if not already there ──
      if (storage) {
        const sourceResult = await findSourceBlob(storage);
        if (sourceResult) {
          const { data: bookRow } = await supabase
            .from("books")
            .select("file_path")
            .eq("id", currentBookId)
            .maybeSingle();

          const serverHasFile = !!bookRow?.file_path;

          if (!serverHasFile && user?.id) {
            const ext = sourceResult.format === "fb2" ? "book.fb2" : sourceResult.format === "docx" ? "book.docx" : "book.pdf";
            const filePath = `${user.id}/${Date.now()}_${ext}`;
            const { error: uploadError } = await supabase.storage
              .from("book-uploads")
              .upload(filePath, sourceResult.blob);

            if (!uploadError) {
              await supabase
                .from("books")
                .update({ file_path: filePath })
                .eq("id", currentBookId);
            }
          }
        }
      }

      // ── 6. Update local project.json ──
      // LIR-3 + LIR-4: read title/meta from storage, not stale React context
      if (storage) {
        const nowIso = new Date().toISOString();
        let freshMeta: Partial<ProjectMeta> = {};
        try {
          const stored = await storage.readJSON<ProjectMeta>("project.json");
          if (stored) freshMeta = stored;
        } catch {}

        // LIR-3: verify bookId matches before writing
        if (freshMeta.bookId && freshMeta.bookId !== currentBookId) {
          console.error("[SaveToServer] bookId mismatch! storage=%s, target=%s — aborting meta write", freshMeta.bookId, currentBookId);
        } else {
          const nextMeta: ProjectMeta = {
            version: PROJECT_META_VERSION,
            bookId: currentBookId,
            title: freshMeta.title || toc[0]?.title || "Book",
            userId: freshMeta.userId || user?.id || "",
            createdAt: freshMeta.createdAt || nowIso,
            updatedAt: nowIso,
            language: freshMeta.language || (isRu ? "ru" : "en"),
          };
          await storage.writeJSON("project.json", nextMeta);
        }
      }

      // ── 7. Update books.updated_at so other devices can detect newer version ──
      const serverNow = new Date().toISOString();
      await supabase
        .from("books")
        .update({ updated_at: serverNow })
        .eq("id", currentBookId);

      const sceneCount = sceneInserts.length;
      const descParts = [
        `${chapterUpserts.length} ${isRu ? "глав" : "chapters"}`,
        `${sceneCount} ${isRu ? "сцен" : "scenes"}`,
      ];
      if (savedCharCount > 0) {
        descParts.push(`${savedCharCount} ${isRu ? "персонажей" : "characters"}`);
      }
      if (savedProfileCount > 0) {
        descParts.push(`${savedProfileCount} ${isRu ? "профилей" : "profiles"}`);
      }
      if (savedStoryboardCount > 0) {
        descParts.push(`${savedStoryboardCount} ${isRu ? "раскадровок" : "storyboards"}`);
      }
      toast({
        title: isRu ? "Синхронизировано с сервером" : "Synced to server",
        description: descParts.join(", "),
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
  }, [currentBookId, localSnapshot, storage, isRu, toast, user?.id, fileName]);

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
