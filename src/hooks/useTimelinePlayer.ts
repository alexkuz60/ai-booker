import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { TimelineClip } from "@/hooks/useTimelineClips";

export type PlayerState = "stopped" | "playing" | "paused";

/**
 * Manages sequential playback of timeline audio clips.
 * Returns current playback position in seconds and transport controls.
 */
export function useTimelinePlayer(clips: TimelineClip[]) {
  const [state, setState] = useState<PlayerState>("stopped");
  const [positionSec, setPositionSec] = useState(0);
  const [volume, setVolume] = useState(() => {
    try { const v = Number(localStorage.getItem("timeline-volume")); return Number.isFinite(v) ? v : 80; } catch { return 80; }
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const clipIndexRef = useRef(0);
  const clipStartTimeRef = useRef(0);
  const clipOffsetRef = useRef(0);
  const stateRef = useRef<PlayerState>("stopped");
  const pausedAtRef = useRef(0);
  const volumeRef = useRef(volume);
  const audioClipsRef = useRef<TimelineClip[]>([]);

  // Sort clips with audio by start time
  const audioClips = clips
    .filter(c => c.hasAudio && c.audioPath)
    .sort((a, b) => a.startSec - b.startSec);

  // Keep ref in sync
  audioClipsRef.current = audioClips;

  const totalDuration = clips.length > 0
    ? Math.max(...clips.map(c => c.startSec + c.durationSec))
    : 0;
  const totalDurationRef = useRef(totalDuration);
  totalDurationRef.current = totalDuration;

  // Cleanup
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const getSignedUrl = useCallback(async (path: string): Promise<string | null> => {
    const { data, error } = await supabase.storage
      .from("user-media")
      .createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }, []);

  const updatePosition = useCallback(() => {
    if (stateRef.current !== "playing") return;
    const elapsed = (performance.now() - clipStartTimeRef.current) / 1000;
    const pos = clipOffsetRef.current + elapsed;
    setPositionSec(pos);

    if (pos >= totalDurationRef.current) {
      setState("stopped");
      stateRef.current = "stopped";
      setPositionSec(0);
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      return;
    }

    rafRef.current = requestAnimationFrame(updatePosition);
  }, []);

  const playClip = useCallback(async (index: number) => {
    if (index >= audioClips.length) {
      // No more audio clips — continue timeline until total duration
      clipOffsetRef.current = audioClips.length > 0
        ? audioClips[audioClips.length - 1].startSec + audioClips[audioClips.length - 1].durationSec
        : 0;
      clipStartTimeRef.current = performance.now();
      rafRef.current = requestAnimationFrame(updatePosition);
      return;
    }

    const clip = audioClips[index];
    clipIndexRef.current = index;

    // If there's a gap before this clip, wait through it
    const currentPos = clipOffsetRef.current;
    if (clip.startSec > currentPos + 0.05) {
      clipStartTimeRef.current = performance.now();
      const gapMs = (clip.startSec - currentPos) * 1000;
      rafRef.current = requestAnimationFrame(updatePosition);
      await new Promise(resolve => setTimeout(resolve, gapMs));
      if (stateRef.current !== "playing") return;
    }

    clipOffsetRef.current = clip.startSec;
    clipStartTimeRef.current = performance.now();

    const url = await getSignedUrl(clip.audioPath!);
    if (!url || stateRef.current !== "playing") return;

    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    audio.volume = volumeRef.current / 100;
    audio.src = url;
    audioRef.current = audio;

    audio.onended = () => {
      if (stateRef.current !== "playing") return;
      clipOffsetRef.current = clip.startSec + clip.durationSec;
      clipStartTimeRef.current = performance.now();
      playClip(index + 1);
    };

    audio.onerror = (e) => {
      console.error("[TimelinePlayer] Audio load error for clip", index, e);
      // Skip broken clips
      if (stateRef.current !== "playing") return;
      clipOffsetRef.current = clip.startSec + clip.durationSec;
      clipStartTimeRef.current = performance.now();
      playClip(index + 1);
    };

    try {
      await audio.play();
      rafRef.current = requestAnimationFrame(updatePosition);
    } catch (err) {
      console.error("[TimelinePlayer] play() failed:", err);
      toast.error("Не удалось воспроизвести аудио. Проверьте настройки браузера.");
      setState("stopped");
      stateRef.current = "stopped";
    }
  }, [audioClips, getSignedUrl, updatePosition]);

  const play = useCallback(() => {
    if (stateRef.current === "playing") return;

    if (stateRef.current === "paused") {
      // Resume
      stateRef.current = "playing";
      setState("playing");
      clipStartTimeRef.current = performance.now();
      clipOffsetRef.current = pausedAtRef.current;
      if (audioRef.current) {
        audioRef.current.play().catch((err) => {
          console.error("[TimelinePlayer] resume play() failed:", err);
          toast.error("Не удалось возобновить воспроизведение");
        });
      }
      rafRef.current = requestAnimationFrame(updatePosition);
      return;
    }

    // Start from beginning (or from current position if stopped mid-way)
    stateRef.current = "playing";
    setState("playing");
    clipOffsetRef.current = 0;
    clipStartTimeRef.current = performance.now();
    setPositionSec(0);

    // Find first audio clip
    playClip(0);
  }, [playClip, updatePosition]);

  const pause = useCallback(() => {
    if (stateRef.current !== "playing") return;
    stateRef.current = "paused";
    setState("paused");
    cancelAnimationFrame(rafRef.current);
    pausedAtRef.current = positionSec;
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, [positionSec]);

  const stop = useCallback(() => {
    stateRef.current = "stopped";
    setState("stopped");
    cancelAnimationFrame(rafRef.current);
    setPositionSec(0);
    pausedAtRef.current = 0;
    clipOffsetRef.current = 0;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  const seek = useCallback((toSec: number) => {
    const clamped = Math.max(0, Math.min(toSec, totalDuration));
    // Stop current audio
    cancelAnimationFrame(rafRef.current);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setPositionSec(clamped);
    pausedAtRef.current = clamped;
    clipOffsetRef.current = clamped;
    clipStartTimeRef.current = performance.now();

    if (stateRef.current === "playing") {
      // Find the audio clip that contains this position
      const idx = audioClips.findIndex(
        c => c.startSec <= clamped && clamped < c.startSec + c.durationSec
      );
      if (idx >= 0) {
        // Seek within this clip
        const clip = audioClips[idx];
        const offsetInClip = clamped - clip.startSec;
        clipIndexRef.current = idx;
        (async () => {
          const url = await getSignedUrl(clip.audioPath!);
          if (!url || stateRef.current !== "playing") return;
          const audio = new Audio();
          audio.crossOrigin = "anonymous";
          audio.preload = "auto";
          audio.volume = volumeRef.current / 100;
          audio.src = url;
          audioRef.current = audio;
          audio.currentTime = offsetInClip;
          audio.onended = () => {
            if (stateRef.current !== "playing") return;
            clipOffsetRef.current = clip.startSec + clip.durationSec;
            clipStartTimeRef.current = performance.now();
            playClip(idx + 1);
          };
          audio.onerror = () => {
            if (stateRef.current !== "playing") return;
            clipOffsetRef.current = clip.startSec + clip.durationSec;
            clipStartTimeRef.current = performance.now();
            playClip(idx + 1);
          };
          try {
            await audio.play();
            rafRef.current = requestAnimationFrame(updatePosition);
          } catch (err) {
            console.error("[TimelinePlayer] seek play() failed:", err);
            toast.error("Не удалось воспроизвести аудио");
          }
        })();
      } else {
        // Position is in a gap — find next clip
        const nextIdx = audioClips.findIndex(c => c.startSec > clamped);
        playClip(nextIdx >= 0 ? nextIdx : audioClips.length);
      }
    } else {
      // If paused or stopped, just update position
      if (stateRef.current === "stopped") {
        stateRef.current = "paused";
        setState("paused");
      }
    }
  }, [totalDuration, audioClips, getSignedUrl, playClip, updatePosition]);

  const changeVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(100, v));
    setVolume(clamped);
    volumeRef.current = clamped;
    localStorage.setItem("timeline-volume", String(clamped));
    if (audioRef.current) audioRef.current.volume = clamped / 100;
  }, []);

  // Sync volume to current audio element
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
    volumeRef.current = volume;
  }, [volume]);

  return {
    state,
    positionSec,
    totalDuration,
    hasAudio: audioClips.length > 0,
    volume,
    changeVolume,
    play,
    pause,
    stop,
    seek,
  };
}
