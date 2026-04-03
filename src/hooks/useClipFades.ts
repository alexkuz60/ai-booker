/**
 * useClipFades — manages per-clip fade-in/out persistence (localStorage + OPFS).
 * Extracted from StudioTimeline.tsx for modularity.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { getAudioEngine } from "@/lib/audioEngine";
import type { ProjectStorage } from "@/lib/projectStorage";

type FadeMap = Record<string, { fadeInSec: number; fadeOutSec: number }>;

export function useClipFades(sceneId: string | null | undefined, storage: ProjectStorage | null) {
  const fadeLsKey = sceneId ? `clip_fades_${sceneId}` : "";

  const [savedFades, setSavedFades] = useState<FadeMap>(() => {
    if (!fadeLsKey) return {};
    try {
      const raw = localStorage.getItem(fadeLsKey);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });

  const savedFadesRef = useRef(savedFades);
  savedFadesRef.current = savedFades;

  // Reload fades from localStorage when scene changes
  const prevFadeLsKey = useRef(fadeLsKey);
  useEffect(() => {
    if (fadeLsKey === prevFadeLsKey.current) return;
    prevFadeLsKey.current = fadeLsKey;
    if (!fadeLsKey) { setSavedFades({}); return; }
    try {
      const raw = localStorage.getItem(fadeLsKey);
      setSavedFades(raw ? JSON.parse(raw) : {});
    } catch { setSavedFades({}); }
  }, [fadeLsKey]);

  // Convert to Map for components
  const clipFades = useMemo(() => {
    const m = new Map<string, { fadeInSec: number; fadeOutSec: number }>();
    for (const [k, v] of Object.entries(savedFades)) {
      m.set(k, v);
    }
    return m;
  }, [savedFades]);

  // Restore fades to engine when scene loads
  const fadesRestoredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sceneId || !fadeLsKey) return;
    if (fadesRestoredRef.current === fadeLsKey) return;
    fadesRestoredRef.current = fadeLsKey;
    const engine = getAudioEngine();
    for (const [clipId, f] of Object.entries(savedFadesRef.current)) {
      engine.setTrackFadeIn(clipId, f.fadeInSec);
      engine.setTrackFadeOut(clipId, f.fadeOutSec);
    }
  }, [fadeLsKey, sceneId]);

  const handleSetFade = useCallback((clipId: string, fadeInSec: number, fadeOutSec: number) => {
    const engine = getAudioEngine();
    engine.setTrackFadeIn(clipId, fadeInSec);
    engine.setTrackFadeOut(clipId, fadeOutSec);

    setSavedFades(prev => {
      const next = { ...prev, [clipId]: { fadeInSec, fadeOutSec } };
      if (fadeLsKey) {
        try { localStorage.setItem(fadeLsKey, JSON.stringify(next)); } catch {}
      }
      return next;
    });

    // For atmo/sfx clips — also persist to OPFS atmospheres.json
    if (clipId.startsWith("atmo-") && storage && sceneId) {
      const atmoId = clipId.replace(/^atmo-/, "");
      import("@/lib/localAtmospheres").then(({ updateAtmosphereClip }) => {
        updateAtmosphereClip(storage, sceneId, atmoId, {
          fade_in_ms: Math.round(fadeInSec * 1000),
          fade_out_ms: Math.round(fadeOutSec * 1000),
        });
      });
    }
  }, [fadeLsKey, storage, sceneId]);

  return { clipFades, handleSetFade };
}
