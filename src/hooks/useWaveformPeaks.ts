/**
 * React hook for loading audio and computing/caching stereo waveform peaks
 * for a SCENE: decodes ALL clips, sends raw channel data to a Web Worker
 * for off-thread peak computation, then caches the result.
 *
 * LOD levels are computed dynamically:
 *   maxPeaks = sceneDuration * 44100 * maxZoom / displayWidth
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { getAudioBuffer } from "@/lib/localAudioProvider";
import {
  type MultiLodPeaks,
  type StereoPeaks,
  type LodLevel,
  computeLodLevels,
  loadCachedPeaks,
  savePeaksToCache,
} from "@/lib/waveformPeaks";
import type { ClipChannelData, PeaksWorkerOutput } from "@/lib/peaksWorker";
import type { TimelineClip } from "@/hooks/useTimelineClips";

// Vite Web Worker import (inline, no separate bundle file needed)
import PeaksWorkerUrl from "@/lib/peaksWorker.ts?worker&url";

export type WaveformStatus = "idle" | "loading" | "ready" | "error";

export interface WaveformPeaksState {
  status: WaveformStatus;
  peaks: MultiLodPeaks | null;
  error: string | null;
}

/** Singleton worker instance — reused across all hook instances */
let sharedWorker: Worker | null = null;
let workerIdCounter = 0;
const pendingJobs = new Map<number, {
  resolve: (v: PeaksWorkerOutput) => void;
  reject: (e: Error) => void;
}>();

function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(PeaksWorkerUrl, { type: "module" });
    sharedWorker.onmessage = (e: MessageEvent<PeaksWorkerOutput & { _jobId: number }>) => {
      const { _jobId, ...result } = e.data;
      const job = pendingJobs.get(_jobId);
      if (job) {
        pendingJobs.delete(_jobId);
        job.resolve(result);
      }
    };
    sharedWorker.onerror = (e) => {
      // Reject all pending jobs
      for (const [id, job] of pendingJobs) {
        job.reject(new Error(e.message || "Worker error"));
        pendingJobs.delete(id);
      }
    };
  }
  return sharedWorker;
}

function postToWorker(
  clips: ClipChannelData[],
  sceneDuration: number,
  lodLevels: number[],
  sampleRate: number,
): Promise<PeaksWorkerOutput> {
  return new Promise((resolve, reject) => {
    const jobId = ++workerIdCounter;
    pendingJobs.set(jobId, { resolve, reject });

    const worker = getWorker();
    // Collect transferables (channel data Float32Arrays)
    const transferables: Transferable[] = [];
    for (const c of clips) {
      transferables.push(c.left.buffer as ArrayBuffer, c.right.buffer as ArrayBuffer);
    }
    worker.postMessage(
      { clips, sceneDuration, lodLevels, sampleRate, _jobId: jobId },
      transferables,
    );
  });
}

function workerOutputToMultiLod(output: PeaksWorkerOutput): MultiLodPeaks {
  const lods = new Map<LodLevel, StereoPeaks>();
  for (const lod of output.lods) {
    lods.set(lod.lodLevel, {
      left: lod.left,
      right: lod.right,
      sampleRate: output.sampleRate,
      duration: output.duration,
      lodLevel: lod.lodLevel,
    });
  }
  return { lods, sampleRate: output.sampleRate, duration: output.duration };
}

/**
 * Load and compute waveform peaks for ALL clips of a track within a scene.
 * Peaks are positioned according to each clip's scene-local startSec.
 * Heavy computation runs in a Web Worker to keep UI responsive.
 */
export function useWaveformPeaks(
  trackClips: TimelineClip[],
  trackId: string | null,
  sceneDuration: number = 0,
  displayWidthPx: number = 1600,
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

      const compositeCacheKey = `scene_${trackId}_${clipsKey}`;

      // Try cache first
      const cached = await loadCachedPeaks(compositeCacheKey);
      if (cached && !abort.signal.aborted) {
        setState({ status: "ready", peaks: cached, error: null });
        return;
      }

      // Decode ALL clips' audio on main thread (decodeAudioData needs AudioContext)
      const audioCtx = new AudioContext();
      try {
        const workerClips: ClipChannelData[] = [];

        for (const clip of audioClips) {
          if (abort.signal.aborted) return;

          const path = clip.audioPath!;
          const arrayBuf = await getAudioBuffer(storage!, path);
          if (!arrayBuf) {
            console.warn(`[useWaveformPeaks] Skip clip ${clip.id}: not found in OPFS`);
            continue;
          }
          if (abort.signal.aborted) return;

          const buffer = await audioCtx.decodeAudioData(arrayBuf.slice(0));
          if (abort.signal.aborted) return;

          // Extract raw channel data as copies (originals tied to AudioBuffer)
          const left = new Float32Array(buffer.getChannelData(0));
          const right = buffer.numberOfChannels > 1
            ? new Float32Array(buffer.getChannelData(1))
            : new Float32Array(left);

          workerClips.push({
            startSec: clip.startSec,
            durationSec: clip.durationSec,
            bufferDuration: buffer.duration,
            sampleRate: buffer.sampleRate,
            left,
            right,
          });
        }

        if (abort.signal.aborted) return;

        if (workerClips.length === 0) {
          setState({ status: "idle", peaks: null, error: null });
          return;
        }

        // Compute peaks in Web Worker (off main thread)
        const lodLevels = computeLodLevels(sceneDuration, displayWidthPx);
        const sampleRate = workerClips[0].sampleRate;
        const output = await postToWorker(workerClips, sceneDuration, lodLevels, sampleRate);

        if (abort.signal.aborted) return;

        const peaks = workerOutputToMultiLod(output);

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
  }, [trackId, clipsKey, trackClips, sceneDuration, displayWidthPx]);

  useEffect(() => {
    loadPeaks();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadPeaks]);

  return state;
}
