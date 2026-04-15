/**
 * vcCrepe.ts — Extract fundamental frequency (F0) contour using CREPE-tiny ONNX model.
 *
 * Input:  16 kHz mono Float32Array
 * Output: Array of { time, frequency, confidence } per frame
 *
 * CREPE operates on 1024-sample frames (64ms at 16kHz) with configurable hop.
 */

import {
  ensureVcSession,
  runVcInference,
  type TensorDesc,
} from "./vcInferenceSession";
import { frameAudio } from "./vcResample";

const EXPECTED_SR = 16_000;
const CREPE_FRAME_SIZE = 1024;
const DEFAULT_HOP_MS = 10;
const CREPE_BINS = 360;
const CENTS_PER_BIN = 20;
const FMIN_CENTS = 2051.1488;
const F0_MIN = 50;
const F0_MAX = 1100;

export interface PitchFrame {
  timeSec: number;
  frequencyHz: number;
  confidence: number;
}

export interface CrepeResult {
  frames: PitchFrame[];
  inferenceMs: number;
  meanConfidence: number;
}

function binToFrequency(bin: number): number {
  const cents = FMIN_CENTS + bin * CENTS_PER_BIN;
  return 10 * Math.pow(2, cents / 1200);
}

function decodePitch(probs: Float32Array): { frequency: number; confidence: number } {
  let maxIdx = 0;
  let maxVal = probs[0];
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > maxVal) {
      maxVal = probs[i];
      maxIdx = i;
    }
  }
  const confidence = maxVal;
  let weightedSum = 0;
  let weightTotal = 0;
  const radius = 2;
  for (let i = Math.max(0, maxIdx - radius); i <= Math.min(probs.length - 1, maxIdx + radius); i++) {
    weightedSum += i * probs[i];
    weightTotal += probs[i];
  }
  const refinedBin = weightTotal > 0 ? weightedSum / weightTotal : maxIdx;
  const frequency = binToFrequency(refinedBin);
  return {
    frequency: frequency >= F0_MIN && frequency <= F0_MAX ? frequency : 0,
    confidence,
  };
}

export async function extractPitch(
  samples: Float32Array,
  sampleRate = EXPECTED_SR,
  hopMs = DEFAULT_HOP_MS,
  modelId: "crepe-tiny" | "crepe-full" = "crepe-tiny",
): Promise<CrepeResult> {
  if (sampleRate !== EXPECTED_SR) {
    throw new Error(`CREPE requires ${EXPECTED_SR}Hz input, got ${sampleRate}Hz`);
  }

  const info = await ensureVcSession(modelId);
  const hopSamples = Math.round((hopMs / 1000) * sampleRate);
  const audioFrames = frameAudio(samples, CREPE_FRAME_SIZE, hopSamples);
  if (audioFrames.length === 0) {
    return { frames: [], inferenceMs: 0, meanConfidence: 0 };
  }

  const inputName = info.inputNames[0] ?? "input";
  const startMs = performance.now();
  const pitchFrames: PitchFrame[] = [];

  const BATCH_SIZE = modelId === "crepe-full" ? 16 : 64;
  for (let batchStart = 0; batchStart < audioFrames.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, audioFrames.length);
    const batchLen = batchEnd - batchStart;

    const batchData = new Float32Array(batchLen * CREPE_FRAME_SIZE);
    for (let i = 0; i < batchLen; i++) {
      const frame = audioFrames[batchStart + i];
      let maxAbs = 0;
      for (let j = 0; j < frame.length; j++) {
        const abs = Math.abs(frame[j]);
        if (abs > maxAbs) maxAbs = abs;
      }
      const scale = maxAbs > 1e-6 ? 1 / maxAbs : 1;
      for (let j = 0; j < frame.length; j++) {
        batchData[i * CREPE_FRAME_SIZE + j] = frame[j] * scale;
      }
    }

    const feeds: Record<string, TensorDesc> = {
      [inputName]: { data: batchData, dims: [batchLen, CREPE_FRAME_SIZE], dtype: "float32" },
    };

    const results = await runVcInference(modelId, feeds);
    const outputName = info.outputNames[0] ?? "output";
    const output = results[outputName];
    if (!output) throw new Error(`CREPE: no output. Available: ${Object.keys(results).join(", ")}`);

    const data = output.data as Float32Array;
    for (let i = 0; i < batchLen; i++) {
      const frameIdx = batchStart + i;
      const probs = data.slice(i * CREPE_BINS, (i + 1) * CREPE_BINS);
      const { frequency, confidence } = decodePitch(probs);
      pitchFrames.push({
        timeSec: (frameIdx * hopSamples) / sampleRate,
        frequencyHz: confidence > 0.15 ? frequency : 0,
        confidence,
      });
    }
  }

  const inferenceMs = Math.round(performance.now() - startMs);
  const meanConfidence = pitchFrames.length > 0
    ? pitchFrames.reduce((s, f) => s + f.confidence, 0) / pitchFrames.length
    : 0;

  console.info(
    `[CREPE] ${samples.length} samples → ${pitchFrames.length} frames, ` +
    `meanConf=${meanConfidence.toFixed(2)}, ${inferenceMs}ms`
  );

  return { frames: pitchFrames, inferenceMs, meanConfidence };
}
