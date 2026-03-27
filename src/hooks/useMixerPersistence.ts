import { useEffect, useCallback, useRef, useMemo } from "react";
import { getAudioEngine } from "@/lib/audioEngine";

/**
 * Persisted mixer state per scene — saved to localStorage ONLY.
 * DB sync happens exclusively during "Push to Server" / "Restore from Server".
 */
interface PersistedTrackMix {
  volume: number;
  pan: number;
  preFxBypassed: boolean;
  reverbBypassed: boolean;
}

type SceneMixerState = Record<string, PersistedTrackMix>;

function localKey(sceneId: string) {
  return `mixer-state-${sceneId}`;
}

function loadLocal(sceneId: string): SceneMixerState | null {
  try {
    const raw = localStorage.getItem(localKey(sceneId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLocal(sceneId: string, state: SceneMixerState) {
  try {
    localStorage.setItem(localKey(sceneId), JSON.stringify(state));
  } catch {}
}

/**
 * Restores mixer state from localStorage when sceneId changes,
 * and auto-saves changes to localStorage only (no cloud writes).
 */
export function useMixerPersistence(sceneId: string | null, trackIds: string[]) {
  const engine = getAudioEngine();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredForRef = useRef<string | null>(null);

  const trackIdsKey = useMemo(() => trackIds.join(","), [trackIds]);
  const trackIdsRef = useRef(trackIds);
  trackIdsRef.current = trackIds;

  // Restore mixer state when scene changes or track IDs change
  const restoreKey = `${sceneId}|${trackIdsKey}`;
  useEffect(() => {
    if (!sceneId || trackIds.length === 0) return;
    if (restoredForRef.current === restoreKey) return;
    restoredForRef.current = restoreKey;

    const saved = loadLocal(sceneId);
    if (saved) {
      for (const trackId of trackIds) {
        const mix = saved[trackId];
        if (!mix) continue;
        engine.setTrackVolume(trackId, mix.volume);
        engine.setTrackPan(trackId, mix.pan);
        engine.setTrackPreFxBypassed(trackId, mix.preFxBypassed);
        engine.setTrackReverbBypassed(trackId, mix.reverbBypassed);
      }
    }
  }, [sceneId, restoreKey, engine]);

  // Debounced save to localStorage only
  const scheduleSave = useCallback(() => {
    if (!sceneId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const ids = trackIdsRef.current;
      const state: SceneMixerState = {};
      for (const trackId of ids) {
        const mix = engine.getTrackMixState(trackId);
        if (mix) {
          state[trackId] = {
            volume: mix.volume,
            pan: mix.pan,
            preFxBypassed: mix.preFxBypassed,
            reverbBypassed: mix.reverbBypassed,
          };
        }
      }
      if (Object.keys(state).length === 0) return;
      saveLocal(sceneId, state);
    }, 300);
  }, [sceneId, engine]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { scheduleSave };
}
