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
import { WebGPUCorruptError, forceWasmFallback, getSessionBackend } from "./vcInferenceSession";
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
  /** Speech encoder (default "contentvec") */
  encoder?: SpeechEncoder;
  /** Callback for progress updates */
  onProgress?: (stage: "resample" | "normalize" | "contentvec" | "crepe" | "synthesis", progress: number) => void;
  /** Synthesis options (pitch shift, speaker ID, model) */
  synthesis?: VcSynthesisOptions;
  /** Dry/Wet mix ratio: 0.0 = pure TTS (dry), 1.0 = pure RVC (wet). Default 1.0 */
  dryWet?: number;
}

/**
 * Extract pitch using the selected algorithm.
 * Exported so callers can get F0 without running the full encoder pipeline.
 */
export async function extractPitchWithAlgorithm(
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
  const encoder = options?.encoder ?? "contentvec";

  // Stage 1: Resample to 16kHz mono
  onProgress?.("resample", 0);
  const t0 = performance.now();
  const { samples: rawSamples, durationSec } = await resampleTo16kMono(audio);
  const resampleMs = Math.round(performance.now() - t0);
  onProgress?.("resample", 1);

  // Stage 2: RMS normalization
  onProgress?.("normalize", 0);
  const normResult = normalizeRms(rawSamples);
  const samples = normResult.samples;
  onProgress?.("normalize", 1);

  // Stage 3: Speech encoder (ContentVec or WavLM)
  onProgress?.("contentvec", 0);
  const cvResult: ContentVecResult = encoder === "wavlm"
    ? await extractWavLM(samples)
    : await extractContentVec(samples);
  onProgress?.("contentvec", 1);

  // Stage 4: Pitch extraction (algorithm-dependent)
  onProgress?.("crepe", 0);
  const pitchResult: CrepeResult = await extractPitchWithAlgorithm(
    samples,
    pitchAlgorithm,
    options?.crepeHopMs ?? 10,
  );
  onProgress?.("crepe", 1);

  const totalMs = Math.round(performance.now() - startTotal);

  const algoLabel = pitchAlgorithm === "rmvpe" ? "RMVPE" : pitchAlgorithm === "crepe-full" ? "CREPE-Full" : pitchAlgorithm === "swiftf0" ? "SwiftF0" : "CREPE-Tiny";
  const encLabel = encoder === "wavlm" ? "WavLM" : "ContentVec";
  console.info(
    `[vcPipeline] Complete (${encLabel}+${algoLabel}): ${durationSec.toFixed(2)}s audio → ` +
    `${cvResult.numFrames} embeddings + ${pitchResult.frames.length} pitch frames, ` +
    `${totalMs}ms total (resample ${resampleMs}ms, norm ${normResult.normalizeMs}ms, enc ${cvResult.inferenceMs}ms, pitch ${pitchResult.inferenceMs}ms)`
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
      normalizeMs: normResult.normalizeMs,
      encoderMs: cvResult.inferenceMs,
      crepeMs: pitchResult.inferenceMs,
    },
    pitchAlgorithm,
    encoder,
  };
}

/**
 * Lightweight F0-only extraction: resample → normalize → pitch.
 * Skips the encoder (ContentVec/WavLM) entirely — much faster and
 * avoids model compatibility issues when only pitch contour is needed.
 */
export async function extractF0Only(
  audio: ArrayBuffer | Blob,
  pitchAlgorithm: PitchAlgorithm = "crepe-tiny",
  hopMs = 10,
): Promise<PitchFrame[]> {
  const { samples: rawSamples } = await resampleTo16kMono(audio);
  const { samples } = normalizeRms(rawSamples);
  const result = await extractPitchWithAlgorithm(samples, pitchAlgorithm, hopMs);
  return result.frames;
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
  try {
    return await _convertVoiceFullImpl(audio, options);
  } catch (err) {
    if (err instanceof WebGPUCorruptError) {
      console.warn(`[vcPipeline] WebGPU corruption detected, retrying with WASM...`, err.message);
      const switched = await forceWasmFallback();
      if (switched) {
        options?.onProgress?.("resample", 0);
        return await _convertVoiceFullImpl(audio, options);
      }
    }
    throw err;
  }
}

/** Internal implementation of the full VC pipeline */
async function _convertVoiceFullImpl(
  audio: ArrayBuffer | Blob,
  options?: VcPipelineOptions,
): Promise<VcFullResult> {
  const t0 = performance.now();
  const dryWet = Math.max(0, Math.min(1, options?.dryWet ?? 1.0));

  // Extract features (resample + ContentVec + CREPE)
  const features = await extractVcFeatures(audio, options);

  // Synthesize with RVC
  options?.onProgress?.("synthesis", 0);
  const synthesis = await synthesizeVoice(features, options?.synthesis);
  options?.onProgress?.("synthesis", 1);

  // ── Dry/Wet mixing ──
  let finalAudio = synthesis.audio;
  if (dryWet < 0.999) {
    const dryResampled = await resampleForMix(audio, synthesis.sampleRate);
    const minLen = Math.min(dryResampled.length, synthesis.audio.length);
    const mixed = new Float32Array(minLen);
    for (let i = 0; i < minLen; i++) {
      mixed[i] = dryResampled[i] * (1 - dryWet) + synthesis.audio[i] * dryWet;
    }
    finalAudio = mixed;
    console.info(`[vcPipeline] Dry/Wet mix: ${((1 - dryWet) * 100).toFixed(0)}% TTS + ${(dryWet * 100).toFixed(0)}% RVC`);
  }

  // Encode to WAV
  const wav = vcAudioToWav(finalAudio, synthesis.sampleRate);
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

/**
 * Resample input audio to target sample rate for dry/wet mixing.
 */
async function resampleForMix(audio: ArrayBuffer | Blob, targetSR: number): Promise<Float32Array> {
  const buf = audio instanceof Blob ? await audio.arrayBuffer() : audio;
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetSR), targetSR);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } finally {
    await ctx.close();
  }
}
