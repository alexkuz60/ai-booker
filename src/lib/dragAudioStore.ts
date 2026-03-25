/**
 * Module-level store for drag-and-drop of generated audio blobs.
 * Used to pass Blob/URL data between AtmospherePanel/FreesoundPanel (drag source)
 * and StorageTab (drop target) via HTML5 DnD API.
 */

export interface DragAudioItem {
  blob?: Blob;
  /** Remote URL to fetch blob from (used by Freesound) */
  fetchUrl?: string;
  prompt: string;
  category: "sfx" | "atmosphere" | "music";
}

const store = new Map<string, DragAudioItem>();

export const DRAG_AUDIO_MIME = "application/x-audio-drag-id";

export function setDragAudio(id: string, item: DragAudioItem) {
  store.set(id, item);
}

export function getDragAudio(id: string): DragAudioItem | undefined {
  return store.get(id);
}

export function clearDragAudio(id: string) {
  store.delete(id);
}
