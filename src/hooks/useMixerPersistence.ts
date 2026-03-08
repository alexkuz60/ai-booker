import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getAudioEngine } from "@/lib/audioEngine";
import { useCloudSettings } from "@/hooks/useCloudSettings";

/**
 * Persisted mixer state per scene — saved to localStorage + cloud (user_settings).
 * Stores volume, pan, preFxBypassed, reverbBypassed per track.
 */
interface PersistedTrackMix {
  volume: number;
  pan: number;
  preFxBypassed: boolean;
  reverbBypassed: boolean;
}

type SceneMixerState = Record<string, PersistedTrackMix>;

/** All scenes' mixer states keyed by sceneId */
type AllMixerStates = Record<string, SceneMixerState>;

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
 * Restores mixer state from localStorage/cloud when sceneId changes,
 * and auto-saves changes to both localStorage and cloud.
 */
export function useMixerPersistence(sceneId: string | null, trackIds: string[]) {
  const engine = getAudioEngine();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredForRef = useRef<string | null>(null);

  // Stable trackIds key for dependency tracking
  const trackIdsKey = useMemo(() => trackIds.join(","), [trackIds]);
  const trackIdsRef = useRef(trackIds);
  trackIdsRef.current = trackIds;

  // Cloud-synced state for ALL scenes' mixer settings
  const { value: cloudStates, update: saveCloudStates, loaded: cloudLoaded } =
    useCloudSettings<AllMixerStates>("mixer_states", {});

  const cloudStatesRef = useRef(cloudStates);
  cloudStatesRef.current = cloudStates;

  // Restore mixer state when scene changes
  useEffect(() => {
    if (!sceneId || trackIds.length === 0 || !cloudLoaded) return;
    if (restoredForRef.current === sceneId) return;
    restoredForRef.current = sceneId;

    // Try localStorage first (faster), fallback to cloud
    const saved = loadLocal(sceneId) ?? cloudStatesRef.current[sceneId] ?? null;
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
  }, [sceneId, trackIdsKey, engine, cloudLoaded]);

  // Debounced save to both localStorage and cloud
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
      saveCloudStates((prev) => ({ ...prev, [sceneId]: state }));
    }, 300);
  }, [sceneId, engine, saveCloudStates]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { scheduleSave };
}
