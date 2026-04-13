/**
 * vcSynthesis.ts — RVC v2 Voice Synthesis module.
 *
 * Takes ContentVec embeddings (768-dim) + F0 pitch contour
 * and synthesizes audio with a target voice timbre using
 * the RVC v2 SynthesizerTrn ONNX model.
 *
 * RVC v2 ONNX contract (SynthesizerTrnMsNSFsid):
 *   Inputs:
 *     - feats:  [1, T, 768]  — ContentVec/HuBERT embeddings
 *     - p_len:  [1]          — sequence length
 *     - pitch:  [1, T]       — coarse pitch (semitone bin index)
 *     - pitchf: [1, T]       — fine pitch (Hz, float)
 *     - sid:    [1]          — speaker ID (0 for single-speaker models)
 *   Output:
 *     - audio:  [1, 1, S]    — synthesized waveform at model sample rate
 *
 * The output sample rate depends on the model config (typically 32kHz or 40kHz for RVC v2).
 */

import * as ort from "onnxruntime-web";
import { createVcSession } from "./vcInferenceSession";
import { alignPitchToEmbeddings } from "./vcPipeline";
import { applyFeatureRetrieval } from "./vcIndexSearch";
import type { VcFeatures } from "./vcPipeline";

// RVC v2 constants — mel-scale pitch quantization (matches Applio/RVC reference)
const F0_HZ_MIN = 50;            // Min F0 in Hz
const F0_HZ_MAX = 1100;          // Max F0 in Hz
// Precomputed mel-scale boundaries
const F0_MEL_MIN = 1127.0 * Math.log(1 + F0_HZ_MIN / 700.0);   // ≈ 77.97
const F0_MEL_MAX = 1127.0 * Math.log(1 + F0_HZ_MAX / 700.0);   // ≈ 908.87

/** Supported RVC output sample rates */
export const RVC_OUTPUT_SR_OPTIONS = [32_000, 40_000, 44_100, 48_000] as const;
export type RvcOutputSR = typeof RVC_OUTPUT_SR_OPTIONS[number];

/** Default output sample rate — 40 kHz (most common for RVC v2 models) */
export const RVC_OUTPUT_SR_DEFAULT: RvcOutputSR = 40_000;

/** Project-standard sample rate for Studio timeline compatibility */
export const PROJECT_OUTPUT_SR = 44_100;

export interface VcResampleMetrics {
  inputSamples: number;
  outputSamples: number;
  inputSR: number;
  outputSR: number;
  durationSec: number;
  resampleMs: number;
}

export interface VcSynthesisResult {
  /** Synthesized audio samples (Float32Array) */
  audio: Float32Array;
  /** Sample rate of synthesized audio */
  sampleRate: number;
  /** Duration in seconds */
  durationSec: number;
  /** Inference time in ms */
  inferenceMs: number;
  /** Whether SR was auto-detected from model metadata */
  srAutoDetected: boolean;
  /** Output resampling metrics */
  resampleMetrics: VcResampleMetrics;
}

export interface VcSynthesisOptions {
  /** Speaker ID for multi-speaker models (default 0) */
  speakerId?: number;
  /** Pitch shift in semitones (-12 to +12, default 0) */
  pitchShift?: number;
  /** Custom RVC model ID in OPFS cache (default "rvc-v2") */
  modelId?: string;
  /** RVC model native sample rate (default 40kHz for most RVC v2 models) */
  outputSampleRate?: RvcOutputSR;
  /**
   * Feature Ratio (index_rate): 0.0–1.0 (default 0.75).
   * Controls blend between raw ContentVec embeddings and FAISS-retrieved
   * training data embeddings. Higher = more similar to training voice,
   * lower = more faithful to source articulation.
   * When no FAISS index is loaded, this is ignored.
   */
  indexRate?: number;
  /**
   * Consonant Protection: 0.0–0.5 (default 0.33).
   * Protects unvoiced consonants (sibilants, plosives) from VC artifacts.
   * Higher values preserve more of the original consonant texture.
   * Applied by zeroing F0 for frames below a voicing confidence threshold.
   */
  protect?: number;
  /**
   * Pre-loaded training embeddings for feature retrieval.
   * If provided along with indexRate > 0, applies KNN-based blending
   * to make output more similar to training voice.
   */
  indexData?: {
    data: Float32Array;
    rows: number;
    cols: number;
  };
}

