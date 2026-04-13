/**
 * vcSwiftF0.ts — Extract fundamental frequency (F0) using SwiftF0 ONNX model.
 *
 * SwiftF0 — ultra-lightweight pitch detector (~96K params, ~398 KB ONNX).
 * 42× faster than CREPE on CPU with 91.8% accuracy in noisy conditions.
 *
 * Input:  raw 16 kHz mono Float32Array [1, N]
 * Output: pitch_hz [1, T] + confidence [1, T]
 *
 * Parameters: SR=16000, hop=256, frame=1024, fmin=46.875, fmax=2093.75
 * Reference: https://github.com/lars76/swift-f0
 */

import * as ort from "onnxruntime-web";
import { createVcSession } from "./vcInferenceSession";
import type { PitchFrame, CrepeResult } from "./vcCrepe";

const EXPECTED_SR = 16_000;
const HOP_LENGTH = 256;
const MIN_AUDIO_LENGTH = 256;
const CENTER_OFFSET = (1024 - 1) / 2 - (1024 - 256) / 2; // 127.5

/**
 * Run SwiftF0 on 16 kHz mono audio.
 * Model must be pre-downloaded to OPFS via vcModelCache.
 *
 * SwiftF0 takes raw waveform input [1, N] and outputs:
 *   - pitch_hz [1, T] — estimated F0 in Hz per frame
 *   - confidence [1, T] — voicing confidence 0..1
 */
export async function extractPitchSwiftF0(
  samples: Float32Array,
  sampleRate = EXPECTED_SR,
): Promise<CrepeResult> {
  if (sampleRate !== EXPECTED_SR) {
    throw new Error(`SwiftF0 requires ${EXPECTED_SR}Hz input, got ${sampleRate}Hz`);
  }

  const startMs = performance.now();

  // Pad to minimum length if needed
  let audio = samples;
  if (audio.length < MIN_AUDIO_LENGTH) {
    const padded = new Float32Array(MIN_AUDIO_LENGTH);
    padded.set(audio);
    audio = padded;
  }

  // Create session and run inference
  const session = await createVcSession("swiftf0");
  const inputName = session.inputNames[0] ?? "input";

  // SwiftF0 expects [1, N] raw waveform
  const tensor = new ort.Tensor("float32", audio, [1, audio.length]);
  const results = await session.run({ [inputName]: tensor });

  // SwiftF0 outputs two tensors: pitch_hz and confidence
  const outputNames = session.outputNames;
  if (outputNames.length < 2) {
    throw new Error(`SwiftF0: expected 2 outputs, got ${outputNames.length}: ${outputNames.join(", ")}`);
  }

  const pitchData = results[outputNames[0]]?.data as Float32Array;
  const confData = results[outputNames[1]]?.data as Float32Array;

  if (!pitchData || !confData) {
    throw new Error(`SwiftF0: missing output data. Available: ${Object.keys(results).join(", ")}`);
  }

  const numFrames = pitchData.length;
  const pitchFrames: PitchFrame[] = [];

  for (let i = 0; i < numFrames; i++) {
    const timeSec = (i * HOP_LENGTH + CENTER_OFFSET) / sampleRate;
    const hz = pitchData[i];
    const conf = confData[i];

    pitchFrames.push({
      timeSec,
      frequencyHz: conf > 0.5 ? hz : 0, // voicing threshold
      confidence: conf,
    });
  }

  const inferenceMs = Math.round(performance.now() - startMs);
  const meanConfidence = pitchFrames.length > 0
    ? pitchFrames.reduce((s, f) => s + f.confidence, 0) / pitchFrames.length
    : 0;

  console.info(
    `[SwiftF0] ${samples.length} samples → ${pitchFrames.length} frames, ` +
    `meanConf=${meanConfidence.toFixed(2)}, ${inferenceMs}ms`
  );

  return { frames: pitchFrames, inferenceMs, meanConfidence };
}
