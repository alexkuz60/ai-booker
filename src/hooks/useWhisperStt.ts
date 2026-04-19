/**
 * useWhisperStt — main-thread state holder around `whisperStt.ts`.
 *
 * Surfaces:
 *   - cached: whether Whisper files exist in browser cache (best-effort)
 *   - downloading / progress: live load progress
 *   - load(): explicit pre-warm trigger
 *   - clear(): wipes cache + drops in-memory pipeline
 *
 * Refreshes `cached` on the WHISPER_CACHE_EVENT so VocoLocoModelManager
 * stays in sync with one-off downloads.
 */
import { useCallback, useEffect, useState } from "react";
import {
  hasWhisperCached,
  loadWhisper,
  clearWhisperCache,
  WHISPER_CACHE_EVENT,
  type WhisperLoadProgress,
} from "@/lib/vocoloco/whisperStt";

export function useWhisperStt() {
  const [cached, setCached] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<WhisperLoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setCached(await hasWhisperCached());
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(WHISPER_CACHE_EVENT, onChange);
    return () => window.removeEventListener(WHISPER_CACHE_EVENT, onChange);
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

  return { cached, downloading, progress, error, load, clear };
}