/**
 * Convert continuous F0 (Hz) to coarse pitch bin index.
 * Uses **mel-scale** quantization to 255 bins [1..255], 0 = unvoiced.
 * This matches the reference RVC v2 / Applio implementation:
 *   f0_mel = 1127 * ln(1 + f0/700)
 *   bin = clip((f0_mel - mel_min) * 254 / (mel_max - mel_min) + 1, 1, 255)
 */
function f0ToCoarsePitch(f0Hz: number): number {
  if (f0Hz <= 0) return 0; // unvoiced
  const clamped = Math.max(F0_HZ_MIN, Math.min(F0_HZ_MAX, f0Hz));
  const mel = 1127.0 * Math.log(1 + clamped / 700.0);
  const bin = (mel - F0_MEL_MIN) * 254 / (F0_MEL_MAX - F0_MEL_MIN) + 1;
  return Math.max(1, Math.min(255, Math.round(bin)));
}

/**
 * Apply pitch shift in semitones to F0 values.
 */
function applyPitchShift(f0Hz: number, semitones: number): number {
  if (f0Hz <= 0 || semitones === 0) return f0Hz;
  const shifted = f0Hz * Math.pow(2, semitones / 12);
  // Clamp to valid range so coarse bins stay in [1,255]
  return Math.max(F0_HZ_MIN, Math.min(F0_HZ_MAX, shifted));
}

/**
 * Try to detect output sample rate from ONNX model metadata.
 * RVC models sometimes include "sample_rate" or "sr" in custom metadata.
 * Falls back to heuristic based on output tensor dimensions.
 */
function detectOutputSRFromModel(session: ort.InferenceSession): RvcOutputSR | null {
  try {
    // Check model metadata for sample_rate hint
    const meta = (session as any).handler?.metadata as Record<string, string> | undefined;
    if (meta) {
      for (const [key, val] of Object.entries(meta)) {
        const k = key.toLowerCase();
        if (k === "sample_rate" || k === "sr" || k === "output_sr" || k === "samplerate") {
          const sr = parseInt(val, 10);
          if (RVC_OUTPUT_SR_OPTIONS.includes(sr as RvcOutputSR)) {
            return sr as RvcOutputSR;
          }
        }
      }
    }
  } catch {
    // Metadata access may not be supported — that's OK
  }
  return null;
}

/**
 * Resample raw RVC output to project-standard 44.1 kHz using OfflineAudioContext.
 * Returns resampled audio + metrics.
 */
async function resampleToProjectSR(
  samples: Float32Array, sourceSR: number,
): Promise<{ resampled: Float32Array; metrics: VcResampleMetrics }> {
  const t0 = performance.now();
  const inputSamples = samples.length;
  const durationSec = inputSamples / sourceSR;

  if (sourceSR === PROJECT_OUTPUT_SR) {
    return {
      resampled: samples,
      metrics: { inputSamples, outputSamples: inputSamples, inputSR: sourceSR, outputSR: PROJECT_OUTPUT_SR, durationSec, resampleMs: 0 },
    };
  }

  const outLength = Math.ceil(durationSec * PROJECT_OUTPUT_SR);
  const offCtx = new OfflineAudioContext(1, outLength, PROJECT_OUTPUT_SR);
  const buf = offCtx.createBuffer(1, samples.length, sourceSR);
  buf.getChannelData(0).set(samples);

  const src = offCtx.createBufferSource();
  src.buffer = buf;
  src.connect(offCtx.destination);
  src.start(0);

  const rendered = await offCtx.startRendering();
  const resampled = rendered.getChannelData(0);
  const resampleMs = Math.round(performance.now() - t0);

  return {
    resampled,
    metrics: { inputSamples, outputSamples: resampled.length, inputSR: sourceSR, outputSR: PROJECT_OUTPUT_SR, durationSec, resampleMs },
  };
}


/**
 * Synthesize voice-converted audio from extracted VC features.
 *
 * @param features - Output from extractVcFeatures()
 * @param options  - Synthesis configuration
 * @returns Synthesized audio with target voice timbre
 */
