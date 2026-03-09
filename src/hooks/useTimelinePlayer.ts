import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getAudioEngine, type EngineState, type TrackConfig } from "@/lib/audioEngine";
import type { TimelineClip } from "@/hooks/useTimelineClips";

export type PlayerState = EngineState;

/**
 * Manages playback of timeline audio clips via the Tone.js-based AudioEngine.
 * Main clips and overlay clips are all scheduled on the Transport — no setTimeout hacks.
 */
export function useTimelinePlayer(clips: TimelineClip[]) {
  const engine = getAudioEngine();

  const [state, setState] = useState<PlayerState>("stopped");
  const [positionSec, setPositionSec] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [volume, setVolumeState] = useState(() => {
    try {
      const v = Number(localStorage.getItem("timeline-volume"));
      return Number.isFinite(v) ? v : 80;
    } catch {
      return 80;
    }
  });

  // Track which clip set we've loaded to avoid redundant reloads
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

  // Build a stable key from clip ids + paths to detect changes
  const clipsKey = audioClips
    .map((c) => `${c.id}:${c.audioPath}:${c.startSec}:${c.durationSec}`)
    .join("|");

  // Load tracks into the engine when clips change
  useEffect(() => {
    if (clipsKey === loadedKeyRef.current) return;
    loadedKeyRef.current = clipsKey;

    if (audioClips.length === 0) {
      engine.loadTracks([]);
      return;
    }

    let cancelled = false;

    const loadAll = async () => {
      // Get signed URLs for all clips in parallel
      const configs: TrackConfig[] = [];

      const urlResults = await Promise.all(
        audioClips.map(async (clip) => {
          const { data, error } = await supabase.storage
            .from("user-media")
            .createSignedUrl(clip.audioPath!, 3600);
          if (error || !data?.signedUrl) return null;
          return { clip, url: data.signedUrl };
        })
      );

      if (cancelled) return;

      for (const result of urlResults) {
        if (!result) continue;
        const { clip, url } = result;
        const isOverlay = clip.id.includes("_narrator_");

        configs.push({
          id: clip.id,
          url,
          startSec: clip.startSec,
          durationSec: clip.durationSec,
          overlay: isOverlay,
          volume: volume,
          fadeInSec: clip.fadeInSec ?? 0,
          fadeOutSec: clip.fadeOutSec ?? 0,
        });
      }

      if (cancelled) return;

      try {
        await engine.loadTracks(configs);
      } catch (err) {
        console.error("[useTimelinePlayer] Failed to load tracks:", err);
      }
    };

    loadAll();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipsKey]);

  // Sync master volume
  useEffect(() => {
    engine.setMasterVolume(volume);
  }, [volume, engine]);

  // Compute total duration from all clips (including non-audio for timeline width)
  const computedTotalDuration =
    clips.length > 0
      ? Math.max(...clips.map((c) => c.startSec + c.durationSec))
      : 0;

  const play = useCallback(async () => {
    try {
      await engine.play();
    } catch (err) {
      console.error("[useTimelinePlayer] play failed:", err);
      toast.error("Не удалось воспроизвести аудио. Проверьте настройки браузера.");
    }
  }, [engine]);

  const pause = useCallback(() => {
    engine.pause();
  }, [engine]);

  const stop = useCallback(() => {
    engine.stop();
  }, [engine]);

  const seek = useCallback(
    (toSec: number) => {
      engine.seek(toSec);
    },
    [engine]
  );

  const changeVolume = useCallback(
    (v: number) => {
      const clamped = Math.max(0, Math.min(100, v));
      setVolumeState(clamped);
      engine.setMasterVolume(clamped);
    },
    [engine]
  );

  return {
    state,
    positionSec,
    totalDuration: Math.max(computedTotalDuration, totalDuration),
    hasAudio: audioClips.length > 0,
    volume,
    changeVolume,
    play,
    pause,
    stop,
    seek,
  };
}
