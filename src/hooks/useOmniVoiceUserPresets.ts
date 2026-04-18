/**
 * useOmniVoiceUserPresets — OPFS-first user presets store with cloud mirror.
 *
 * Workflow:
 *   1. On mount: load from OPFS immediately; subscribe to cloud copy.
 *   2. On cloud arrival: merge by id (newer updatedAt wins); rewrite OPFS if changed.
 *   3. On any mutation: write OPFS first, then mirror full array to cloud.
 *
 * Cloud copy lives in `user_settings.omnivoice_advanced_presets`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import {
  loadPresetsFromOPFS,
  makePreset,
  mergePresets,
  savePresetsToOPFS,
  type OmniVoiceUserPreset,
} from "@/lib/omniVoiceUserPresets";
import type { OmniVoiceAdvancedParams } from "@/components/voicelab/omnivoice/constants";

const SETTING_KEY = "omnivoice_advanced_presets";

export function useOmniVoiceUserPresets() {
  const cloud = useCloudSettings<OmniVoiceUserPreset[]>(SETTING_KEY, []);
  const [presets, setPresets] = useState<OmniVoiceUserPreset[]>([]);
  const [hydrated, setHydrated] = useState(false);
  /** Skip the next cloud → local merge (we just pushed it ourselves). */
  const justPushedRef = useRef(false);

  // Hydrate from OPFS once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = await loadPresetsFromOPFS();
      if (cancelled) return;
      setPresets(local);
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Reconcile with cloud copy whenever it arrives/changes.
  useEffect(() => {
    if (!hydrated || !cloud.loaded) return;
    if (justPushedRef.current) {
      justPushedRef.current = false;
      return;
    }
    const merged = mergePresets(presets, cloud.value ?? []);
    if (JSON.stringify(merged) !== JSON.stringify(presets)) {
      setPresets(merged);
      void savePresetsToOPFS(merged).catch((e) =>
        console.warn("[useOmniVoiceUserPresets] OPFS write after merge failed:", e),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, cloud.loaded, cloud.value]);

  /** Persist a new array to BOTH OPFS and cloud. */
  const persist = useCallback(async (next: OmniVoiceUserPreset[]) => {
    setPresets(next);
    try {
      await savePresetsToOPFS(next);
    } catch (err) {
      console.warn("[useOmniVoiceUserPresets] OPFS write failed:", err);
    }
    justPushedRef.current = true;
    cloud.update(next);
  }, [cloud]);

  const savePreset = useCallback(
    async (name: string, params: OmniVoiceAdvancedParams, speed?: number) => {
      const preset = makePreset(name, params, speed);
      await persist([preset, ...presets]);
      return preset;
    },
    [persist, presets],
  );

  const renamePreset = useCallback(
    async (id: string, newName: string) => {
      const next = presets.map((p) =>
        p.id === id ? { ...p, name: newName.trim() || p.name, updatedAt: new Date().toISOString() } : p,
      );
      await persist(next);
    },
    [persist, presets],
  );

  const deletePreset = useCallback(
    async (id: string) => {
      await persist(presets.filter((p) => p.id !== id));
    },
    [persist, presets],
  );

  return {
    presets,
    hydrated,
    savePreset,
    renamePreset,
    deletePreset,
  };
}
