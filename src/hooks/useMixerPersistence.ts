import { useEffect, useCallback, useRef, useMemo } from "react";
import { getAudioEngine } from "@/lib/audioEngine";
import type { ProjectStorage } from "@/lib/projectStorage";
import {
  writeMixerState,
  readMixerState,
  type SceneMixerSnapshot,
  type PersistedTrackMix,
} from "@/lib/localMixerState";

/**
 * Persisted mixer state per scene.
 * - Fast cache: localStorage (sync reads for useTimelinePlayer initial load)
 * - Durable store: OPFS mixer_state.json (survives device switch via server sync)
 */
type SceneMixerState = Record<string, PersistedTrackMix>;

export function localKey(sceneId: string) {
  return `mixer-state-${sceneId}`;
}

/** Sync read from localStorage — used by useTimelinePlayer for instant restore */
export function loadLocal(sceneId: string): SceneMixerState | null {
  try {
    const raw = localStorage.getItem(localKey(sceneId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLocalCache(sceneId: string, state: SceneMixerState) {
  try {
    localStorage.setItem(localKey(sceneId), JSON.stringify(state));
  } catch {}
}

/**
 * Restores mixer state when sceneId changes,
 * auto-saves to localStorage (fast) + OPFS (durable).
 */
export function useMixerPersistence(
  sceneId: string | null,
  trackIds: string[],
  storage?: ProjectStorage | null,
) {
  const engine = getAudioEngine();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredForRef = useRef<string | null>(null);
  const storageRef = useRef(storage);
  storageRef.current = storage;

  const trackIdsKey = useMemo(() => trackIds.join(","), [trackIds]);
  const trackIdsRef = useRef(trackIds);
  trackIdsRef.current = trackIds;

  // Restore mixer state when scene changes or track IDs change.
  // Primary restore happens via initial TrackConfig values in useTimelinePlayer.
  // This effect handles re-applying state when track composition changes within
  // an already-loaded scene (e.g. clip added/removed but engine tracks persist).
  const restoreKey = `${sceneId}|${trackIdsKey}`;
  useEffect(() => {
    if (!sceneId || trackIds.length === 0) return;
    if (restoredForRef.current === restoreKey) return;
    restoredForRef.current = restoreKey;

    // Try localStorage first (sync, fast)
    const saved = loadLocal(sceneId);
    if (saved) {
      applyMixState(saved, trackIds, engine);
      return;
    }

    // Fallback: try OPFS (async)
    if (storageRef.current) {
      readMixerState(storageRef.current, sceneId).then((opfs) => {
        if (!opfs) return;
        const flat: SceneMixerState = {};
        for (const [tid, entry] of Object.entries(opfs)) {
          flat[tid] = entry.mix;
        }
        // Also populate localStorage cache for next time
        saveLocalCache(sceneId, flat);
        applyMixState(flat, trackIdsRef.current, engine);
      });
    }
  }, [sceneId, restoreKey, engine, trackIds]);

  // Debounced save to localStorage + OPFS
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

      // Fast cache
      saveLocalCache(sceneId, state);

      // Durable OPFS write — merge with existing plugins data
      const s = storageRef.current;
      if (s) {
        readMixerState(s, sceneId).then((existing) => {
          const snapshot: SceneMixerSnapshot = existing || {};
          for (const [tid, mix] of Object.entries(state)) {
            snapshot[tid] = {
              ...snapshot[tid],
              mix,
            };
          }
          writeMixerState(s, sceneId, snapshot);
        });
      }
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

function applyMixState(
  saved: SceneMixerState,
  trackIds: string[],
  engine: ReturnType<typeof getAudioEngine>,
) {
  for (const trackId of trackIds) {
    const mix = saved[trackId];
    if (!mix) continue;
    const current = engine.getTrackMixState(trackId);
    if (!current) continue;
    engine.setTrackVolume(trackId, mix.volume);
    engine.setTrackPan(trackId, mix.pan);
    engine.setTrackPreFxBypassed(trackId, mix.preFxBypassed);
    engine.setTrackReverbBypassed(trackId, mix.reverbBypassed);
  }
}
