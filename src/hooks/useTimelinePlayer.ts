import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getAudioEngine, type EngineState, type TrackConfig, type LoadProgress } from "@/lib/audioEngine";
import type { TimelineClip } from "@/hooks/useTimelineClips";
import { loadLocal as loadMixerState } from "@/hooks/useMixerPersistence";

export type PlayerState = EngineState;

/**
 * Manages playback of timeline audio clips via the Tone.js-based AudioEngine.
 */
export function useTimelinePlayer(clips: TimelineClip[]) {

  const engine = getAudioEngine();

  const [state, setState] = useState<PlayerState>("stopped");
  const [positionSec, setPositionSec] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  const [failedConfigs, setFailedConfigs] = useState<TrackConfig[]>([]);
  const [volume, setVolumeState] = useState(() => {
    try {
      const v = Number(localStorage.getItem("timeline-volume"));
      return Number.isFinite(v) ? v : 80;
    } catch {
      return 80;
    }
  });

  const loadedKeyRef = useRef<string>("");

  const audioClips = clips.filter((c) => c.hasAudio && c.audioPath);

  // Subscribe to engine state
  useEffect(() => {
    const unsub = engine.subscribe((snap) => {
      setState(snap.state);
      setPositionSec(snap.positionSec);
      setTotalDuration(snap.totalDuration);
    });
    return unsub;
  }, [engine]);

  const clipsKey = audioClips
    .map((c) => `${c.id}:${c.audioPath}:${c.startSec}:${c.durationSec}:${c.loop ? "L" : ""}`)
    .join("|");

  useEffect(() => {
    if (clipsKey === loadedKeyRef.current) return;
    loadedKeyRef.current = clipsKey;

    if (audioClips.length === 0) {
      engine.loadTracks([]);
      setFailedConfigs([]);
      return;
    }

    let cancelled = false;

    const loadAll = async () => {
      const configs: TrackConfig[] = [];

      // Load saved mixer state for per-track volume/pan restoration
      const sceneId = audioClips[0]?.sceneId;
      const savedMix = sceneId ? loadMixerState(sceneId) : null;

      const urlResults = await Promise.all(
        audioClips.map(async (clip) => {
          const { data, error } = await supabase.storage
            .from("user-media")
            .createSignedUrl(clip.audioPath!, 3600);
          if (error || !data?.signedUrl) return null;
          const rawUrl = data.signedUrl;
          const absoluteUrl = rawUrl.startsWith("http")
            ? rawUrl
            : `${import.meta.env.VITE_SUPABASE_URL}/storage/v1${rawUrl}`;
          return { clip, url: absoluteUrl };
        })
      );

      if (cancelled) return;

      for (const result of urlResults) {
        if (!result) continue;
        const { clip, url } = result;
        const isOverlay = clip.id.includes("_narrator_");
        const isAtmo = clip.segmentType?.startsWith("atmosphere_");

        // Use saved per-track volume/pan if available, otherwise master volume
        const trackMix = savedMix?.[clip.id];
        const trackVolume = trackMix?.volume ?? volume;
        const trackPan = trackMix?.pan ?? undefined;

        configs.push({
          id: clip.id,
          url,
          startSec: clip.startSec,
          durationSec: clip.durationSec,
          overlay: isOverlay,
          volume: trackVolume,
          pan: trackPan,
          bus: isAtmo ? (clip.segmentType === "atmosphere_sfx" ? "sfx" : "atmosphere") : "voice",
          fadeInSec: clip.fadeInSec ?? 0,
          fadeOutSec: clip.fadeOutSec ?? 0,
          loop: clip.loop,
          clipLenSec: clip.clipLenSec,
          loopCrossfadeSec: clip.loopCrossfadeSec,
          label: clip.label,
          cacheKey: clip.audioPath,
          segmentType: clip.segmentType,
        });
      }

      if (cancelled) return;

      try {
        setLoadProgress({ total: configs.length, done: 0, loaded: 0, failed: 0, currentId: "", currentLabel: "" });
        setFailedConfigs([]);
        const res = await engine.loadTracks(configs, (p) => {
          if (!cancelled) setLoadProgress(p);
        });
        if (!cancelled) {
          if (res.dropped > 0) {
            const loadedIds = new Set(Array.from((engine as any).tracks?.keys?.() ?? []));
            const failed = configs.filter(c => !loadedIds.has(c.id));
            setFailedConfigs(failed);
            setLoadProgress({ total: res.total, done: res.total, loaded: res.loaded, failed: res.dropped, currentId: "", currentLabel: "" });
          } else {
            setLoadProgress(null);
            setFailedConfigs([]);
          }
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error("[useTimelinePlayer] Failed to load tracks:", err);
        // All tracks failed — populate failedConfigs so user can retry
        setFailedConfigs(configs);
        setLoadProgress({ total: configs.length, done: configs.length, loaded: 0, failed: configs.length, currentId: "", currentLabel: "" });
        const msg = err?.message ?? "";
        if (msg.includes("ctx=suspended") || msg.includes("ctx=closed")) {
          toast.error("AudioContext не активен. Перезагрузите страницу и нажмите Play.");
        } else {
          toast.error("Не удалось загрузить аудиодорожки. Перезагрузите страницу.");
        }
      }
    };

    loadAll();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipsKey]);

  // Retry only failed stems
  const retryFailed = useCallback(async () => {
    if (failedConfigs.length === 0) return;
    const toRetry = [...failedConfigs];
    setFailedConfigs([]);
    setLoadProgress({ total: toRetry.length, done: 0, loaded: 0, failed: 0, currentId: "", currentLabel: "" });

    try {
      const currentEngine = getAudioEngine();
      const res = await currentEngine.loadAdditionalTracks(toRetry, (p) => {
        setLoadProgress(p);
      });
      if (res.dropped > 0) {
        const loadedIds = new Set(Array.from((currentEngine as any).tracks?.keys?.() ?? []));
        const stillFailed = toRetry.filter(c => !loadedIds.has(c.id));
        setFailedConfigs(stillFailed);
        setLoadProgress({ total: res.total, done: res.total, loaded: res.loaded, failed: res.dropped, currentId: "", currentLabel: "" });
        toast.warning(`Повтор: ${res.loaded}/${res.total} загружено, ${res.dropped} снова не удалось.`);
      } else {
        setLoadProgress(null);
        toast.success(`Все ${res.loaded} стемов успешно загружены!`);
      }
    } catch (err) {
      console.error("[useTimelinePlayer] retryFailed error:", err);
      setFailedConfigs(toRetry);
      setLoadProgress(null);
      toast.error("Повторная загрузка не удалась.");
    }
  }, [failedConfigs]);

  // Sync master volume
  useEffect(() => {
    engine.setMasterVolume(volume);
  }, [volume, engine]);

  const computedTotalDuration =
    clips.length > 0
      ? Math.max(...clips.map((c) => c.startSec + c.durationSec))
      : 0;

  // Keep engine end boundary in sync with full timeline duration
  // (including silent/unrendered clips) to avoid premature auto-stop.
  useEffect(() => {
    engine.setTimelineDuration(computedTotalDuration);
  }, [engine, computedTotalDuration]);

  const play = useCallback(async () => {
    try {
      const currentEngine = getAudioEngine();
      if (volume === 0) {
        toast.warning("Громкость мастера = 0. Увеличьте ползунок справа от Play.");
      }
      await currentEngine.play();
    } catch (err) {
      console.error("[useTimelinePlayer] play failed:", err);
      toast.error("Не удалось воспроизвести аудио. Проверьте настройки браузера.");
    }
  }, [volume]);

  const pause = useCallback(() => { getAudioEngine().pause(); }, []);
  const stop = useCallback(() => { getAudioEngine().stop(); }, []);
  const seek = useCallback((toSec: number) => { getAudioEngine().seek(toSec); }, []);

  const changeVolume = useCallback(
    (v: number) => {
      const clamped = Math.max(0, Math.min(100, v));
      setVolumeState(clamped);
      getAudioEngine().setMasterVolume(clamped);
    },
    []
  );

  // ── Loop region ──────────────────────────────────────────
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopRegion, setLoopRegionState] = useState<{ startSec: number; endSec: number } | null>(null);

  const setLoopRegion = useCallback((startSec: number, endSec: number) => {
    setLoopRegionState({ startSec, endSec });
    if (loopEnabled) {
      getAudioEngine().setLoopRegion(startSec, endSec);
    }
  }, [loopEnabled]);

  const toggleLoop = useCallback(() => {
    setLoopEnabled(prev => {
      const next = !prev;
      const eng = getAudioEngine();
      if (next && loopRegion) {
        eng.setLoopRegion(loopRegion.startSec, loopRegion.endSec);
      } else {
        eng.clearLoopRegion();
      }
      return next;
    });
  }, [loopRegion]);

  const clearLoopRegion = useCallback(() => {
    setLoopRegionState(null);
    getAudioEngine().clearLoopRegion();
  }, []);

  // Sync engine loop state when region changes
  useEffect(() => {
    const eng = getAudioEngine();
    if (loopEnabled && loopRegion) {
      eng.setLoopRegion(loopRegion.startSec, loopRegion.endSec);
    } else {
      eng.clearLoopRegion();
    }
  }, [loopEnabled, loopRegion]);

  return {
    state,
    positionSec,
    totalDuration: Math.max(computedTotalDuration, totalDuration),
    hasAudio: audioClips.length > 0,
    volume,
    loadProgress,
    failedCount: failedConfigs.length,
    changeVolume,
    play,
    pause,
    stop,
    seek,
    retryFailed,
    loopEnabled,
    loopRegion,
    toggleLoop,
    setLoopRegion,
    clearLoopRegion,
  };
}