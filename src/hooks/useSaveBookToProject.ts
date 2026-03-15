import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { syncStructureToLocal } from "@/lib/localSync";
import {
  classifySection,
  type ChapterStatus,
  type Scene,
  type TocChapter,
} from "@/pages/parser/types";
import {
  PROJECT_META_VERSION,
  type ProjectMeta,
  type ProjectStorage,
} from "@/lib/projectStorage";

interface LocalBookSnapshot {
  toc: TocChapter[];
  parts: Array<{ id: string; title: string; partNumber: number }>;
  chapterIdMap: Map<number, string>;
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
}

interface UseSaveBookToProjectParams {
  isRu: boolean;
  currentBookId?: string | null;
  localSnapshot?: LocalBookSnapshot;
}

async function ensureStorage(
  storage: ProjectStorage | null,
  openProject: () => Promise<ProjectStorage>,
): Promise<ProjectStorage> {
  if (storage) return storage;
  return openProject();
}

export function useSaveBookToProject({ isRu, currentBookId, localSnapshot }: UseSaveBookToProjectParams) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { storage, openProject, backend, meta } = useProjectStorageContext();
  const [saving, setSaving] = useState(false);

  const saveBook = useCallback(async () => {
    if (!currentBookId) {
      toast({
        title: isRu ? "Книга не выбрана" : "No book selected",
        description: isRu ? "Откройте книгу и повторите сохранение" : "Open a book and try saving again",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      if (backend === "none") {
        throw new Error(isRu ? "Локальное хранилище не поддерживается в этом браузере" : "Local storage is not supported in this browser");
      }

      const activeStorage = await ensureStorage(storage, openProject);

      const { data: book, error: bookError } = await supabase
        .from("books")
        .select("id, title, file_name, file_path, user_id")
        .eq("id", currentBookId)
        .maybeSingle();

      if (bookError || !book) {
        throw new Error(isRu ? "Книга не найдена" : "Book not found");
      }

      let toc: TocChapter[] = [];
      let partsForSync: Array<{ id: string; title: string; partNumber: number }> = [];
      let chapterIdMap = new Map<number, string>();
      let chapterResults = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();

      if (localSnapshot) {
        toc = localSnapshot.toc.map((entry) => ({ ...entry }));
        partsForSync = localSnapshot.parts.map((part) => ({ ...part }));
        chapterIdMap = new Map(localSnapshot.chapterIdMap);
        chapterResults = new Map(
          Array.from(localSnapshot.chapterResults.entries()).map(([index, result]) => [
            index,
            {
              scenes: result.scenes.map((scene) => ({ ...scene })),
              status: result.status,
            },
          ]),
        );
      } else {
        const [partsRes, chaptersRes] = await Promise.all([
          supabase
            .from("book_parts")
            .select("id, part_number, title")
            .eq("book_id", book.id)
            .order("part_number"),
          supabase
            .from("book_chapters")
            .select("id, chapter_number, title, level, start_page, end_page, part_id")
            .eq("book_id", book.id)
            .order("chapter_number"),
        ]);

        if (partsRes.error) throw partsRes.error;
        if (chaptersRes.error) throw chaptersRes.error;

        const parts = partsRes.data ?? [];
        const chapters = chaptersRes.data ?? [];

        if (chapters.length === 0) {
          throw new Error(isRu ? "У книги нет глав для сохранения" : "Book has no chapters to save");
        }

        const chapterIds = chapters.map((chapter) => chapter.id);
        const scenesRes = chapterIds.length
          ? await supabase
              .from("book_scenes")
              .select("id, chapter_id, scene_number, title, content, scene_type, mood, bpm")
              .in("chapter_id", chapterIds)
              .order("scene_number")
          : { data: [], error: null };

        if (scenesRes.error) throw scenesRes.error;

        const partById = new Map(parts.map((part) => [part.id, part.title]));

        toc = chapters.map((chapter) => ({
          title: chapter.title,
          startPage: chapter.start_page ?? 0,
          endPage: chapter.end_page ?? 0,
          level: chapter.level ?? 0,
          partTitle: chapter.part_id ? partById.get(chapter.part_id) : undefined,
          sectionType: classifySection(chapter.title),
        }));

        const scenesByChapterId = new Map<string, Scene[]>();
        for (const row of scenesRes.data ?? []) {
          const chapterScenes = scenesByChapterId.get(row.chapter_id) ?? [];
          chapterScenes.push({
            id: row.id,
            scene_number: row.scene_number,
            title: row.title,
            content: row.content ?? undefined,
            content_preview: row.content?.slice(0, 200) ?? undefined,
            scene_type: row.scene_type ?? "mixed",
            mood: row.mood ?? "neutral",
            bpm: row.bpm ?? 120,
          });
          scenesByChapterId.set(row.chapter_id, chapterScenes);
        }

        chapters.forEach((chapter, index) => {
          chapterIdMap.set(index, chapter.id);
          const chapterScenes = scenesByChapterId.get(chapter.id) ?? [];
          chapterResults.set(index, {
            scenes: chapterScenes,
            status: chapterScenes.length > 0 ? "done" : "pending",
          });
        });

        partsForSync = parts.map((part) => ({
          id: part.id,
          title: part.title,
          partNumber: part.part_number,
        }));
      }

      if (toc.length === 0) {
        throw new Error(isRu ? "У книги нет данных для сохранения" : "No book data to save");
      }

      await syncStructureToLocal(activeStorage, {
        bookId: book.id,
        title: book.title,
        fileName: book.file_name,
        toc,
        parts: partsForSync,
        chapterIdMap,
        chapterResults,
      });

      if (book.file_path) {
        const { data: pdfBlob, error: pdfError } = await supabase.storage
          .from("book-uploads")
          .download(book.file_path);
        if (pdfError) throw pdfError;
        if (pdfBlob) {
          await activeStorage.writeBlob("source/book.pdf", pdfBlob);
        }
      }

      const nowIso = new Date().toISOString();
      const nextMeta: ProjectMeta = {
        version: PROJECT_META_VERSION,
        bookId: book.id,
        title: book.title,
        userId: meta?.userId || user?.id || book.user_id,
        createdAt: meta?.createdAt || nowIso,
        updatedAt: nowIso,
        language: meta?.language || (isRu ? "ru" : "en"),
      };
      await activeStorage.writeJSON("project.json", nextMeta);

      toast({
        title: isRu ? "Книга сохранена" : "Book saved",
        description: `${activeStorage.projectName} · ${toc.length} ${isRu ? "глав" : "chapters"}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast({
        title: isRu ? "Ошибка сохранения" : "Save failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [currentBookId, backend, storage, openProject, isRu, toast, meta?.userId, meta?.createdAt, meta?.language, user?.id]);

  return {
    saveBook,
    saving,
  };
}
