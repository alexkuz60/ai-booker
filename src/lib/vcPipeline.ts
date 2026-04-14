/**
 * vcPipeline.ts — Unified Voice Conversion pipeline.
 *
 * Orchestrates: resample → normalize → encoder (ContentVec/WavLM) → Pitch (F0) → RVC synthesis
 * Supports pitch algorithms: CREPE Tiny, CREPE Full, SwiftF0, RMVPE
 * Supports speech encoders: ContentVec (HuBERT), WavLM-Base-Plus
 */

import { resampleTo16kMono } from "./vcResample";
import { normalizeRms } from "./vcNormalize";
import { extractContentVec, type ContentVecResult } from "./vcContentVec";
import { extractWavLM } from "./vcWavLM";
import { extractPitch, type CrepeResult, type PitchFrame } from "./vcCrepe";
import { extractPitchRmvpe } from "./vcRmvpe";
import { extractPitchSwiftF0 } from "./vcSwiftF0";
import { synthesizeVoice, vcAudioToWav, type VcSynthesisResult, type VcSynthesisOptions } from "./vcSynthesis";
import type { PitchAlgorithm, SpeechEncoder } from "./vcModelCache";

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
    normalizeMs: number;
    encoderMs: number;
    crepeMs: number;
  };
  /** Which pitch algorithm was used */
  pitchAlgorithm: PitchAlgorithm;
  /** Which speech encoder was used */
  encoder: SpeechEncoder;
}

export interface VcPipelineOptions {
  /** CREPE hop size in ms (default 10) — only for CREPE algorithms */
  crepeHopMs?: number;
  /** Pitch extraction algorithm (default "crepe-tiny") */
  pitchAlgorithm?: PitchAlgorithm;
  /** Callback for progress updates */
  onProgress?: (stage: "resample" | "contentvec" | "crepe" | "synthesis", progress: number) => void;
  /** Synthesis options (pitch shift, speaker ID, model) */
  synthesis?: VcSynthesisOptions;
}

/**
 * Extract pitch using the selected algorithm.
 */
async function extractPitchWithAlgorithm(
  samples: Float32Array,
  algorithm: PitchAlgorithm,
  hopMs: number,
): Promise<CrepeResult> {
  switch (algorithm) {
    case "crepe-tiny":
      return extractPitch(samples, 16_000, hopMs, "crepe-tiny");
    case "crepe-full":
      return extractPitch(samples, 16_000, hopMs, "crepe-full");
    case "swiftf0":
      return extractPitchSwiftF0(samples, 16_000);
    case "rmvpe":
      return extractPitchRmvpe(samples, 16_000);
    default:
      return extractPitch(samples, 16_000, hopMs, "crepe-tiny");
  }
}

/**
 * Extract all VC features from raw audio.
 */
export async function extractVcFeatures(
  audio: ArrayBuffer | Blob,
  options?: VcPipelineOptions,
): Promise<VcFeatures> {
  const startTotal = performance.now();
  const onProgress = options?.onProgress;
  const pitchAlgorithm = options?.pitchAlgorithm ?? "crepe-tiny";

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

  // Stage 3: Pitch extraction (algorithm-dependent)
  onProgress?.("crepe", 0);
  const pitchResult: CrepeResult = await extractPitchWithAlgorithm(
    samples,
    pitchAlgorithm,
    options?.crepeHopMs ?? 10,
  );
  onProgress?.("crepe", 1);

  const totalMs = Math.round(performance.now() - startTotal);

  const algoLabel = pitchAlgorithm === "rmvpe" ? "RMVPE" : pitchAlgorithm === "crepe-full" ? "CREPE-Full" : "CREPE-Tiny";
  console.info(
    `[vcPipeline] Complete (${algoLabel}): ${durationSec.toFixed(2)}s audio → ` +
    `${cvResult.numFrames} embeddings + ${pitchResult.frames.length} pitch frames, ` +
    `${totalMs}ms total (resample ${resampleMs}ms, CV ${cvResult.inferenceMs}ms, pitch ${pitchResult.inferenceMs}ms)`
  );

  return {
    embeddings: cvResult.embeddings,
    numFrames: cvResult.numFrames,
    embeddingDim: cvResult.dim,
    pitchFrames: pitchResult.frames,
    durationSec,
    totalMs,
    timing: {
      resampleMs,
      contentvecMs: cvResult.inferenceMs,
      crepeMs: pitchResult.inferenceMs,
    },
    pitchAlgorithm,
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

// ── Full end-to-end Voice Conversion ──────────────────────────────────────

export interface VcResampleInfo {
  /** Input sample count (from RVC model) */
  inputSamples: number;
  /** Output sample count (after resample) */
  outputSamples: number;
  /** RVC model native sample rate */
  inputSR: number;
  /** Project output sample rate */
  outputSR: number;
  /** Duration in seconds (should be same before/after) */
  durationSec: number;
  /** Resample time in ms */
  resampleMs: number;
}

export interface VcFullResult {
  /** Converted audio as WAV Blob */
  wav: Blob;
  /** Features extracted from source audio */
  features: VcFeatures;
  /** Synthesis result (raw audio, timing) */
  synthesis: VcSynthesisResult;
  /** Output resampling metrics */
  resample: VcResampleInfo;
  /** Total wall-clock time in ms */
  totalMs: number;
}

/**
 * Full end-to-end Voice Conversion pipeline:
 * raw audio → resample → ContentVec → CREPE → RVC synthesis → WAV
 *
 * @param audio - Source audio (any browser-decodable format)
 * @param options - Pipeline + synthesis options
 */
export async function convertVoiceFull(
  audio: ArrayBuffer | Blob,
  options?: VcPipelineOptions,
): Promise<VcFullResult> {
  const t0 = performance.now();

  // Extract features (resample + ContentVec + CREPE)
  const features = await extractVcFeatures(audio, options);

  // Synthesize with RVC
  options?.onProgress?.("synthesis", 0);
  const synthesis = await synthesizeVoice(features, options?.synthesis);
  options?.onProgress?.("synthesis", 1);

  // Encode to WAV
  const wav = vcAudioToWav(synthesis.audio, synthesis.sampleRate);
  const totalMs = Math.round(performance.now() - t0);

  const resample: VcResampleInfo = {
    inputSamples: synthesis.resampleMetrics.inputSamples,
    outputSamples: synthesis.resampleMetrics.outputSamples,
    inputSR: synthesis.resampleMetrics.inputSR,
    outputSR: synthesis.resampleMetrics.outputSR,
    durationSec: synthesis.resampleMetrics.durationSec,
    resampleMs: synthesis.resampleMetrics.resampleMs,
  };

  console.info(
    `[vcPipeline] Full VC complete: ${features.durationSec.toFixed(2)}s input → ` +
    `${synthesis.durationSec.toFixed(2)}s output, ${totalMs}ms total`
  );

  return { wav, features, synthesis, resample, totalMs };
}
