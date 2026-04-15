/**
 * vcContentVec.ts — Extract speaker-independent phonetic embeddings
 * using ContentVec (HuBERT-based) ONNX model.
 *
 * Input:  16 kHz mono Float32Array
 * Output: Float32Array of shape [T, 768] — one embedding per ~20ms frame
 */

import * as ort from "onnxruntime-web";
import {
  createVcSession,
  validateInferenceOutput,
  WebGPUCorruptError,
  releaseVcSession,
  getSessionBackend,
  setForcedBackend,
} from "./vcInferenceSession";
import { disposeOrtResults, disposeOrtTensor } from "./ortCleanup";

/** ContentVec expects 16 kHz input */
const EXPECTED_SR = 16_000;

/** ContentVec output embedding dimension (HuBERT base layer 12) */
export const CONTENTVEC_DIM = 768;

export interface ContentVecResult {
  /** Embeddings tensor — shape [numFrames, 768] */
  embeddings: Float32Array;
  /** Number of time frames */
  numFrames: number;
  /** Embedding dimension (768) */
  dim: number;
  /** Inference time in ms */
  inferenceMs: number;
}

/**
 * Run ContentVec on 16 kHz mono audio.
 * Model must be pre-downloaded to OPFS via vcModelCache.
 */
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
    if (err instanceof WebGPUCorruptError && getSessionBackend("contentvec") === "webgpu") {
      // GPU corruption likely caused by VRAM pressure — release session and retry on GPU
      console.warn(`[ContentVec] WebGPU output corrupted — releasing session & retrying on GPU`);
      await releaseVcSession("contentvec");
      try {
        return await _runContentVec(samples);
      } catch (retryErr) {
        // Second GPU failure — throw with diagnostic, do NOT silently switch to WASM
        console.error(`[ContentVec] GPU retry failed. VRAM may be exhausted. User should free GPU memory or switch backend manually.`);
        throw retryErr;
      }
    }
    throw err;
  }
}

async function _runContentVec(samples: Float32Array): Promise<ContentVecResult> {
  const session = await createVcSession("contentvec");

  // ContentVec768 (vec-768-layer-12) expects [batch, channels, sequence] = [1, 1, T]
  const inputTensor = new ort.Tensor("float32", samples, [1, 1, samples.length]);

  const startMs = performance.now();
  const feeds: Record<string, ort.Tensor> = {};
  
  const inputNames = session.inputNames;
  // Map known inputs: "source" (audio) and "padding_mask" (all-false = no padding)
  for (const name of inputNames) {
    const key = name.toLowerCase();
    if (key === "source" || key === "input" || key === "audio") {
      feeds[name] = inputTensor;
    } else if (key === "padding_mask" || key === "attention_mask") {
      // padding_mask: BoolTensor [1, T] — false means "not padded" (i.e. valid)
      const mask = new Float32Array(samples.length).fill(0); // 0 = not padded
      feeds[name] = new ort.Tensor("bool", new Uint8Array(mask.length), [1, samples.length]);
    }
  }
  // Fallback: if no names matched, use positional
  if (Object.keys(feeds).length === 0) {
    feeds[inputNames[0] ?? "source"] = inputTensor;
  }

  let results: Record<string, ort.Tensor> | undefined;
  try {
    results = await session.run(feeds);
    const inferenceMs = Math.round(performance.now() - startMs);

    const outputNames = session.outputNames;
    const outputName = outputNames[0] ?? "embed";
    const output = results[outputName];

    if (!output) {
      throw new Error(
        `ContentVec: no output tensor. Available: ${Object.keys(results).join(", ")}`
      );
    }

    const data = output.data as Float32Array;
    const shape = output.dims as readonly number[];
    
    // Shape is typically [1, T, 768] or [T, 768]
    const numFrames = shape.length === 3 ? shape[1] : shape[0];
    const dim = shape[shape.length - 1];

    // Validate output — detect WebGPU corruption (all zeros, NaN, etc.)
    validateInferenceOutput(data, "contentvec", "embeddings");

    console.info(
      `[ContentVec] ${samples.length} samples → ${numFrames} frames × ${dim}D, ${inferenceMs}ms`
    );

    return {
      embeddings: new Float32Array(data),
      numFrames,
      dim,
      inferenceMs,
    };
  } finally {
    // Dispose input tensors
    for (const t of Object.values(feeds)) disposeOrtTensor(t);
    // Dispose output tensors
    disposeOrtResults(results);
  }
}
