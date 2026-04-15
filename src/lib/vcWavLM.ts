/**
 * vcWavLM.ts — Extract speaker-independent speech features
 * using WavLM-Base-Plus ONNX model.
 *
 * Drop-in replacement for ContentVec (vcContentVec.ts).
 * Input:  16 kHz mono Float32Array
 * Output: Float32Array of shape [T, 768] — same interface as ContentVec
 */

import * as ort from "onnxruntime-web";
import { createVcSession } from "./vcInferenceSession";
import type { ContentVecResult } from "./vcContentVec";

/** WavLM expects 16 kHz input */
const EXPECTED_SR = 16_000;

/** WavLM-Base-Plus embedding dimension */
export const WAVLM_DIM = 768;

/**
 * Run WavLM-Base-Plus on 16 kHz mono audio.
 * Model must be pre-downloaded to OPFS via vcModelCache.
 *
 * Returns same ContentVecResult interface for pipeline compatibility.
 */
export async function extractWavLM(
  samples: Float32Array,
  sampleRate = EXPECTED_SR,
): Promise<ContentVecResult> {
  if (sampleRate !== EXPECTED_SR) {
    throw new Error(`WavLM requires ${EXPECTED_SR}Hz input, got ${sampleRate}Hz`);
  }

  const session = await createVcSession("wavlm");

  // WavLM ONNX (Xenova/Transformers.js) uses input_values [1, T]
  const inputTensor = new ort.Tensor("float32", samples, [1, samples.length]);

  const startMs = performance.now();
  const feeds: Record<string, ort.Tensor> = {};

  const inputNames = session.inputNames;
  console.info(`[WavLM] Model inputs: [${inputNames.join(", ")}], outputs: [${session.outputNames.join(", ")}]`);

  // WavLM (Xenova/Transformers.js) uses "input_values" [1, T] — rank 2
  // Do NOT match "source" — that's ContentVec's input name with rank 3
  for (const name of inputNames) {
    const key = name.toLowerCase();
    if (key === "input_values" || key === "input" || key === "audio") {
      feeds[name] = inputTensor;
    } else if (key === "source") {
      // Some WavLM exports may use "source" but expect rank 2
      feeds[name] = inputTensor;
    } else if (key === "attention_mask" || key === "padding_mask") {
      // Attention mask: all 1s (all tokens are valid)
      const mask = new BigInt64Array(samples.length).fill(1n);
      feeds[name] = new ort.Tensor("int64", mask, [1, samples.length]);
    }
  }
  // Fallback: if no names matched, use positional
  if (Object.keys(feeds).length === 0) {
    feeds[inputNames[0] ?? "input_values"] = inputTensor;
  }

  const results = await session.run(feeds);
  const inferenceMs = Math.round(performance.now() - startMs);

  const outputNames = session.outputNames;
  // WavLM typically outputs "last_hidden_state" or first output
  const outputName =
    outputNames.find(n => n.toLowerCase().includes("hidden_state")) ??
    outputNames.find(n => n.toLowerCase().includes("output")) ??
    outputNames[0] ?? "last_hidden_state";
  const output = results[outputName];

  if (!output) {
    throw new Error(
      `WavLM: no output tensor "${outputName}". Available: ${Object.keys(results).join(", ")}`
    );
  }

  const data = output.data as Float32Array;
  const shape = output.dims as readonly number[];

  // Shape is typically [1, T, 768] or [T, 768]
  const numFrames = shape.length === 3 ? shape[1] : shape[0];
  const dim = shape[shape.length - 1];

  console.info(
    `[WavLM] ${samples.length} samples → ${numFrames} frames × ${dim}D, ${inferenceMs}ms`
  );

  return {
    embeddings: new Float32Array(data),
    numFrames,
    dim,
    inferenceMs,
  };
}
