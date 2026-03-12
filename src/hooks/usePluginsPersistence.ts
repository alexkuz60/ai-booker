import { useEffect, useCallback, useRef, useMemo } from "react";
import { getAudioEngine } from "@/lib/audioEngine";
import { useCloudSettings } from "@/hooks/useCloudSettings";

/**
 * Persisted channel-plugin state per scene — saved to localStorage + cloud (user_settings).
 * Stores EQ (low/mid/high + bypass), Compressor (threshold/ratio/knee/attack/release + bypass),
 * and Limiter (threshold + bypass) per track.
 */
interface PersistedTrackPlugins {
  eq: { low: number; mid: number; high: number; bypassed: boolean };
  comp: { threshold: number; ratio: number; knee: number; attack: number; release: number; bypassed: boolean };
  limiter: { threshold: number; bypassed: boolean };
}

type ScenePluginsState = Record<string, PersistedTrackPlugins>;
type AllPluginsStates = Record<string, ScenePluginsState>;

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

function saveLocal(sceneId: string, state: ScenePluginsState) {
  try {
    localStorage.setItem(localKey(sceneId), JSON.stringify(state));
  } catch {}
}

/**
 * Restores channel-plugin state from localStorage/cloud when sceneId changes,
 * and auto-saves changes to both localStorage and cloud.
 */
export function usePluginsPersistence(sceneId: string | null, trackIds: string[]) {
  const engine = getAudioEngine();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredForRef = useRef<string | null>(null);

  const trackIdsKey = useMemo(() => trackIds.join(","), [trackIds]);
  const trackIdsRef = useRef(trackIds);
  trackIdsRef.current = trackIds;

  const { value: cloudStates, update: saveCloudStates, loaded: cloudLoaded } =
    useCloudSettings<AllPluginsStates>("plugins_states", {});

  const cloudStatesRef = useRef(cloudStates);
  cloudStatesRef.current = cloudStates;

  // Restore plugin state when scene changes
  useEffect(() => {
    if (!sceneId || trackIds.length === 0 || !cloudLoaded) return;
    if (restoredForRef.current === sceneId) return;
    restoredForRef.current = sceneId;

    const saved = loadLocal(sceneId) ?? cloudStatesRef.current[sceneId] ?? null;
    if (!saved) return;

    for (const trackId of trackIds) {
      const p = saved[trackId];
      if (!p) continue;

      // EQ
      if (p.eq) {
        engine.setTrackEqLow(trackId, p.eq.low);
        engine.setTrackEqMid(trackId, p.eq.mid);
        engine.setTrackEqHigh(trackId, p.eq.high);
        engine.setTrackEqBypassed(trackId, p.eq.bypassed);
      }
      // Compressor
      if (p.comp) {
        engine.setTrackCompThreshold(trackId, p.comp.threshold);
        engine.setTrackCompRatio(trackId, p.comp.ratio);
        engine.setTrackCompKnee(trackId, p.comp.knee);
        engine.setTrackCompAttack(trackId, p.comp.attack);
        engine.setTrackCompRelease(trackId, p.comp.release);
        engine.setTrackPreFxBypassed(trackId, p.comp.bypassed);
      }
      // Limiter
      if (p.limiter) {
        engine.setTrackLimiterThreshold(trackId, p.limiter.threshold);
        engine.setTrackLimiterBypassed(trackId, p.limiter.bypassed);
      }
    }
  }, [sceneId, trackIdsKey, engine, cloudLoaded]);

  // Debounced save
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
      saveLocal(sceneId, state);
      saveCloudStates((prev) => ({ ...prev, [sceneId]: state }));
    }, 300);
  }, [sceneId, engine, saveCloudStates]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { scheduleSave };
}
