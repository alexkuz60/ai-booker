import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getAudioEngine } from "@/lib/audioEngine";

// ─── Types ──────────────────────────────────────────────────

export interface ClipEqConfig {
  enabled: boolean;
  low: number;
  mid: number;
  high: number;
}

export interface ClipCompConfig {
  enabled: boolean;
  threshold: number;
  ratio: number;
  knee: number;
  attack: number;
  release: number;
}

export interface ClipLimiterConfig {
  enabled: boolean;
  threshold: number;
}

export interface ClipPanner3dConfig {
  enabled: boolean;
  positionX: number;   // -10..10
  positionY: number;   // -10..10 (height)
  positionZ: number;   // -10..10
  distanceModel: "linear" | "inverse" | "exponential";
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
  coneInnerAngle: number;
  coneOuterAngle: number;
  coneOuterGain: number;
}

export interface ClipConvolverConfig {
  enabled: boolean;
  impulseId: string | null;   // FK → convolution_impulses
  dryWet: number;             // 0..1
  preDelaySec: number;        // 0..0.5
  wetFilterEnabled: boolean;
  wetFilterType: "lowpass" | "highpass";
  wetFilterFreq: number;      // Hz
}

export interface ClipPluginConfig {
  eq: ClipEqConfig;
  comp: ClipCompConfig;
  limiter: ClipLimiterConfig;
  panner3d: ClipPanner3dConfig;
  convolver: ClipConvolverConfig;
}

export const DEFAULT_PANNER3D_CONFIG: ClipPanner3dConfig = {
  enabled: false,
  positionX: 0, positionY: 0, positionZ: 0,
  distanceModel: "inverse",
  refDistance: 1,
  maxDistance: 10000,
  rolloffFactor: 1,
  coneInnerAngle: 360,
  coneOuterAngle: 360,
  coneOuterGain: 0,
};

export const DEFAULT_CONVOLVER_CONFIG: ClipConvolverConfig = {
  enabled: false,
  impulseId: null,
  dryWet: 0.3,
  preDelaySec: 0,
  wetFilterEnabled: false,
  wetFilterType: "lowpass",
  wetFilterFreq: 8000,
};

export const DEFAULT_CLIP_PLUGIN_CONFIG: ClipPluginConfig = {
  eq: { enabled: false, low: 0, mid: 0, high: 0 },
  comp: { enabled: false, threshold: -24, ratio: 3, knee: 10, attack: 0.01, release: 0.1 },
  limiter: { enabled: false, threshold: -3 },
  panner3d: { ...DEFAULT_PANNER3D_CONFIG },
  convolver: { ...DEFAULT_CONVOLVER_CONFIG },
};

/** All clip configs for a scene, keyed by clipId */
export type SceneClipConfigs = Record<string, ClipPluginConfig>;

// ─── Hook ───────────────────────────────────────────────────

/**
 * Loads/saves per-clip plugin configs for a scene from the DB.
 * Applies configs to the audio engine on load.
 * Returns current configs + update/toggle functions.
 */
