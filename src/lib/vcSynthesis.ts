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

import {
  ensureVcSession,
  runVcInference,
  validateInferenceOutput,
  type TensorDesc,
  type SessionInfo,
} from "./vcInferenceSession";
import { alignPitchToEmbeddings } from "./vcPipeline";
import { applyFeatureRetrieval } from "./vcIndexSearch";
import type { VcFeatures } from "./vcPipeline";

// RVC v2 constants — mel-scale pitch quantization (matches Applio/RVC reference)
const F0_HZ_MIN = 50;
const F0_HZ_MAX = 1100;
const F0_MEL_MIN = 1127.0 * Math.log(1 + F0_HZ_MIN / 700.0);
const F0_MEL_MAX = 1127.0 * Math.log(1 + F0_HZ_MAX / 700.0);

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
  audio: Float32Array;
  sampleRate: number;
  durationSec: number;
  inferenceMs: number;
  srAutoDetected: boolean;
  resampleMetrics: VcResampleMetrics;
}

export interface VcSynthesisOptions {
  speakerId?: number;
  pitchShift?: number;
  modelId?: string;
  outputSampleRate?: RvcOutputSR;
  indexRate?: number;
  protect?: number;
  indexData?: {
    data: Float32Array;
    rows: number;
    cols: number;
  };
}

function f0ToCoarsePitch(f0Hz: number): number {
  if (f0Hz <= 0) return 0;
  const clamped = Math.max(F0_HZ_MIN, Math.min(F0_HZ_MAX, f0Hz));
  const mel = 1127.0 * Math.log(1 + clamped / 700.0);
  const bin = (mel - F0_MEL_MIN) * 254 / (F0_MEL_MAX - F0_MEL_MIN) + 1;
  return Math.max(1, Math.min(255, Math.round(bin)));
}

function applyPitchShift(f0Hz: number, semitones: number): number {
  if (f0Hz <= 0 || semitones === 0) return f0Hz;
  const shifted = f0Hz * Math.pow(2, semitones / 12);
  return Math.max(F0_HZ_MIN, Math.min(F0_HZ_MAX, shifted));
}

/**
 * Try to detect output sample rate from session metadata.
 */
function detectOutputSRFromInfo(info: SessionInfo): RvcOutputSR | null {
  try {
    const meta = info.metadata;
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
  } catch {}
  return null;
}

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
 * Log tensor statistics for debugging.
 */
function logTensorStats(label: string, desc: TensorDesc): void {
  const dims = `[${desc.dims}]`;
  if (desc.dtype === "float32") {
    const d = desc.data as Float32Array;
    let min = Infinity, max = -Infinity, sum = 0, sumSq = 0;
    for (let i = 0; i < d.length; i++) {
      const val = d[i];
      if (val < min) min = val;
      if (val > max) max = val;
      sum += val;
      sumSq += val * val;
    }
    const mean = sum / d.length;
    const std = Math.sqrt(sumSq / d.length - mean * mean);
    const zeros = d.reduce((c, v) => c + (v === 0 ? 1 : 0), 0);
    console.info(
      `[vcSynthesis] feed "${label}": shape=${dims}, type=${desc.dtype}, ` +
      `min=${min.toFixed(4)}, max=${max.toFixed(4)}, mean=${mean.toFixed(4)}, ` +
      `std=${std.toFixed(4)}, zeros=${zeros}/${d.length}`
    );
  } else if (desc.dtype === "int64") {
    const d = desc.data as BigInt64Array;
    let min = d[0], max = d[0];
    for (let i = 1; i < d.length; i++) {
      if (d[i] < min) min = d[i];
      if (d[i] > max) max = d[i];
    }
    const zeros = Array.from(d).filter(v => v === 0n).length;
    console.info(
      `[vcSynthesis] feed "${label}": shape=${dims}, type=${desc.dtype}, ` +
      `min=${min}, max=${max}, zeros=${zeros}/${d.length}`
    );
  } else if (desc.dtype === "int32") {
    const d = desc.data as Int32Array;
    let min = d[0], max = d[0];
    for (let i = 1; i < d.length; i++) {
      if (d[i] < min) min = d[i];
      if (d[i] > max) max = d[i];
    }
    const zeros = Array.from(d).filter(v => v === 0).length;
    console.info(
      `[vcSynthesis] feed "${label}": shape=${dims}, type=${desc.dtype}, ` +
      `min=${min}, max=${max}, zeros=${zeros}/${d.length}`
    );
  } else {
    console.info(`[vcSynthesis] feed "${label}": shape=${dims}, type=${desc.dtype}`);
  }
}

