/**
 * React hook for loading audio and computing/caching stereo waveform peaks
 * for a SCENE: decodes ALL clips, places their peaks at correct scene-local
 * positions, and merges into a single scene-wide MultiLodPeaks structure.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchWithStemCache } from "@/lib/stemCache";
import {
  type MultiLodPeaks,
  type StereoPeaks,
  type LodLevel,
  loadCachedPeaks,
  savePeaksToCache,
} from "@/lib/waveformPeaks";
import type { TimelineClip } from "@/hooks/useTimelineClips";

export type WaveformStatus = "idle" | "loading" | "ready" | "error";

export interface WaveformPeaksState {
  status: WaveformStatus;
  peaks: MultiLodPeaks | null;
  error: string | null;
}

const LOD_LEVELS: readonly LodLevel[] = [200, 800, 3200];

/**
 * Compute scene-wide multi-LOD peaks from decoded per-clip AudioBuffers.
 * Each clip is placed at its scene-local startSec within the total sceneDuration.
 */
function computeScenePeaks(
  clipBuffers: { clip: TimelineClip; buffer: AudioBuffer }[],
  sceneDuration: number,
): MultiLodPeaks {
  if (sceneDuration <= 0) {
    const empty = new Map<LodLevel, StereoPeaks>();
    for (const lod of LOD_LEVELS) {
      empty.set(lod, {
        left: new Float32Array(lod),
        right: new Float32Array(lod),
        sampleRate: 44100,
        duration: 0,
        lodLevel: lod,
      });
    }
    return { lods: empty, sampleRate: 44100, duration: 0 };
  }

  const sampleRate = clipBuffers[0]?.buffer.sampleRate ?? 44100;
  const lods = new Map<LodLevel, StereoPeaks>();

  for (const lodLevel of LOD_LEVELS) {
    const leftPeaks = new Float32Array(lodLevel);
    const rightPeaks = new Float32Array(lodLevel);
    const secPerBin = sceneDuration / lodLevel;

    for (const { clip, buffer } of clipBuffers) {
      const clipStart = clip.startSec;
      const clipDur = clip.durationSec;
      const clipEnd = clipStart + clipDur;
      const leftData = buffer.getChannelData(0);
      const rightData = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : leftData;
      const bufDur = buffer.duration;

      // Which LOD bins does this clip occupy?
      const binStart = Math.max(0, Math.floor(clipStart / secPerBin));
      const binEnd = Math.min(lodLevel, Math.ceil(clipEnd / secPerBin));

      for (let i = binStart; i < binEnd; i++) {
        // Time range of this bin within the scene
        const binTimeSec = i * secPerBin;
        const binTimeEndSec = (i + 1) * secPerBin;

        // Corresponding time range within the audio buffer
        const audioStartSec = Math.max(0, binTimeSec - clipStart);
        const audioEndSec = Math.min(bufDur, binTimeEndSec - clipStart);

        if (audioEndSec <= audioStartSec) continue;

        // Sample range
        const sStart = Math.floor(audioStartSec * sampleRate);
        const sEnd = Math.min(leftData.length, Math.ceil(audioEndSec * sampleRate));

        let maxL = 0;
        let maxR = 0;
        for (let j = sStart; j < sEnd; j++) {
          const vl = Math.abs(leftData[j]);
          const vr = Math.abs(rightData[j]);
          if (vl > maxL) maxL = vl;
          if (vr > maxR) maxR = vr;
        }

        // Take the max of existing and new (clips can overlap)
        if (maxL > leftPeaks[i]) leftPeaks[i] = maxL;
        if (maxR > rightPeaks[i]) rightPeaks[i] = maxR;
      }
    }

    lods.set(lodLevel, {
      left: leftPeaks,
      right: rightPeaks,
      sampleRate,
      duration: sceneDuration,
      lodLevel,
    });
  }

  return { lods, sampleRate, duration: sceneDuration };
}

/**
 * Load and compute waveform peaks for ALL clips of a track within a scene.
 * Peaks are positioned according to each clip's scene-local startSec.
 */
export function useWaveformPeaks(
  trackClips: TimelineClip[],
  trackId: string | null,
  sceneDuration: number = 0,
): WaveformPeaksState {
  const [state, setState] = useState<WaveformPeaksState>({
    status: "idle",
    peaks: null,
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  // Build a stable key from clip audio paths + positions + sceneDuration
  const clipsKey = trackClips
    .filter((c) => c.hasAudio && c.audioPath)
    .map((c) => `${c.audioPath!}@${c.startSec.toFixed(3)}`)
    .sort()
    .join("|") + `|dur=${sceneDuration.toFixed(2)}`;

  const loadPeaks = useCallback(async () => {
    if (!trackId || !clipsKey || sceneDuration <= 0) {
      setState({ status: "idle", peaks: null, error: null });
      return;
    }

    // Abort any previous load
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setState({ status: "loading", peaks: null, error: null });

    try {
      const audioClips = trackClips.filter((c) => c.hasAudio && c.audioPath);
      if (audioClips.length === 0) {
        setState({ status: "idle", peaks: null, error: null });
        return;
      }

      // Cache key = combination of all paths + scene duration
      const compositeCacheKey = `scene_${trackId}_${clipsKey}`;

      // Try cache
      const cached = await loadCachedPeaks(compositeCacheKey);
      if (cached && !abort.signal.aborted) {
        setState({ status: "ready", peaks: cached, error: null });
        return;
      }

      // Decode ALL clips' audio
      const audioCtx = new AudioContext();
      try {
        const clipBuffers: { clip: TimelineClip; buffer: AudioBuffer }[] = [];

        for (const clip of audioClips) {
          if (abort.signal.aborted) return;

          const path = clip.audioPath!;

          // Get signed URL
          const { data: signedData, error: signError } = await supabase.storage
            .from("user-media")
            .createSignedUrl(path, 600);

          if (signError || !signedData?.signedUrl) {
            console.warn(`[useWaveformPeaks] Skip clip ${clip.id}: ${signError?.message}`);
            continue;
          }

          if (abort.signal.aborted) return;

          // Fetch audio data
          const arrayBuf = await fetchWithStemCache(path, signedData.signedUrl);
          if (abort.signal.aborted) return;

          // Decode
          const buffer = await audioCtx.decodeAudioData(arrayBuf.slice(0));
          if (abort.signal.aborted) return;

          clipBuffers.push({ clip, buffer });
        }

        if (abort.signal.aborted) return;

        if (clipBuffers.length === 0) {
          setState({ status: "idle", peaks: null, error: null });
          return;
        }

        // Compute scene-wide merged peaks
        const peaks = computeScenePeaks(clipBuffers, sceneDuration);

        // Cache (fire-and-forget)
        savePeaksToCache(compositeCacheKey, peaks);

        if (!abort.signal.aborted) {
          setState({ status: "ready", peaks, error: null });
        }
      } finally {
        audioCtx.close();
      }
    } catch (e) {
      if (!abort.signal.aborted) {
        setState({
          status: "error",
          peaks: null,
          error: e instanceof Error ? e.message : "Unknown error",
        });
      }
    }
  }, [trackId, clipsKey, trackClips, sceneDuration]);

  useEffect(() => {
    loadPeaks();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadPeaks]);

  return state;
}
