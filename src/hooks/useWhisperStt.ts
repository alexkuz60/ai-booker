/**
 * useWhisperStt — main-thread state holder around `whisperStt.ts`.
 *
 * Surfaces the active size's cache + load progress. Switching size via
 * `setSize` persists choice via useCloudSettings (handled in the panel)
 * and refreshes `cached` from Cache Storage immediately.
 */
import { useCallback, useEffect, useState } from "react";
import {
  hasWhisperCached,
  loadWhisper,
  clearWhisperCache,
  setWhisperSize,
  getWhisperSize,
  WHISPER_CACHE_EVENT,
  WHISPER_SIZE_EVENT,
  type WhisperLoadProgress,
  type WhisperSize,
} from "@/lib/vocoloco/whisperStt";

export function useWhisperStt() {
  const [size, setSizeState] = useState<WhisperSize>(getWhisperSize());
  const [cached, setCached] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<WhisperLoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (s: WhisperSize = size) => {
    setCached(await hasWhisperCached(s));
  }, [size]);

  useEffect(() => {
    void refresh();
    const onCacheChange = () => void refresh();
    const onSizeChange = (e: Event) => {
      const next = (e as CustomEvent<WhisperSize>).detail;
      setSizeState(next);
      void refresh(next);
    };
    window.addEventListener(WHISPER_CACHE_EVENT, onCacheChange);
    window.addEventListener(WHISPER_SIZE_EVENT, onSizeChange as EventListener);
    return () => {
      window.removeEventListener(WHISPER_CACHE_EVENT, onCacheChange);
      window.removeEventListener(WHISPER_SIZE_EVENT, onSizeChange as EventListener);
    };
  }, [refresh]);

  const load = useCallback(async (): Promise<boolean> => {
    if (downloading) return false;
    setDownloading(true);
    setError(null);
    try {
      await loadWhisper((p) => setProgress(p));
      await refresh();
      return true;
    } catch (e: any) {
      setError(e?.message ?? String(e));
      return false;
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  }, [downloading, refresh]);

  const clear = useCallback(async () => {
    await clearWhisperCache();
    await refresh();
  }, [refresh]);

  const setSize = useCallback((next: WhisperSize) => {
    setWhisperSize(next);
    // setWhisperSize emits WHISPER_SIZE_EVENT → listener will sync state + refresh
  }, []);

  return { size, setSize, cached, downloading, progress, error, load, clear };
}
