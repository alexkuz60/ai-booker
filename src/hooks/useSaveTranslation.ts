/**
 * useSaveTranslation — pushes/restores the translation OPFS project
 * as a ZIP blob to Supabase storage (book-uploads bucket).
 */

import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ProjectStorage } from "@/lib/projectStorage";
import { useAuth } from "@/hooks/useAuth";

const BUCKET = "book-uploads";

function translationStoragePath(userId: string, projectName: string): string {
  return `${userId}/translations/${projectName}.zip`;
}

interface UseSaveTranslationOpts {
  translationStorage: ProjectStorage | null;
  isRu: boolean;
}

export function useSaveTranslation({ translationStorage, isRu }: UseSaveTranslationOpts) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const saveTranslation = useCallback(async () => {
    if (!translationStorage || !user?.id) {
      toast.error(isRu ? "Проект перевода не открыт" : "Translation project not open");
      return;
    }

    setSaving(true);
    try {
      // 1. Export OPFS project as ZIP
      const zip = await translationStorage.exportZip();

      // 2. Upload to storage
      const storagePath = translationStoragePath(user.id, translationStorage.projectName);

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, zip, {
          contentType: "application/zip",
          upsert: true,
        });

      if (error) throw error;

      // 3. Update timestamp in translation project.json
      try {
        const meta = await translationStorage.readJSON<Record<string, unknown>>("project.json");
        if (meta) {
          await translationStorage.writeJSON("project.json", {
            ...meta,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch {}

      toast.success(
        isRu
          ? "Перевод сохранён на сервер"
          : "Translation saved to server",
      );
    } catch (err) {
      console.error("[SaveTranslation] error:", err);
      toast.error(
        isRu
          ? "Ошибка сохранения перевода"
          : "Failed to save translation",
      );
    } finally {
      setSaving(false);
    }
  }, [translationStorage, user?.id, isRu]);

  return { saveTranslation, saving };
}
