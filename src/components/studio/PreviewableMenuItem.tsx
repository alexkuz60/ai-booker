import { useRef, useCallback } from "react";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { supabase } from "@/integrations/supabase/client";
import type { StorageAudioFile } from "@/hooks/useStorageAudioList";

// Shared singleton audio element for hover previews
let previewAudio: HTMLAudioElement | null = null;
let currentPath: string | null = null;

function stopPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.src = "";
    currentPath = null;
  }
}

interface Props {
  file: StorageAudioFile;
  icon: React.ReactNode;
  onSelect: () => void;
}

export function PreviewableMenuItem({ file, icon, onSelect }: Props) {
  const urlCache = useRef<string | null>(null);

  const handlePointerEnter = useCallback(async () => {
    if (currentPath === file.path) return;
    stopPreview();

    if (!previewAudio) {
      previewAudio = new Audio();
      previewAudio.volume = 0.45;
    }

    let url = urlCache.current;
    if (!url) {
      const { data } = await supabase.storage
        .from("user-media")
        .createSignedUrl(file.path, 120);
      if (!data?.signedUrl) return;
      url = data.signedUrl;
      urlCache.current = url;
    }

    currentPath = file.path;
    previewAudio.src = url;
    previewAudio.currentTime = 0;
    previewAudio.play().catch(() => {});
  }, [file.path]);

  const handlePointerLeave = useCallback(() => {
    if (currentPath === file.path) stopPreview();
  }, [file.path]);

  return (
    <ContextMenuItem
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onClick={onSelect}
      className="text-xs"
    >
      {icon}
      <span className="truncate">{file.name.replace(/\.[^.]+$/, "")}</span>
    </ContextMenuItem>
  );
}

/** Call on menu close to ensure preview stops */
export function stopAudioPreview() {
  stopPreview();
}
