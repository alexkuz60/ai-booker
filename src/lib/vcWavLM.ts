/**
 * vcWavLM.ts — Extract speaker-independent speech features
 * using WavLM-Base-Plus ONNX model.
 *
 * Drop-in replacement for ContentVec (vcContentVec.ts).
 * Input:  16 kHz mono Float32Array
 * Output: Float32Array of shape [T, 768] — same interface as ContentVec
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
import type { ContentVecResult } from "./vcContentVec";

const EXPECTED_SR = 16_000;
export const WAVLM_DIM = 768;

export async function extractWavLM(
  samples: Float32Array,
  sampleRate = EXPECTED_SR,
): Promise<ContentVecResult> {
  if (sampleRate !== EXPECTED_SR) {
    throw new Error(`WavLM requires ${EXPECTED_SR}Hz input, got ${sampleRate}Hz`);
  }

  try {
    return await _runWavLM(samples);
  } catch (err) {
    if (err instanceof WebGPUCorruptError && getSessionBackend("wavlm") === "webgpu") {
      console.warn(`[WavLM] WebGPU output corrupted — releasing session & retrying on GPU`);
      await releaseVcSession("wavlm");
      try {
        return await _runWavLM(samples);
      } catch (retryErr) {
        console.error(`[WavLM] GPU retry failed. VRAM may be exhausted.`);
        throw retryErr;
      }
    }
    throw err;
  }
}

async function _runWavLM(samples: Float32Array): Promise<ContentVecResult> {
  const info = await ensureVcSession("wavlm");

  const startMs = performance.now();
  const feeds: Record<string, TensorDesc> = {};

  console.info(`[WavLM] Model inputs: [${info.inputNames.join(", ")}], outputs: [${info.outputNames.join(", ")}]`);

  for (const name of info.inputNames) {
    const key = name.toLowerCase();
    if (key === "input_values" || key === "input" || key === "audio" || key === "source") {
      feeds[name] = { data: new Float32Array(samples), dims: [1, samples.length], dtype: "float32" };
    } else if (key === "attention_mask" || key === "padding_mask") {
      const mask = new BigInt64Array(samples.length).fill(1n);
      feeds[name] = { data: mask, dims: [1, samples.length], dtype: "int64" };
    }
  }
  if (Object.keys(feeds).length === 0) {
    feeds[info.inputNames[0] ?? "input_values"] = { data: new Float32Array(samples), dims: [1, samples.length], dtype: "float32" };
  }

  const results = await runVcInference("wavlm", feeds);
  const inferenceMs = Math.round(performance.now() - startMs);

  const outputName =
    info.outputNames.find(n => n.toLowerCase().includes("hidden_state")) ??
    info.outputNames.find(n => n.toLowerCase().includes("output")) ??
    info.outputNames[0] ?? "last_hidden_state";
  const output = results[outputName];

  if (!output) {
    throw new Error(`WavLM: no output tensor "${outputName}". Available: ${Object.keys(results).join(", ")}`);
  }

  const data = output.data as Float32Array;
  const shape = output.dims;
  const numFrames = shape.length === 3 ? shape[1] : shape[0];
  const dim = shape[shape.length - 1];

  validateInferenceOutput(data, "wavlm", "embeddings");

  console.info(`[WavLM] ${samples.length} samples → ${numFrames} frames × ${dim}D, ${inferenceMs}ms`);

  return { embeddings: new Float32Array(data), numFrames, dim, inferenceMs };
}
