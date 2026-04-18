/**
 * vcContentVec.ts — Extract speaker-independent phonetic embeddings
 * using ContentVec (HuBERT-based) ONNX model.
 *
 * Input:  16 kHz mono Float32Array
 * Output: Float32Array of shape [T, 768] — one embedding per ~20ms frame
 */

import {
  ensureVcSession,
  runVcInference,
  validateInferenceOutput,
  WebGPUCorruptError,
  releaseVcSession,
  getSessionBackend,
  type TensorDesc,
} from "./vcInferenceSession";

/** ContentVec expects 16 kHz input */
const EXPECTED_SR = 16_000;

/** ContentVec output embedding dimension (HuBERT base layer 12) */
export const CONTENTVEC_DIM = 768;

export interface ContentVecResult {
  embeddings: Float32Array;
  numFrames: number;
  dim: number;
  inferenceMs: number;
}

/**
 * Cached input rank for the active ContentVec model.
 * Different ContentVec ONNX exports expect different input ranks:
 *   - rank 2: [batch, samples]              — most common
 *   - rank 3: [batch, channels, samples]    — some exports (e.g. with explicit channel dim)
 * We auto-detect on first failure and remember for subsequent calls.
 */
let contentVecInputRank: 2 | 3 | null = null;

function isInvalidRankError(err: unknown): { expected: 2 | 3 } | null {
  const msg = err instanceof Error ? err.message : String(err);
  // ORT message: "Invalid rank for input: source Got: 2 Expected: 3"
  const m = /Invalid rank for input.*Got:\s*(\d+)\s*Expected:\s*(\d+)/i.exec(msg);
  if (!m) return null;
  const expected = Number(m[2]);
  if (expected === 2 || expected === 3) return { expected };
  return null;
}

export async function extractContentVec(
  samples: Float32Array,
  sampleRate = EXPECTED_SR,
): Promise<ContentVecResult> {
  if (sampleRate !== EXPECTED_SR) {
    throw new Error(`ContentVec requires ${EXPECTED_SR}Hz input, got ${sampleRate}Hz`);
  }

  try {
    return await _runContentVec(samples);
  } catch (err) {
    // Auto-detect required input rank and retry once
    const rankInfo = isInvalidRankError(err);
    if (rankInfo && contentVecInputRank !== rankInfo.expected) {
      console.warn(`[ContentVec] Model expects rank ${rankInfo.expected} input — switching and retrying`);
      contentVecInputRank = rankInfo.expected;
      return await _runContentVec(samples);
    }
    if (err instanceof WebGPUCorruptError && getSessionBackend("contentvec") === "webgpu") {
      console.warn(`[ContentVec] WebGPU output corrupted — releasing session & retrying on GPU`);
      await releaseVcSession("contentvec");
      try {
        return await _runContentVec(samples);
      } catch (retryErr) {
        console.error(`[ContentVec] GPU retry failed. VRAM may be exhausted.`);
        throw retryErr;
      }
    }
    throw err;
  }
}

async function _runContentVec(samples: Float32Array): Promise<ContentVecResult> {
  const info = await ensureVcSession("contentvec");

  const startMs = performance.now();
  const feeds: Record<string, TensorDesc> = {};

  for (const name of info.inputNames) {
    const key = name.toLowerCase();
    if (key === "source" || key === "input" || key === "audio") {
      // ContentVec expects [batch, samples] (rank 2), not [batch, channels, samples]
      feeds[name] = { data: new Float32Array(samples), dims: [1, samples.length], dtype: "float32" };
    } else if (key === "padding_mask" || key === "attention_mask") {
      const mask = new Uint8Array(samples.length);
      mask.fill(1); // 1 = attend to all positions; 0 = ignore
      feeds[name] = { data: mask, dims: [1, samples.length], dtype: "bool" };
    }
  }
  if (Object.keys(feeds).length === 0) {
    feeds[info.inputNames[0] ?? "source"] = { data: new Float32Array(samples), dims: [1, samples.length], dtype: "float32" };
  }

  const results = await runVcInference("contentvec", feeds);
  const inferenceMs = Math.round(performance.now() - startMs);

  const outputName = info.outputNames[0] ?? "embed";
  const output = results[outputName];
  if (!output) {
    throw new Error(`ContentVec: no output tensor. Available: ${Object.keys(results).join(", ")}`);
  }

  const data = output.data as Float32Array;
  const shape = output.dims;
  const numFrames = shape.length === 3 ? shape[1] : shape[0];
  const dim = shape[shape.length - 1];

  validateInferenceOutput(data, "contentvec", "embeddings");

  console.info(`[ContentVec] ${samples.length} samples → ${numFrames} frames × ${dim}D, ${inferenceMs}ms`);

  return { embeddings: new Float32Array(data), numFrames, dim, inferenceMs };
}
