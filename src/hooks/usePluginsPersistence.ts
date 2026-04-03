import { useEffect, useCallback, useRef, useMemo } from "react";
import { getAudioEngine } from "@/lib/audioEngine";
import type { ProjectStorage } from "@/lib/projectStorage";
import {
  writeMixerState,
  readMixerState,
  type SceneMixerSnapshot,
  type PersistedTrackPlugins,
} from "@/lib/localMixerState";

/**
 * Persisted channel-plugin state per scene.
 * - Fast cache: localStorage (sync)
 * - Durable store: OPFS mixer_state.json (shared file with mixer state)
 */
type ScenePluginsState = Record<string, PersistedTrackPlugins>;

function localKey(sceneId: string) {
  return `plugins-state-${sceneId}`;
}

function loadLocal(sceneId: string): ScenePluginsState | null {
  try {
    const raw = localStorage.getItem(localKey(sceneId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLocalCache(sceneId: string, state: ScenePluginsState) {
  try {
    localStorage.setItem(localKey(sceneId), JSON.stringify(state));
  } catch {}
}

/**
 * Restores channel-plugin state when sceneId changes,
 * auto-saves to localStorage + OPFS.
 */
export function usePluginsPersistence(
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

  // Restore plugin state when scene changes
  useEffect(() => {
    if (!sceneId || trackIds.length === 0) return;
    if (restoredForRef.current === sceneId) return;
    restoredForRef.current = sceneId;

    // Try localStorage first
    const saved = loadLocal(sceneId);
    if (saved) {
      applyPluginState(saved, trackIds, engine);
      return;
    }

    // Fallback: OPFS
    if (storageRef.current) {
      readMixerState(storageRef.current, sceneId).then((opfs) => {
        if (!opfs) return;
        const flat: ScenePluginsState = {};
        for (const [tid, entry] of Object.entries(opfs)) {
          if (entry.plugins) flat[tid] = entry.plugins;
        }
        if (Object.keys(flat).length > 0) {
          saveLocalCache(sceneId, flat);
          applyPluginState(flat, trackIdsRef.current, engine);
        }
      });
    }
  }, [sceneId, trackIdsKey, engine]);

  // Debounced save to localStorage + OPFS
  const scheduleSave = useCallback(() => {
    if (!sceneId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const ids = trackIdsRef.current;
      const state: ScenePluginsState = {};

      for (const trackId of ids) {
        const ms = engine.getTrackMixState(trackId);
        if (!ms) continue;
        state[trackId] = {
          eq: { low: ms.eq.low, mid: ms.eq.mid, high: ms.eq.high, bypassed: ms.eq.bypassed },
          comp: {
            threshold: ms.comp.threshold,
            ratio: ms.comp.ratio,
            knee: ms.comp.knee,
            attack: ms.comp.attack,
            release: ms.comp.release,
            bypassed: ms.comp.bypassed,
          },
          limiter: { threshold: ms.limiter.threshold, bypassed: ms.limiter.bypassed },
        };
      }

      if (Object.keys(state).length === 0) return;

      // Fast cache
      saveLocalCache(sceneId, state);

      // Durable OPFS write — merge with existing mixer data
      const s = storageRef.current;
      if (s) {
        readMixerState(s, sceneId).then((existing) => {
          const snapshot: SceneMixerSnapshot = existing || {};
          for (const [tid, plugins] of Object.entries(state)) {
            snapshot[tid] = {
              mix: snapshot[tid]?.mix ?? { volume: 80, pan: 0, preFxBypassed: false, reverbBypassed: true },
              plugins,
            };
          }
          writeMixerState(s, sceneId, snapshot);
        });
      }
    }, 300);
  }, [sceneId, engine]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { scheduleSave };
}

function applyPluginState(
  saved: ScenePluginsState,
  trackIds: string[],
  engine: ReturnType<typeof getAudioEngine>,
) {
  for (const trackId of trackIds) {
    const p = saved[trackId];
    if (!p) continue;

    if (p.eq) {
      engine.setTrackEqLow(trackId, p.eq.low);
      engine.setTrackEqMid(trackId, p.eq.mid);
      engine.setTrackEqHigh(trackId, p.eq.high);
      engine.setTrackEqBypassed(trackId, p.eq.bypassed);
    }
    if (p.comp) {
      engine.setTrackCompThreshold(trackId, p.comp.threshold);
      engine.setTrackCompRatio(trackId, p.comp.ratio);
      engine.setTrackCompKnee(trackId, p.comp.knee);
      engine.setTrackCompAttack(trackId, p.comp.attack);
      engine.setTrackCompRelease(trackId, p.comp.release);
      engine.setTrackPreFxBypassed(trackId, p.comp.bypassed);
    }
    if (p.limiter) {
      engine.setTrackLimiterThreshold(trackId, p.limiter.threshold);
      engine.setTrackLimiterBypassed(trackId, p.limiter.bypassed);
    }
  }
}
