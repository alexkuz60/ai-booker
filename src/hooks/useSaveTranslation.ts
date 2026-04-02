/**
 * useSaveTranslation — pushes/restores the translation OPFS project
 * as a ZIP blob to Supabase storage (book-uploads bucket).
 */

import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { OPFSStorage, type ProjectStorage, type ProjectMeta } from "@/lib/projectStorage";
import { useAuth } from "@/hooks/useAuth";
import { paths } from "@/lib/projectPaths";
import { getLinkedTranslationProjectName } from "@/lib/translationMirrorResolver";

const BUCKET = "book-uploads";

const CYRILLIC_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'Yo', Ж: 'Zh', З: 'Z', И: 'I',
  Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T',
  У: 'U', Ф: 'F', Х: 'H', Ц: 'Ts', Ч: 'Ch', Ш: 'Sh', Щ: 'Sch', Ъ: '', Ы: 'Y',
  Ь: '', Э: 'E', Ю: 'Yu', Я: 'Ya',
};

function sanitizeStorageKey(name: string): string {
  return name
    .replace(/[а-яё]/gi, (c) => CYRILLIC_MAP[c] || c)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .replace(/_{2,}/g, "_");
}

function translationStoragePath(userId: string, projectName: string): string {
  return `${userId}/translations/${sanitizeStorageKey(projectName)}.zip`;
}

interface UseSaveTranslationOpts {
  translationStorage: ProjectStorage | null;
  sourceStorage: ProjectStorage | null;
  sourceMeta: ProjectMeta | null;
  isRu: boolean;
  onRestored?: () => void;
}

export function useSaveTranslation({
  translationStorage,
  sourceStorage,
  sourceMeta,
  isRu,
  onRestored,
}: UseSaveTranslationOpts) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const saveTranslation = useCallback(async () => {
    if (!translationStorage || !user?.id) {
      toast.error(isRu ? "Проект перевода не открыт" : "Translation project not open");
      return;
    }

    setSaving(true);
    try {
      const zip = await translationStorage.exportZip();
      const storagePath = translationStoragePath(user.id, translationStorage.projectName);

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, zip, {
          contentType: "application/zip",
          upsert: true,
        });

      if (error) throw error;

      try {
        const meta = await translationStorage.readJSON<Record<string, unknown>>("project.json");
        if (meta) {
          await translationStorage.writeJSON("project.json", {
            ...meta,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch {}

      toast.success(isRu ? "Перевод сохранён на сервер" : "Translation saved to server");
    } catch (err) {
      console.error("[SaveTranslation] error:", err);
      toast.error(isRu ? "Ошибка сохранения перевода" : "Failed to save translation");
    } finally {
      setSaving(false);
    }
  }, [translationStorage, user?.id, isRu]);

  const restoreTranslation = useCallback(async () => {
    if (!user?.id || !sourceStorage) {
      toast.error(isRu ? "Исходный проект не открыт" : "Source project not open");
      return;
    }

    setRestoring(true);
    try {
      const liveSourceMeta = await sourceStorage.readJSON<ProjectMeta>(paths.projectMeta()).catch(() => null);
      const effectiveSourceMeta = liveSourceMeta ?? sourceMeta;
      if (!effectiveSourceMeta) {
        toast.error(isRu ? "Метаданные проекта недоступны" : "Project metadata unavailable");
        return;
      }

      const projectName = translationStorage?.projectName
        ?? getLinkedTranslationProjectName(effectiveSourceMeta);

      if (!projectName) {
        toast.error(
          isRu
            ? "В project.json нет ссылки на проект перевода"
            : "Translation project link is missing in project.json",
        );
        return;
      }

      // 1. Try to download ZIP from server
      const storagePath = translationStoragePath(user.id, projectName);
      const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);

      if (error || !data) {
        toast.error(
          isRu
            ? "Перевод не найден на сервере"
            : "Translation not found on server",
        );
        return;
      }

      // 2. Wipe existing OPFS folder if exists
      try {
        await OPFSStorage.deleteProject(projectName);
      } catch {}

      // 3. Create fresh OPFS project and import ZIP
      const store = await OPFSStorage.openOrCreate(projectName);
      await store.importZip(data);

      const importedMeta = await store
        .readJSON<Pick<ProjectMeta, "createdAt" | "targetLanguage">>(paths.projectMeta())
        .catch(() => null);
      const currentSourceMeta = await sourceStorage.readJSON<Record<string, unknown>>(paths.projectMeta()).catch(() => null);
      if (currentSourceMeta) {
        await sourceStorage.writeJSON(paths.projectMeta(), {
          ...currentSourceMeta,
          translationProject: {
            projectName,
            targetLanguage: importedMeta?.targetLanguage ?? (effectiveSourceMeta.language === "ru" ? "en" : "ru"),
            createdAt: effectiveSourceMeta.translationProject?.createdAt ?? importedMeta?.createdAt ?? new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        });
      }

      toast.success(
        isRu
          ? "Перевод восстановлен с сервера"
          : "Translation restored from server",
      );

      onRestored?.();
    } catch (err) {
      console.error("[RestoreTranslation] error:", err);
      toast.error(
        isRu
          ? "Ошибка восстановления перевода"
          : "Failed to restore translation",
      );
    } finally {
      setRestoring(false);
    }
  }, [user?.id, sourceStorage, sourceMeta, translationStorage, isRu, onRestored]);

  return { saveTranslation, saving, restoreTranslation, restoring };
}
