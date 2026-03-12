/**
 * React hook for loading audio and computing/caching stereo waveform peaks.
 * Fetches audio via stemCache, decodes, computes multi-LOD peaks, caches via Cache API.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchWithStemCache } from "@/lib/stemCache";
import {
  computeMultiLodPeaks,
  loadCachedPeaks,
  savePeaksToCache,
  type MultiLodPeaks,
} from "@/lib/waveformPeaks";
import type { TimelineClip } from "@/hooks/useTimelineClips";

export type WaveformStatus = "idle" | "loading" | "ready" | "error";

export interface WaveformPeaksState {
  status: WaveformStatus;
  peaks: MultiLodPeaks | null;
  error: string | null;
}

/**
 * Load and compute waveform peaks for a list of clips on a given track.
 * Merges all clips into a single continuous peaks representation.
 */
export function useWaveformPeaks(
  trackClips: TimelineClip[],
  trackId: string | null,
): WaveformPeaksState {
  const [state, setState] = useState<WaveformPeaksState>({
    status: "idle",
    peaks: null,
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  // Build a stable key from clip audio paths
  const clipsKey = trackClips
    .filter((c) => c.hasAudio && c.audioPath)
    .map((c) => c.audioPath!)
    .sort()
    .join("|");

  const loadPeaks = useCallback(async () => {
    if (!trackId || !clipsKey) {
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

      // For single clip: try cache first
      if (audioClips.length === 1) {
        const path = audioClips[0].audioPath!;
        const cached = await loadCachedPeaks(path);
        if (cached && !abort.signal.aborted) {
          setState({ status: "ready", peaks: cached, error: null });
          return;
        }
      }

      // We need to decode audio to compute peaks
      // Use first clip for now (montage has one clip per track per scene)
      const clip = audioClips[0];
      const path = clip.audioPath!;

      // Get signed URL
      const { data: signedData, error: signError } = await supabase.storage
        .from("user-media")
        .createSignedUrl(path, 600);

      if (signError || !signedData?.signedUrl) {
        throw new Error(signError?.message || "Failed to get signed URL");
      }

      if (abort.signal.aborted) return;

      // Fetch audio data (via stemCache for reuse)
      const arrayBuf = await fetchWithStemCache(path, signedData.signedUrl);
      if (abort.signal.aborted) return;

      // Decode audio
      const audioCtx = new AudioContext();
      try {
        const buffer = await audioCtx.decodeAudioData(arrayBuf.slice(0));
        if (abort.signal.aborted) return;

        // Compute multi-LOD peaks
        const peaks = computeMultiLodPeaks(buffer);

        // Cache for next time (fire-and-forget)
        savePeaksToCache(path, peaks);

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
  }, [trackId, clipsKey, trackClips]);

  useEffect(() => {
    loadPeaks();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadPeaks]);

  return state;
}
