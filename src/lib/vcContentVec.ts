/**
 * vcContentVec.ts — Extract speaker-independent phonetic embeddings
 * using ContentVec (HuBERT-based) ONNX model.
 *
 * Input:  16 kHz mono Float32Array
 * Output: Float32Array of shape [T, 768] — one embedding per ~20ms frame
 */

import * as ort from "onnxruntime-web";
import { createVcSession } from "./vcInferenceSession";

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

  const session = await createVcSession("contentvec");

  // HuBERT ONNX exports typically use [batch, sequence] = [1, T]
  const inputTensor = new ort.Tensor("float32", samples, [1, samples.length]);

  const startMs = performance.now();
  const feeds: Record<string, ort.Tensor> = {};
  
  const inputNames = session.inputNames;
  const inputName = inputNames[0] ?? "source";
  feeds[inputName] = inputTensor;

  const results = await session.run(feeds);
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

  console.info(
    `[ContentVec] ${samples.length} samples → ${numFrames} frames × ${dim}D, ${inferenceMs}ms`
  );

  return {
    embeddings: new Float32Array(data),
    numFrames,
    dim,
    inferenceMs,
  };
}
