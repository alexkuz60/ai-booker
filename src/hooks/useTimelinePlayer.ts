import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { TimelineClip } from "@/hooks/useTimelineClips";

export type PlayerState = "stopped" | "playing" | "paused";

/**
 * Manages sequential playback of timeline audio clips.
 * Main (sequential) clips play one after another.
 * Overlay clips (inline narrations) fire concurrently at their scheduled time.
 */
export function useTimelinePlayer(clips: TimelineClip[]) {
  const [state, setState] = useState<PlayerState>("stopped");
  const [positionSec, setPositionSec] = useState(0);
  const [volume, setVolume] = useState(() => {
    try { const v = Number(localStorage.getItem("timeline-volume")); return Number.isFinite(v) ? v : 80; } catch { return 80; }
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const overlayAudiosRef = useRef<HTMLAudioElement[]>([]);
  const overlayTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const rafRef = useRef<number>(0);
  const clipIndexRef = useRef(0);
  const clipStartTimeRef = useRef(0);
  const clipOffsetRef = useRef(0);
  const stateRef = useRef<PlayerState>("stopped");
  const pausedAtRef = useRef(0);
  const volumeRef = useRef(volume);
  const mainClipsRef = useRef<TimelineClip[]>([]);
  const overlayClipsRef = useRef<TimelineClip[]>([]);

  // Separate main sequential clips from inline narration overlays
  const isOverlayClip = (c: TimelineClip) => c.id.includes("_narrator_");

  const mainClips = clips
    .filter(c => c.hasAudio && c.audioPath && !isOverlayClip(c))
    .sort((a, b) => a.startSec - b.startSec);

  const overlayClips = clips
    .filter(c => c.hasAudio && c.audioPath && isOverlayClip(c))
    .sort((a, b) => a.startSec - b.startSec);

  mainClipsRef.current = mainClips;
  overlayClipsRef.current = overlayClips;

  const totalDuration = clips.length > 0
    ? Math.max(...clips.map(c => c.startSec + c.durationSec))
    : 0;
  const totalDurationRef = useRef(totalDuration);
  totalDurationRef.current = totalDuration;

  const stopOverlays = useCallback(() => {
    for (const a of overlayAudiosRef.current) {
      try { a.pause(); } catch {}
    }
    overlayAudiosRef.current = [];
    for (const t of overlayTimersRef.current) clearTimeout(t);
    overlayTimersRef.current = [];
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      stopOverlays();
    };
  }, [stopOverlays]);

  const getSignedUrl = useCallback(async (path: string): Promise<string | null> => {
    const { data, error } = await supabase.storage
      .from("user-media")
      .createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }, []);

  /** Schedule overlay clips that fall within [fromSec, toSec) relative to current playback start */
  const scheduleOverlays = useCallback((fromSec: number) => {
    const oc = overlayClipsRef.current;
    for (const overlay of oc) {
      if (overlay.startSec < fromSec - 0.1) continue; // already passed
      const delayMs = (overlay.startSec - fromSec) * 1000;
      const timer = setTimeout(async () => {
        if (stateRef.current !== "playing") return;
        const url = await getSignedUrl(overlay.audioPath!);
        if (!url || stateRef.current !== "playing") return;
        const audio = new Audio();
        audio.crossOrigin = "anonymous";
        audio.volume = volumeRef.current / 100;
        audio.src = url;
        overlayAudiosRef.current.push(audio);
        try { await audio.play(); } catch (e) {
          console.warn("[TimelinePlayer] overlay play failed:", e);
        }
      }, Math.max(0, delayMs));
      overlayTimersRef.current.push(timer);
    }
  }, [getSignedUrl]);

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
      stopOverlays();
      return;
    }

    rafRef.current = requestAnimationFrame(updatePosition);
  }, [stopOverlays]);

  const playClip = useCallback(async (index: number) => {
    const ac = mainClipsRef.current;
    if (index >= ac.length) {
      // All main clips done — let position continue until totalDuration
      clipOffsetRef.current = ac.length > 0
        ? ac[ac.length - 1].startSec + ac[ac.length - 1].durationSec
        : 0;
      clipStartTimeRef.current = performance.now();
      rafRef.current = requestAnimationFrame(updatePosition);
      return;
    }

    const clip = ac[index];
    clipIndexRef.current = index;

    const currentPos = clipOffsetRef.current;

    // Wait for gap between clips (silence)
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
  }, [getSignedUrl, updatePosition]);

  const play = useCallback(() => {
    if (stateRef.current === "playing") return;

    if (stateRef.current === "paused") {
      stateRef.current = "playing";
      setState("playing");
      clipStartTimeRef.current = performance.now();
      clipOffsetRef.current = pausedAtRef.current;

      // Re-schedule overlays from paused position
      scheduleOverlays(pausedAtRef.current);

      if (audioRef.current) {
        audioRef.current.play().catch((err) => {
          console.error("[TimelinePlayer] resume play() failed:", err);
          toast.error("Не удалось возобновить воспроизведение");
        });
        // Resume overlay audios
        for (const a of overlayAudiosRef.current) {
          try { a.play(); } catch {}
        }
        rafRef.current = requestAnimationFrame(updatePosition);
        return;
      }

      // No active audio element — start from current paused position
      const ac = mainClipsRef.current;
      const idx = ac.findIndex(
        c => c.startSec <= pausedAtRef.current && pausedAtRef.current < c.startSec + c.durationSec
      );
      if (idx >= 0) {
        const clip = ac[idx];
        const offsetInClip = pausedAtRef.current - clip.startSec;
        (async () => {
          const url = await getSignedUrl(clip.audioPath!);
          if (!url || stateRef.current !== "playing") return;
          const audio = new Audio();
          audio.crossOrigin = "anonymous";
          audio.preload = "auto";
          audio.volume = volumeRef.current / 100;
          audio.src = url;
          audioRef.current = audio;
          audio.currentTime = Math.max(0, offsetInClip);
          audio.onended = () => {
            if (stateRef.current !== "playing") return;
            clipOffsetRef.current = clip.startSec + clip.durationSec;
            clipStartTimeRef.current = performance.now();
            playClip(idx + 1);
          };
          audio.onerror = () => {
            if (stateRef.current !== "playing") return;
            playClip(idx + 1);
          };
          try {
            await audio.play();
            rafRef.current = requestAnimationFrame(updatePosition);
          } catch (err) {
            console.error("[TimelinePlayer] resume seek play() failed:", err);
            toast.error("Не удалось возобновить воспроизведение");
          }
        })();
      } else {
        const nextIdx = ac.findIndex(c => c.startSec > pausedAtRef.current);
        playClip(nextIdx >= 0 ? nextIdx : ac.length);
      }
      return;
    }

    // Start from first main clip
    const firstAudioStart = mainClipsRef.current[0]?.startSec ?? 0;
    stateRef.current = "playing";
    setState("playing");
    pausedAtRef.current = firstAudioStart;
    clipOffsetRef.current = firstAudioStart;
    clipStartTimeRef.current = performance.now();
    setPositionSec(firstAudioStart);

    // Schedule all overlay clips
    scheduleOverlays(firstAudioStart);

    playClip(0);
  }, [playClip, scheduleOverlays]);

  const pause = useCallback(() => {
    if (stateRef.current !== "playing") return;
    stateRef.current = "paused";
    setState("paused");
    cancelAnimationFrame(rafRef.current);
    pausedAtRef.current = positionSec;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    // Pause overlays
    for (const a of overlayAudiosRef.current) {
      try { a.pause(); } catch {}
    }
    // Cancel pending overlay timers
    for (const t of overlayTimersRef.current) clearTimeout(t);
    overlayTimersRef.current = [];
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
    stopOverlays();
  }, [stopOverlays]);

  const seek = useCallback((toSec: number) => {
    const clamped = Math.max(0, Math.min(toSec, totalDurationRef.current));
    cancelAnimationFrame(rafRef.current);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    stopOverlays();

    setPositionSec(clamped);
    pausedAtRef.current = clamped;
    clipOffsetRef.current = clamped;
    clipStartTimeRef.current = performance.now();

    if (stateRef.current === "playing") {
      // Re-schedule overlays from new position
      scheduleOverlays(clamped);

      const ac = mainClipsRef.current;
      const idx = ac.findIndex(
        c => c.startSec <= clamped && clamped < c.startSec + c.durationSec
      );
      if (idx >= 0) {
        const clip = ac[idx];
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
        const nextIdx = ac.findIndex(c => c.startSec > clamped);
        playClip(nextIdx >= 0 ? nextIdx : ac.length);
      }
    } else {
      if (stateRef.current === "stopped") {
        stateRef.current = "paused";
        setState("paused");
      }
    }
  }, [getSignedUrl, playClip, updatePosition, stopOverlays, scheduleOverlays]);

  const changeVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(100, v));
    setVolume(clamped);
    volumeRef.current = clamped;
    localStorage.setItem("timeline-volume", String(clamped));
    if (audioRef.current) audioRef.current.volume = clamped / 100;
    for (const a of overlayAudiosRef.current) {
      a.volume = clamped / 100;
    }
  }, []);

  // Sync volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
    volumeRef.current = volume;
  }, [volume]);

  return {
    state,
    positionSec,
    totalDuration,
    hasAudio: mainClips.length > 0,
    volume,
    changeVolume,
    play,
    pause,
    stop,
    seek,
  };
}