export async function synthesizeVoice(
  features: VcFeatures,
  options?: VcSynthesisOptions,
): Promise<VcSynthesisResult> {
  const modelId = options?.modelId ?? "rvc-v2";
  const speakerId = options?.speakerId ?? 0;
  const pitchShift = options?.pitchShift ?? 0;
  const protect = Math.max(0, Math.min(0.5, options?.protect ?? 0.33));
  const indexRate = Math.max(0, Math.min(1, options?.indexRate ?? 0.75));

  const session = await createVcSession(modelId);

  // Try to auto-detect output SR from model metadata
  let srAutoDetected = false;
  let outputSR = options?.outputSampleRate ?? RVC_OUTPUT_SR_DEFAULT;

  if (!options?.outputSampleRate) {
    const detectedSR = detectOutputSRFromModel(session);
    if (detectedSR) {
      outputSR = detectedSR;
      srAutoDetected = true;
      console.info(`[vcSynthesis] Auto-detected output SR: ${detectedSR}Hz`);
    }
  }

  // ── Critical: 2x upsample ContentVec embeddings ──────────────────────
  // Reference RVC pipeline does: F.interpolate(feats, scale_factor=2)
  // ContentVec produces ~50 fps (hop=320 @ 16kHz), but RVC v2 decoder
  // expects ~100 fps. Decoder upsample product ≈ 400, so:
  //   100 fps × 400 = 40,000 samples/sec (correct for 40kHz model)
  //   50 fps × 400 = 20,000 samples/sec (2x slower — the bug we had)
  const srcT = features.numFrames;
  const T = srcT * 2; // 2x temporal upsample
  const upEmb = new Float32Array(T * features.embeddingDim);
  for (let i = 0; i < T; i++) {
    const srcIdx = i / 2;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, srcT - 1);
    const frac = srcIdx - lo;
    const offLo = lo * features.embeddingDim;
    const offHi = hi * features.embeddingDim;
    const offOut = i * features.embeddingDim;
    for (let d = 0; d < features.embeddingDim; d++) {
      upEmb[offOut + d] = features.embeddings[offLo + d] * (1 - frac)
                        + features.embeddings[offHi + d] * frac;
    }
  }

  // ── Feature Retrieval (index_rate) ───────────────────────────────────
  // If training data index is loaded, blend source embeddings with
  // KNN-retrieved training embeddings. Modifies upEmb in-place.
  if (indexRate > 0 && options?.indexData) {
    const { data: trainData, rows: trainN, cols: trainDim } = options.indexData;
    if (trainDim === features.embeddingDim) {
      await applyFeatureRetrieval(upEmb, T, features.embeddingDim, trainData, trainN, indexRate);
    } else {
      console.warn(`[vcSynthesis] Index dim mismatch: ${trainDim} vs ${features.embeddingDim}, skipping retrieval`);
    }
  }

  // Align F0 pitch to upsampled frame count (2T)
  const alignedF0 = alignPitchToEmbeddings(features.pitchFrames, T);

  // ── Consonant Protection ─────────────────────────────────────────────
  // Reference RVC implementation: if protect < 0.5, zero out F0 for frames
  // with low voicing confidence to preserve unvoiced consonant texture.
  // CREPE confidence <(1 - protect) → treat as unvoiced.
  if (protect < 0.5) {
    const confThreshold = 1 - protect; // e.g. protect=0.33 → threshold=0.67
    // Interpolate CREPE confidence to match T frames (same as F0 alignment)
    const srcConfLen = features.pitchFrames.length;
    const ratio = srcConfLen / T;
    for (let i = 0; i < T; i++) {
      const srcIdx = i * ratio;
      const lo = Math.floor(srcIdx);
      const hi = Math.min(lo + 1, srcConfLen - 1);
      const frac = srcIdx - lo;
      const conf = features.pitchFrames[lo].confidence * (1 - frac)
                 + features.pitchFrames[hi].confidence * frac;
      if (conf < confThreshold) {
        alignedF0[i] = 0; // mark as unvoiced → protects consonants
      }
    }
  }

  // Build pitch tensors
  const pitchCoarse = new Float32Array(T);
  const pitchFine = new Float32Array(T);

  for (let i = 0; i < T; i++) {
    const f0 = applyPitchShift(alignedF0[i], pitchShift);
    pitchCoarse[i] = f0ToCoarsePitch(f0);
    pitchFine[i] = f0;
  }

  // Prepare ONNX tensors
  // feats: [1, T, 768] — using 2x upsampled embeddings
  const featsTensor = new ort.Tensor("float32", upEmb, [1, T, features.embeddingDim]);
  // p_len: [1] — int64
  const pLenData = BigInt64Array.from([BigInt(T)]);
  const pLenTensor = new ort.Tensor("int64", pLenData, [1]);
  // pitch: [1, T] — int64 coarse bins
  const pitchData = BigInt64Array.from(Array.from(pitchCoarse, (v) => BigInt(Math.round(v))));
  const pitchTensor = new ort.Tensor("int64", pitchData, [1, T]);
  // pitchf: [1, T] — float32 fine Hz
  const pitchfTensor = new ort.Tensor("float32", pitchFine, [1, T]);
  // sid: [1] — int64
  const sidData = BigInt64Array.from([BigInt(speakerId)]);
  const sidTensor = new ort.Tensor("int64", sidData, [1]);

  // Build feeds — match model's expected input names
  const inputNames = session.inputNames;
  const feeds: Record<string, ort.Tensor> = {};

  console.info(`[vcSynthesis] Model input names: [${inputNames.join(", ")}]`);

  // Map known input names to tensors (case-insensitive, flexible matching)
  for (const name of inputNames) {
    const key = name.toLowerCase();
    if (key === "feats" || key === "phone" || key === "hubert") {
      feeds[name] = featsTensor;
    } else if (key === "p_len" || key === "plen" || key === "lengths") {
      feeds[name] = pLenTensor;
    } else if (key === "pitch" || key === "f0_coarse" || key === "f0coarse") {
      feeds[name] = pitchTensor;
    } else if (key === "pitchf" || key === "f0" || key === "f0_fine" || key === "nsff0") {
      feeds[name] = pitchfTensor;
    } else if (key === "sid" || key === "speaker_id" || key === "spk_id") {
      feeds[name] = sidTensor;
    }
  }

  // Fallback: map by position if name matching was incomplete
  if (Object.keys(feeds).length < inputNames.length) {
    const orderedTensors = [featsTensor, pLenTensor, pitchTensor, pitchfTensor, sidTensor];
    for (let i = 0; i < Math.min(inputNames.length, orderedTensors.length); i++) {
      if (!feeds[inputNames[i]]) {
        feeds[inputNames[i]] = orderedTensors[i];
      }
    }
  }

  // Log actual feed shapes for debugging
  for (const [k, v] of Object.entries(feeds)) {
    console.info(`[vcSynthesis] feed "${k}": shape=[${v.dims}], type=${v.type}`);
  }

  console.info(
    `[vcSynthesis] Running RVC "${modelId}": ${T} frames, ` +
    `pitchShift=${pitchShift}st, speaker=${speakerId}, ` +
    `indexRate=${indexRate}, protect=${protect}, ` +
    `inputs=[${inputNames.join(", ")}]`
  );

  const startMs = performance.now();
  const results = await session.run(feeds);
  const inferenceMs = Math.round(performance.now() - startMs);

  // Extract output audio
  const outputName = session.outputNames[0] ?? "audio";
  const output = results[outputName];
  if (!output) {
    throw new Error(
      `[vcSynthesis] No output tensor. Available: ${Object.keys(results).join(", ")}`
    );
  }

  const rawAudio = new Float32Array(output.data as Float32Array);

  // Resample RVC output → 44.1 kHz (project standard) for Studio timeline compatibility.
  // Output SR is the model's native rate (e.g. 40kHz) — NOT derived dynamically.
  const { resampled: finalAudio, metrics: resampleMetrics } = await resampleToProjectSR(rawAudio, outputSR);
  const finalSR = PROJECT_OUTPUT_SR;
  const durationSec = finalAudio.length / finalSR;

  console.info(
    `[vcSynthesis] Done: ${rawAudio.length} samples @ ${outputSR}Hz → ` +
    `${finalAudio.length} samples @ ${finalSR}Hz (${durationSec.toFixed(2)}s), ` +
    `resample ${resampleMetrics.resampleMs}ms, inference ${inferenceMs}ms`
  );

  return { audio: finalAudio, sampleRate: finalSR, durationSec, inferenceMs, srAutoDetected, resampleMetrics };
}

/**
 * Convert synthesized VC audio to a WAV Blob for playback/storage.
 */
export function vcAudioToWav(audio: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = audio.length * (bitsPerSample / 8);
  const headerSize = 44;

  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);          // chunk size
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // PCM samples — clamp and convert float32 → int16
  let offset = headerSize;
  for (let i = 0; i < audio.length; i++) {
    const s = Math.max(-1, Math.min(1, audio[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    view.setInt16(offset, val, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

