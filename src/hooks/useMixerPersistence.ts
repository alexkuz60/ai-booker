import { useState, useEffect, useCallback, useRef } from "react";
import { getAudioEngine, type TrackMixState } from "@/lib/audioEngine";

/**
 * Persisted mixer state per scene — saved to localStorage.
 * Stores volume, pan, preFxBypassed, reverbBypassed per track.
 */
interface PersistedTrackMix {
  volume: number;
  pan: number;
  preFxBypassed: boolean;
  reverbBypassed: boolean;
}

type SceneMixerState = Record<string, PersistedTrackMix>;

function storageKey(sceneId: string) {
  return `mixer-state-${sceneId}`;
}

function loadState(sceneId: string): SceneMixerState | null {
  try {
    const raw = localStorage.getItem(storageKey(sceneId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveState(sceneId: string, state: SceneMixerState) {
  try {
    localStorage.setItem(storageKey(sceneId), JSON.stringify(state));
  } catch {}
}

/**
 * Restores mixer state from localStorage when sceneId changes,
 * and auto-saves changes when engine mix state updates.
 */
export function useMixerPersistence(sceneId: string | null, trackIds: string[]) {
  const engine = getAudioEngine();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [restoredFor, setRestoredFor] = useState<string | null>(null);

  // Restore mixer state when scene changes
  useEffect(() => {
    if (!sceneId || trackIds.length === 0) return;
    if (restoredFor === sceneId) return;

    const saved = loadState(sceneId);
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
    setRestoredFor(sceneId);
  }, [sceneId, trackIds.join(","), engine]);

  // Save mixer state periodically (debounced)
  const persistCurrentState = useCallback(() => {
    if (!sceneId || trackIds.length === 0) return;

    const state: SceneMixerState = {};
    for (const trackId of trackIds) {
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
    if (Object.keys(state).length > 0) {
      saveState(sceneId, state);
    }
  }, [sceneId, trackIds.join(","), engine]);

  // Debounced save on any mixer interaction
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(persistCurrentState, 300);
  }, [persistCurrentState]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { scheduleSave };
}
