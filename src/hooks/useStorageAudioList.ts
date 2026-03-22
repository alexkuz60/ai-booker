import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface StorageAudioFile {
  name: string;
  path: string;       // full path: userId/category/name
  category: "atmosphere" | "sfx";
  size: number;
}

const CATEGORIES = ["atmosphere", "sfx"] as const;

/**
 * Loads user's atmosphere and sfx audio files from Supabase storage.
 */
export function useStorageAudioList(userId: string | undefined) {
  const [files, setFiles] = useState<StorageAudioFile[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) { setFiles([]); return; }
    setLoading(true);
    try {
      const all: StorageAudioFile[] = [];
      await Promise.all(
        CATEGORIES.map(async (cat) => {
          const { data } = await supabase.storage
            .from("user-media")
            .list(`${userId}/${cat}`, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
          if (data) {
            for (const f of data) {
              if (!f.name || f.name.startsWith(".")) continue;
              all.push({
                name: f.name,
                path: `${userId}/${cat}/${f.name}`,
                category: cat,
                size: (f.metadata as any)?.size ?? 0,
              });
            }
          }
        }),
      );
      setFiles(all);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  const atmosphere = files.filter(f => f.category === "atmosphere");
  const sfx = files.filter(f => f.category === "sfx");

  return { files, atmosphere, sfx, loading, refresh };
}