export async function synthesizeVoice(
  features: VcFeatures,
  options?: VcSynthesisOptions,
): Promise<VcSynthesisResult> {
  const modelId = options?.modelId ?? "rvc-v2";
  const speakerId = options?.speakerId ?? 0;
  const pitchShift = options?.pitchShift ?? 0;
  const protect = Math.max(0, Math.min(0.5, options?.protect ?? 0.33));
  const indexRate = Math.max(0, Math.min(1, options?.indexRate ?? 0.75));

  const info = await ensureVcSession(modelId);

  // Determine output SR: user override > auto-detect > default (40kHz)
  let srAutoDetected = false;
  let outputSR = options?.outputSampleRate ?? RVC_OUTPUT_SR_DEFAULT;

  if (!options?.outputSampleRate) {
    const detectedSR = detectOutputSRFromInfo(info);
    if (detectedSR) {
      outputSR = detectedSR;
      srAutoDetected = true;
      console.info(`[vcSynthesis] Auto-detected output SR: ${detectedSR}Hz`);
    }
  }

  // ── Critical: 2x upsample ContentVec embeddings ──────────────────────
  const srcT = features.numFrames;
  const T = srcT * 2;
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
  let protectSourceEmbeddings: Float32Array | null = null;
  let retrievalApplied = false;
  if (indexRate > 0 && options?.indexData) {
    const { data: trainData, rows: trainN, cols: trainDim } = options.indexData;
    if (trainDim === features.embeddingDim) {
      if (protect < 0.5) {
        protectSourceEmbeddings = upEmb.slice();
      }
      await applyFeatureRetrieval(upEmb, T, features.embeddingDim, trainData, trainN, indexRate);
      retrievalApplied = true;
    } else {
      console.warn(`[vcSynthesis] Index dim mismatch: ${trainDim} vs ${features.embeddingDim}, skipping retrieval`);
    }
  } else if (protect < 0.5 && indexRate > 0) {
    console.info(`[vcSynthesis] No index loaded — protect disabled, F0 kept unchanged`);
  }

  const effectiveIndexRate = retrievalApplied ? indexRate : 0;

  // Align F0 pitch to upsampled frame count (2T)
  const alignedF0 = alignPitchToEmbeddings(features.pitchFrames, T);

  // ── Consonant Protection ─────────────────────────────────────────────
  if (protect < 0.5 && retrievalApplied && protectSourceEmbeddings) {
    let protectedFrames = 0;
    for (let i = 0; i < T; i++) {
      if (alignedF0[i] < 1) {
        protectedFrames += 1;
        const off = i * features.embeddingDim;
        for (let d = 0; d < features.embeddingDim; d++) {
          upEmb[off + d] = upEmb[off + d] * protect
                         + protectSourceEmbeddings[off + d] * (1 - protect);
        }
      }
    }
    console.info(`[vcSynthesis] Protect blend: ${protectedFrames}/${T} unvoiced frames, factor=${protect}`);
  }

  // Build pitch tensors
  const pitchCoarse = new Float32Array(T);
  const pitchFine = new Float32Array(T);

  for (let i = 0; i < T; i++) {
    let f0 = applyPitchShift(alignedF0[i], pitchShift);
    if (f0 > 0) {
      f0 = Math.max(F0_HZ_MIN, Math.min(F0_HZ_MAX, f0));
    }
    pitchCoarse[i] = f0ToCoarsePitch(f0);
    pitchFine[i] = f0;
  }

  // Prepare TensorDesc feeds — use int32 (WebGPU/WGSL has no int64 support)
  const featsDesc: TensorDesc = { data: upEmb, dims: [1, T, features.embeddingDim], dtype: "float32" };
  const pLenDesc: TensorDesc = { data: Int32Array.from([T]), dims: [1], dtype: "int32" };
  const pitchDesc: TensorDesc = {
    data: Int32Array.from(pitchCoarse, (v) => Math.round(v)),
    dims: [1, T],
    dtype: "int32",
  };
  const pitchfDesc: TensorDesc = { data: pitchFine, dims: [1, T], dtype: "float32" };
  const sidDesc: TensorDesc = { data: Int32Array.from([speakerId]), dims: [1], dtype: "int32" };

  // Build feeds — match model's expected input names
  const inputNames = info.inputNames;
  const feeds: Record<string, TensorDesc> = {};

  console.info(`[vcSynthesis] Model input names: [${inputNames.join(", ")}]`);

  for (const name of inputNames) {
    const key = name.toLowerCase();
    if (key === "feats" || key === "phone" || key === "hubert") {
      feeds[name] = featsDesc;
    } else if (key === "p_len" || key === "plen" || key === "lengths") {
      feeds[name] = pLenDesc;
    } else if (key === "pitch" || key === "f0_coarse" || key === "f0coarse") {
      feeds[name] = pitchDesc;
    } else if (key === "pitchf" || key === "f0" || key === "f0_fine" || key === "nsff0") {
      feeds[name] = pitchfDesc;
    } else if (key === "sid" || key === "speaker_id" || key === "spk_id") {
      feeds[name] = sidDesc;
    }
  }

  // Fallback: map by position if name matching was incomplete
  if (Object.keys(feeds).length < inputNames.length) {
    const ordered = [featsDesc, pLenDesc, pitchDesc, pitchfDesc, sidDesc];
    for (let i = 0; i < Math.min(inputNames.length, ordered.length); i++) {
      if (!feeds[inputNames[i]]) {
        feeds[inputNames[i]] = ordered[i];
      }
    }
  }

  // Log feed statistics
  for (const [k, v] of Object.entries(feeds)) {
    logTensorStats(k, v);
  }

  console.info(
    `[vcSynthesis] Running RVC "${modelId}": ${T} frames, ` +
    `pitchShift=${pitchShift}st, speaker=${speakerId}, ` +
    `indexRate=${effectiveIndexRate}, protect=${protect}, ` +
    `inputs=[${inputNames.join(", ")}]`
  );

  const startMs = performance.now();
  const results = await runVcInference(modelId, feeds);
  const inferenceMs = Math.round(performance.now() - startMs);

  // Extract output audio
  const outputName = info.outputNames[0] ?? "audio";
  const output = results[outputName];
  if (!output) {
    throw new Error(`[vcSynthesis] No output tensor. Available: ${Object.keys(results).join(", ")}`);
  }

  const rawAudio = new Float32Array(output.data as Float32Array);

  // Validate output — detect WebGPU corruption
  validateInferenceOutput(rawAudio, modelId, "RVC audio output");

  // Diagnostic: output tensor statistics
  {
    let min = Infinity, max = -Infinity, sum = 0, sumSq = 0;
    for (let i = 0; i < rawAudio.length; i++) {
      const v = rawAudio[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / rawAudio.length;
    const std = Math.sqrt(sumSq / rawAudio.length - mean * mean);
    console.info(
      `[vcSynthesis] OUTPUT "${outputName}": dims=[${output.dims}], ` +
      `samples=${rawAudio.length}, min=${min.toFixed(4)}, max=${max.toFixed(4)}, ` +
      `mean=${mean.toFixed(6)}, std=${std.toFixed(4)}`
    );
  }

  // Resample RVC output → 44.1 kHz
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

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

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
