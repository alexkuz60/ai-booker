/**
 * vcPipeline.ts — Unified Voice Conversion pipeline.
 *
 * Orchestrates: resample → ContentVec embeddings → CREPE pitch (F0) → RVC synthesis
 * Produces a VcFeatures object or fully converted audio.
 */

import { resampleTo16kMono } from "./vcResample";
import { extractContentVec, type ContentVecResult } from "./vcContentVec";
import { extractPitch, type CrepeResult, type PitchFrame } from "./vcCrepe";
import { synthesizeVoice, vcAudioToWav, type VcSynthesisResult, type VcSynthesisOptions } from "./vcSynthesis";

export interface VcFeatures {
  /** Speaker-independent phonetic embeddings [T, 768] */
  embeddings: Float32Array;
  numFrames: number;
  embeddingDim: number;
  /** F0 pitch contour */
  pitchFrames: PitchFrame[];
  /** Original audio duration in seconds */
  durationSec: number;
  /** Total pipeline time in ms */
  totalMs: number;
  /** Per-stage timing */
  timing: {
    resampleMs: number;
    contentvecMs: number;
    crepeMs: number;
  };
}

export interface VcPipelineOptions {
  /** CREPE hop size in ms (default 10) */
  crepeHopMs?: number;
  /** Callback for progress updates */
  onProgress?: (stage: "resample" | "contentvec" | "crepe", progress: number) => void;
}

/**
 * Extract all VC features from raw audio.
 * Models must be pre-downloaded to OPFS via vcModelCache.
 *
 * @param audio - Raw audio as ArrayBuffer or Blob (any format browsers can decode)
 * @param options - Pipeline configuration
 * @returns VcFeatures ready for voice synthesis
 */
export async function extractVcFeatures(
  audio: ArrayBuffer | Blob,
  options?: VcPipelineOptions,
): Promise<VcFeatures> {
  const startTotal = performance.now();
  const onProgress = options?.onProgress;

  // Stage 1: Resample to 16kHz mono
  onProgress?.("resample", 0);
  const t0 = performance.now();
  const { samples, durationSec } = await resampleTo16kMono(audio);
  const resampleMs = Math.round(performance.now() - t0);
  onProgress?.("resample", 1);

  // Stage 2: ContentVec embeddings
  onProgress?.("contentvec", 0);
  const cvResult: ContentVecResult = await extractContentVec(samples);
  onProgress?.("contentvec", 1);

  // Stage 3: CREPE pitch extraction
  onProgress?.("crepe", 0);
  const crepeResult: CrepeResult = await extractPitch(
    samples,
    16_000,
    options?.crepeHopMs ?? 10,
  );
  onProgress?.("crepe", 1);

  const totalMs = Math.round(performance.now() - startTotal);

  console.info(
    `[vcPipeline] Complete: ${durationSec.toFixed(2)}s audio → ` +
    `${cvResult.numFrames} embeddings + ${crepeResult.frames.length} pitch frames, ` +
    `${totalMs}ms total (resample ${resampleMs}ms, CV ${cvResult.inferenceMs}ms, CREPE ${crepeResult.inferenceMs}ms)`
  );

  return {
    embeddings: cvResult.embeddings,
    numFrames: cvResult.numFrames,
    embeddingDim: cvResult.dim,
    pitchFrames: crepeResult.frames,
    durationSec,
    totalMs,
    timing: {
      resampleMs,
      contentvecMs: cvResult.inferenceMs,
      crepeMs: crepeResult.inferenceMs,
    },
  };
}

/**
 * Interpolate F0 to match ContentVec frame count.
 * ContentVec produces ~50 frames/sec, CREPE at ~100 frames/sec.
 * Linear interpolation to align temporal resolution.
 */
export function alignPitchToEmbeddings(
  pitchFrames: PitchFrame[],
  targetFrameCount: number,
): Float32Array {
  const aligned = new Float32Array(targetFrameCount);
  if (pitchFrames.length === 0) return aligned;

  const ratio = pitchFrames.length / targetFrameCount;
  for (let i = 0; i < targetFrameCount; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, pitchFrames.length - 1);
    const frac = srcIdx - lo;
    // Interpolate frequency; skip unvoiced (0 Hz)
    const f0lo = pitchFrames[lo].frequencyHz;
    const f0hi = pitchFrames[hi].frequencyHz;
    if (f0lo === 0 || f0hi === 0) {
      aligned[i] = f0lo || f0hi; // use whichever is voiced
    } else {
      aligned[i] = f0lo * (1 - frac) + f0hi * frac;
    }
  }
  return aligned;
}
