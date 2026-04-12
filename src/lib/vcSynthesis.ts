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
import type { VcFeatures } from "./vcPipeline";

// RVC v2 constants
const F0_BIN_SIZE = 256;      // Pitch bin count for coarse quantization
const F0_MAX = 1100;          // Max F0 in Hz for bin mapping
const F0_MIN = 50;            // Min F0 in Hz

/** Supported RVC output sample rates */
export const RVC_OUTPUT_SR_OPTIONS = [32_000, 40_000, 44_100, 48_000] as const;
export type RvcOutputSR = typeof RVC_OUTPUT_SR_OPTIONS[number];

/** Default output sample rate — 44.1 kHz to match project standard */
export const RVC_OUTPUT_SR_DEFAULT: RvcOutputSR = 44_100;

/** Project-standard sample rate for Studio timeline compatibility */
export const PROJECT_OUTPUT_SR = 44_100;

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
}

export interface VcSynthesisOptions {
  /** Speaker ID for multi-speaker models (default 0) */
  speakerId?: number;
  /** Pitch shift in semitones (-12 to +12, default 0) */
  pitchShift?: number;
  /** Custom RVC model ID in OPFS cache (default "rvc-v2") */
  modelId?: string;
  /** RVC model native sample rate — used to correctly interpret model output.
   *  Actual output is always resampled to PROJECT_OUTPUT_SR (44.1 kHz). */
  outputSampleRate?: RvcOutputSR;
}

/**
 * Convert continuous F0 (Hz) to coarse pitch bin index.
 * Uses logarithmic mapping similar to MIDI note numbers.
 */
function f0ToCoarsePitch(f0Hz: number): number {
  if (f0Hz <= 0) return 0; // unvoiced
  const clamped = Math.max(F0_MIN, Math.min(F0_MAX, f0Hz));
  // Log-scale mapping to bins
  const logF0 = Math.log2(clamped / F0_MIN);
  const logRange = Math.log2(F0_MAX / F0_MIN);
  const bin = Math.round((logF0 / logRange) * (F0_BIN_SIZE - 1));
  return Math.max(0, Math.min(F0_BIN_SIZE - 1, bin));
}

/**
 * Apply pitch shift in semitones to F0 values.
 */
function applyPitchShift(f0Hz: number, semitones: number): number {
  if (f0Hz <= 0 || semitones === 0) return f0Hz;
  return f0Hz * Math.pow(2, semitones / 12);
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
 */
async function resampleToProjectSR(samples: Float32Array, sourceSR: number): Promise<Float32Array> {
  if (sourceSR === PROJECT_OUTPUT_SR) return samples;

  const duration = samples.length / sourceSR;
  const outLength = Math.ceil(duration * PROJECT_OUTPUT_SR);

  // Create a buffer at the source SR, then resample via OfflineAudioContext
  const offCtx = new OfflineAudioContext(1, outLength, PROJECT_OUTPUT_SR);
  const buf = offCtx.createBuffer(1, samples.length, sourceSR);
  buf.getChannelData(0).set(samples);

  const src = offCtx.createBufferSource();
  src.buffer = buf;
  src.connect(offCtx.destination);
  src.start(0);

  const rendered = await offCtx.startRendering();
  return rendered.getChannelData(0);
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

  const T = features.numFrames;

  // Align F0 pitch to ContentVec frame count
  const alignedF0 = alignPitchToEmbeddings(features.pitchFrames, T);

  // Build pitch tensors
  const pitchCoarse = new Float32Array(T);
  const pitchFine = new Float32Array(T);

  for (let i = 0; i < T; i++) {
    const f0 = applyPitchShift(alignedF0[i], pitchShift);
    pitchCoarse[i] = f0ToCoarsePitch(f0);
    pitchFine[i] = f0;
  }

  // Prepare ONNX tensors
  // feats: [1, T, 768]
  const featsTensor = new ort.Tensor("float32", features.embeddings, [1, T, features.embeddingDim]);
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

  // Resample RVC output → 44.1 kHz (project standard) for Studio timeline compatibility
  const finalAudio = await resampleToProjectSR(rawAudio, outputSR);
  const finalSR = PROJECT_OUTPUT_SR;
  const durationSec = finalAudio.length / finalSR;

  console.info(
    `[vcSynthesis] Done: ${rawAudio.length} samples @ ${outputSR}Hz → ` +
    `${finalAudio.length} samples @ ${finalSR}Hz (${durationSec.toFixed(2)}s), ` +
    `${inferenceMs}ms inference`
  );

  return { audio: finalAudio, sampleRate: finalSR, durationSec, inferenceMs, srAutoDetected };
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

