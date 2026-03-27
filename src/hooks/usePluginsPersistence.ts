import { useEffect, useCallback, useRef, useMemo } from "react";
import { getAudioEngine } from "@/lib/audioEngine";

/**
 * Persisted channel-plugin state per scene — saved to localStorage ONLY.
 * DB sync happens exclusively during "Push to Server" / "Restore from Server".
 */
interface PersistedTrackPlugins {
  eq: { low: number; mid: number; high: number; bypassed: boolean };
  comp: { threshold: number; ratio: number; knee: number; attack: number; release: number; bypassed: boolean };
  limiter: { threshold: number; bypassed: boolean };
}

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

function saveLocal(sceneId: string, state: ScenePluginsState) {
  try {
    localStorage.setItem(localKey(sceneId), JSON.stringify(state));
  } catch {}
}

/**
 * Restores channel-plugin state from localStorage when sceneId changes,
 * and auto-saves changes to localStorage only (no cloud writes).
 */
export function usePluginsPersistence(sceneId: string | null, trackIds: string[]) {
  const engine = getAudioEngine();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredForRef = useRef<string | null>(null);

  const trackIdsKey = useMemo(() => trackIds.join(","), [trackIds]);
  const trackIdsRef = useRef(trackIds);
  trackIdsRef.current = trackIds;

  // Restore plugin state when scene changes
  useEffect(() => {
    if (!sceneId || trackIds.length === 0) return;
    if (restoredForRef.current === sceneId) return;
    restoredForRef.current = sceneId;

    const saved = loadLocal(sceneId);
    if (!saved) return;

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
  }, [sceneId, trackIdsKey, engine]);

  // Debounced save to localStorage only
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
    }, 300);
  }, [sceneId, engine]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { scheduleSave };
}