export function useClipPluginConfigs(sceneId: string | null) {
  const { user } = useAuth();
  const [configs, setConfigs] = useState<SceneClipConfigs>({});
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredRef = useRef<string | null>(null);

  // Load configs from DB when scene changes
  useEffect(() => {
    if (!sceneId || !user) { setLoaded(true); return; }
    if (restoredRef.current === sceneId) return;
    restoredRef.current = sceneId;

    (async () => {
      const { data } = await supabase
        .from("clip_plugin_configs")
        .select("clip_id, config")
        .eq("scene_id", sceneId)
        .eq("user_id", user.id);

      const result: SceneClipConfigs = {};
      if (data) {
        for (const row of data) {
          result[row.clip_id] = {
            ...DEFAULT_CLIP_PLUGIN_CONFIG,
            ...(row.config as unknown as Partial<ClipPluginConfig>),
          };
        }
      }
      setConfigs(result);
      setLoaded(true);
    })();
  }, [sceneId, user]);

  // Apply configs to engine when loaded
  useEffect(() => {
    if (!loaded) return;
    const engine = getAudioEngine();
    for (const [clipId, cfg] of Object.entries(configs)) {
      applyConfigToEngine(engine, clipId, cfg);
    }
  }, [loaded, configs]);

  // Debounced save to DB
  const saveToDb = useCallback((clipId: string, trackId: string, config: ClipPluginConfig) => {
    if (!sceneId || !user) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      await supabase.from("clip_plugin_configs").upsert(
        {
          scene_id: sceneId,
          clip_id: clipId,
          track_id: trackId,
          user_id: user.id,
          config: config as unknown as import("@/integrations/supabase/types").Json,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "scene_id,clip_id,user_id" },
      );
    }, 400);
  }, [sceneId, user]);

  /** Get config for a clip (returns default if none set) */
  const getClipConfig = useCallback((clipId: string): ClipPluginConfig => {
    return configs[clipId] ?? { ...DEFAULT_CLIP_PLUGIN_CONFIG };
  }, [configs]);

  /** Toggle a specific plugin on a clip */
  const togglePlugin = useCallback((
    clipId: string,
    trackId: string,
    plugin: "eq" | "comp" | "limiter" | "panner3d" | "convolver",
  ) => {
    const engine = getAudioEngine();
    setConfigs(prev => {
      const current = prev[clipId] ?? { ...DEFAULT_CLIP_PLUGIN_CONFIG };
      const updated: ClipPluginConfig = {
        ...current,
        [plugin]: { ...current[plugin], enabled: !current[plugin].enabled },
      };
      applyConfigToEngine(engine, clipId, updated);
      saveToDb(clipId, trackId, updated);
      return { ...prev, [clipId]: updated };
    });
  }, [saveToDb]);

  /** Update a full plugin config for a clip */
  const updateClipConfig = useCallback((
    clipId: string,
    trackId: string,
    config: ClipPluginConfig,
  ) => {
    const engine = getAudioEngine();
    applyConfigToEngine(engine, clipId, config);
    setConfigs(prev => ({ ...prev, [clipId]: config }));
    saveToDb(clipId, trackId, config);
  }, [saveToDb]);

  /** Update a single plugin section for a clip */
  const updatePluginParams = useCallback((
    clipId: string,
    trackId: string,
    plugin: "eq" | "comp" | "limiter" | "panner3d" | "convolver",
    params: Partial<ClipEqConfig> | Partial<ClipCompConfig> | Partial<ClipLimiterConfig> | Partial<ClipPanner3dConfig> | Partial<ClipConvolverConfig>,
  ) => {
    const engine = getAudioEngine();
    setConfigs(prev => {
      const current = prev[clipId] ?? { ...DEFAULT_CLIP_PLUGIN_CONFIG };
      const updated: ClipPluginConfig = {
        ...current,
        [plugin]: { ...current[plugin], ...params },
      };
      applyConfigToEngine(engine, clipId, updated);
      saveToDb(clipId, trackId, updated);
      return { ...prev, [clipId]: updated };
    });
  }, [saveToDb]);

  /** Get all configs (for snapshot into scene_playlists) */
  const getAllConfigs = useCallback((): SceneClipConfigs => configs, [configs]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return {
    configs,
    loaded,
    getClipConfig,
    togglePlugin,
    updateClipConfig,
    updatePluginParams,
    getAllConfigs,
  };
}

// ─── Engine helpers ─────────────────────────────────────────

function applyConfigToEngine(engine: ReturnType<typeof getAudioEngine>, clipId: string, cfg: ClipPluginConfig) {
  // EQ
  engine.setTrackEqBypassed(clipId, !cfg.eq.enabled);
  if (cfg.eq.enabled) {
    engine.setTrackEqLow(clipId, cfg.eq.low);
    engine.setTrackEqMid(clipId, cfg.eq.mid);
    engine.setTrackEqHigh(clipId, cfg.eq.high);
  }

  // Compressor
  engine.setTrackPreFxBypassed(clipId, !cfg.comp.enabled);
  if (cfg.comp.enabled) {
    engine.setTrackCompThreshold(clipId, cfg.comp.threshold);
    engine.setTrackCompRatio(clipId, cfg.comp.ratio);
    engine.setTrackCompKnee(clipId, cfg.comp.knee);
    engine.setTrackCompAttack(clipId, cfg.comp.attack);
    engine.setTrackCompRelease(clipId, cfg.comp.release);
  }

  // Limiter
  engine.setTrackLimiterBypassed(clipId, !cfg.limiter.enabled);
  if (cfg.limiter.enabled) {
    engine.setTrackLimiterThreshold(clipId, cfg.limiter.threshold);
  }

  // Panner3D
  engine.setTrackPanner3dBypassed(clipId, !cfg.panner3d.enabled);
  if (cfg.panner3d.enabled) {
    engine.setTrackPanner3dPosition(clipId, cfg.panner3d.positionX, cfg.panner3d.positionY, cfg.panner3d.positionZ);
    engine.setTrackPanner3dParams(clipId, {
      distanceModel: cfg.panner3d.distanceModel,
      refDistance: cfg.panner3d.refDistance,
      maxDistance: cfg.panner3d.maxDistance,
      rolloffFactor: cfg.panner3d.rolloffFactor,
      coneInnerAngle: cfg.panner3d.coneInnerAngle,
      coneOuterAngle: cfg.panner3d.coneOuterAngle,
      coneOuterGain: cfg.panner3d.coneOuterGain,
    });
  }

  // Convolver
  engine.setTrackConvolverBypassed(clipId, !cfg.convolver.enabled);
  if (cfg.convolver.enabled) {
    engine.setTrackConvolverDryWet(clipId, cfg.convolver.dryWet);
  }
}
