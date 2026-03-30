/**
 * useSaveTranslation — pushes/restores the translation OPFS project
 * as a ZIP blob to Supabase storage (book-uploads bucket).
 */

import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { OPFSStorage, type ProjectStorage, type ProjectMeta } from "@/lib/projectStorage";
import { useAuth } from "@/hooks/useAuth";

const BUCKET = "book-uploads";

function translationStoragePath(userId: string, projectName: string): string {
  return `${userId}/translations/${projectName}.zip`;
}

/**
 * Derive the expected translation project name from source project.
 * Convention: SourceName_EN or SourceName_RU
 */
function deriveTranslationProjectName(
  sourceProjectName: string,
  sourceLang: string,
): string {
  const targetLang = sourceLang === "ru" ? "EN" : "RU";
  return `${sourceProjectName}_${targetLang}`;
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
    if (!user?.id || !sourceStorage || !sourceMeta) {
      toast.error(isRu ? "Исходный проект не открыт" : "Source project not open");
      return;
    }

    const projectName =
      translationStorage?.projectName ??
      deriveTranslationProjectName(sourceStorage.projectName, sourceMeta.language ?? "ru");

    setRestoring(true);
    try {
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
