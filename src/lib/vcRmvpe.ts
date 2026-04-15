/**
 * vcRmvpe.ts — Extract fundamental frequency (F0) using RMVPE ONNX model.
 *
 * RMVPE = Robust Model for Voice Pitch Estimation
 * Input:  16 kHz mono Float32Array → mel spectrogram
 * Output: F0 contour (Hz per frame)
 *
 * Mel spectrogram params: SR=16000, n_fft=1024, hop=160, n_mels=128
 */

import * as ort from "onnxruntime-web";
import { createVcSession, validateInferenceOutput } from "./vcInferenceSession";
import { disposeOrtResults, disposeOrtTensor } from "./ortCleanup";
import type { PitchFrame, CrepeResult } from "./vcCrepe";

const EXPECTED_SR = 16_000;
const N_FFT = 1024;
const HOP_LENGTH = 160;
const N_MELS = 128;
const F0_MIN = 30;
const F0_MAX = 1100;
const CONFIDENCE_THRESHOLD = 0.03;

// ─── Mel Spectrogram Computation ─────────────────────────────────────────

/** Precompute mel filterbank matrix [n_mels, n_fft/2 + 1] */
function createMelFilterbank(sr: number, nFft: number, nMels: number, fMin = 0, fMax?: number): Float32Array[] {
  const fMaxVal = fMax ?? sr / 2;
  const nBins = Math.floor(nFft / 2) + 1;

  const hzToMel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const melToHz = (m: number) => 700 * (Math.pow(10, m / 2595) - 1);

  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMaxVal);

  // nMels + 2 points evenly spaced in mel
  const melPoints = new Float32Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) {
    melPoints[i] = melMin + (i / (nMels + 1)) * (melMax - melMin);
  }

  // Convert back to Hz then to FFT bin indices
  const binFreqs = new Float32Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) {
    binFreqs[i] = Math.floor((nFft + 1) * melToHz(melPoints[i]) / sr);
  }

  const filters: Float32Array[] = [];
  for (let m = 0; m < nMels; m++) {
    const row = new Float32Array(nBins);
    const lo = binFreqs[m];
    const mid = binFreqs[m + 1];
    const hi = binFreqs[m + 2];

    for (let k = 0; k < nBins; k++) {
      if (k >= lo && k <= mid && mid > lo) {
        row[k] = (k - lo) / (mid - lo);
      } else if (k >= mid && k <= hi && hi > mid) {
        row[k] = (hi - k) / (hi - mid);
      }
    }
    filters.push(row);
  }
  return filters;
}

/** Compute STFT magnitude squared for one frame */
function stftFrame(samples: Float32Array, center: number, nFft: number): Float32Array {
  const halfN = nFft / 2;
  const nBins = halfN + 1;
  const real = new Float32Array(nBins);
  const imag = new Float32Array(nBins);

  // Hann window + DFT
  for (let k = 0; k < nBins; k++) {
    let re = 0, im = 0;
    const freq = (2 * Math.PI * k) / nFft;
    for (let n = 0; n < nFft; n++) {
      const idx = center - halfN + n;
      const s = idx >= 0 && idx < samples.length ? samples[idx] : 0;
      // Hann window
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / nFft));
      const val = s * w;
      re += val * Math.cos(freq * n);
      im -= val * Math.sin(freq * n);
    }
    real[k] = re;
    imag[k] = im;
  }

  // Power spectrum
  const power = new Float32Array(nBins);
  for (let k = 0; k < nBins; k++) {
    power[k] = real[k] * real[k] + imag[k] * imag[k];
  }
  return power;
}

/**
 * Compute log mel spectrogram.
 * Returns [numFrames, N_MELS] flattened Float32Array + numFrames.
 */
function computeMelSpectrogram(
  samples: Float32Array,
  sr: number,
  nFft: number,
  hopLength: number,
  nMels: number,
): { data: Float32Array; numFrames: number; paddedFrames: number } {
  const filterbank = createMelFilterbank(sr, nFft, nMels);
  const nBins = Math.floor(nFft / 2) + 1;
  const numFrames = Math.floor((samples.length - nFft) / hopLength) + 1;

  if (numFrames <= 0) {
    return { data: new Float32Array(0), numFrames: 0, paddedFrames: 0 };
  }

  // RMVPE U-Net has multiple down/up-sampling stages (typically 5).
  // Frame count must be a multiple of 2^5 = 32 to avoid dimension mismatches
  // in skip connections (e.g. 31 vs 30 after floor-division rounding).
  const PAD_MULTIPLE = 32;
  const paddedFrames = Math.ceil(numFrames / PAD_MULTIPLE) * PAD_MULTIPLE;

  const melData = new Float32Array(paddedFrames * nMels);

  for (let t = 0; t < numFrames; t++) {
    const center = t * hopLength + Math.floor(nFft / 2);
    const power = stftFrame(samples, center, nFft);

    for (let m = 0; m < nMels; m++) {
      let sum = 0;
      const filter = filterbank[m];
      for (let k = 0; k < nBins; k++) {
        sum += power[k] * filter[k];
      }
      // Log mel (clamp to avoid log(0))
      melData[t * nMels + m] = Math.log(Math.max(sum, 1e-10));
    }
  }
  // Padding frames (numFrames..paddedFrames) remain zero-filled

  return { data: melData, numFrames, paddedFrames };
}

// ─── RMVPE F0 Decoding ──────────────────────────────────────────────────

/**
 * Decode RMVPE output probabilities to F0 in Hz.
 * RMVPE outputs probability per pitch bin (360 bins, 20 cents per bin, starting at ~C1).
 */
function decodeRmvpeF0(probs: Float32Array, nBins: number): { frequency: number; confidence: number } {
  // Find peak
  let maxIdx = 0;
  let maxVal = probs[0];
  for (let i = 1; i < nBins; i++) {
    if (probs[i] > maxVal) {
      maxVal = probs[i];
      maxIdx = i;
    }
  }

  if (maxVal < CONFIDENCE_THRESHOLD) {
    return { frequency: 0, confidence: maxVal };
  }

  // Weighted average around peak for sub-bin precision
  let weightedSum = 0;
  let weightTotal = 0;
  const radius = 4;
  for (let i = Math.max(0, maxIdx - radius); i <= Math.min(nBins - 1, maxIdx + radius); i++) {
    if (probs[i] > CONFIDENCE_THRESHOLD) {
      weightedSum += i * probs[i];
      weightTotal += probs[i];
    }
  }
  const refinedBin = weightTotal > 0 ? weightedSum / weightTotal : maxIdx;

  // Convert bin to Hz: RMVPE uses cent scale starting from ~32.7 Hz (C1)
  const FMIN_CENTS = 1997.3794; // 12 * 100 * log2(32.70)
  const CENTS_PER_BIN = 20;
  const cents = FMIN_CENTS + refinedBin * CENTS_PER_BIN;
  const frequency = 10 * Math.pow(2, cents / 1200);

  return {
    frequency: frequency >= F0_MIN && frequency <= F0_MAX ? frequency : 0,
    confidence: maxVal,
  };
}

// ─── Main Extraction ────────────────────────────────────────────────────

/**
 * Run RMVPE on 16 kHz mono audio.
 * Model must be pre-downloaded to OPFS via vcModelCache.
 */
export async function extractPitchRmvpe(
  samples: Float32Array,
  sampleRate = EXPECTED_SR,
): Promise<CrepeResult> {
  if (sampleRate !== EXPECTED_SR) {
    throw new Error(`RMVPE requires ${EXPECTED_SR}Hz input, got ${sampleRate}Hz`);
  }

  const startMs = performance.now();

  // Step 1: Compute mel spectrogram
  const mel = computeMelSpectrogram(samples, sampleRate, N_FFT, HOP_LENGTH, N_MELS);
  if (mel.numFrames === 0) {
    return { frames: [], inferenceMs: 0, meanConfidence: 0 };
  }

  const melMs = Math.round(performance.now() - startMs);
  console.info(`[RMVPE] Mel spectrogram: ${mel.numFrames} frames (padded to ${mel.paddedFrames}) in ${melMs}ms`);

  // Step 2: Run RMVPE inference
  const session = await createVcSession("rmvpe");
  const inputName = session.inputNames[0] ?? "input";

  // RMVPE expects [1, n_mels, n_frames] or [1, 1, n_mels, n_frames]
  // Try [1, 1, n_frames, n_mels] first (common ONNX layout)
  // Transpose mel data from [frames, mels] to [mels, frames] for model input
  const transposed = new Float32Array(mel.paddedFrames * N_MELS);
  for (let t = 0; t < mel.paddedFrames; t++) {
    for (let m = 0; m < N_MELS; m++) {
      transposed[m * mel.paddedFrames + t] = mel.data[t * N_MELS + m];
    }
  }

  const tensor = new ort.Tensor("float32", transposed, [1, N_MELS, mel.paddedFrames]);
  let results: Record<string, ort.Tensor> | undefined;
  try {
    results = await session.run({ [inputName]: tensor });

    const outputName = session.outputNames[0] ?? "output";
    const output = results[outputName];
    if (!output) throw new Error(`RMVPE: no output. Available: ${Object.keys(results).join(", ")}`);

    const data = output.data as Float32Array;
    validateInferenceOutput(data, "rmvpe", "pitch probabilities");
    const outputShape = Array.from(output.dims, Number).filter(d => d > 1);

    // RMVPE exports are commonly either [1, T, 360] or [1, 360, T].
    let nPitchBins = 360;
    let rawFrameCount = Math.floor(data.length / nPitchBins);
    let layout: "frame-major" | "bin-major" = "frame-major";

    if (outputShape.length >= 2) {
      const a = outputShape[outputShape.length - 2];
      const b = outputShape[outputShape.length - 1];
      if (b === 360) {
        rawFrameCount = a;
        nPitchBins = b;
        layout = "frame-major";
      } else if (a === 360) {
        rawFrameCount = b;
        nPitchBins = a;
        layout = "bin-major";
      }
    }

    const nOutputFrames = Math.min(rawFrameCount, mel.numFrames);

    const pitchFrames: PitchFrame[] = [];
    const frameDurationSec = HOP_LENGTH / sampleRate;

    for (let i = 0; i < nOutputFrames; i++) {
      const probs = new Float32Array(nPitchBins);
      if (layout === "frame-major") {
        probs.set(data.subarray(i * nPitchBins, (i + 1) * nPitchBins));
      } else {
        for (let bin = 0; bin < nPitchBins; bin++) {
          probs[bin] = data[bin * rawFrameCount + i];
        }
      }
      const { frequency, confidence } = decodeRmvpeF0(probs, nPitchBins);
      pitchFrames.push({
        timeSec: i * frameDurationSec,
        frequencyHz: frequency,
        confidence,
      });
    }

    const inferenceMs = Math.round(performance.now() - startMs);
    const meanConfidence = pitchFrames.length > 0
      ? pitchFrames.reduce((s, f) => s + f.confidence, 0) / pitchFrames.length
      : 0;

    console.info(
      `[RMVPE] ${samples.length} samples → ${pitchFrames.length} frames, ` +
      `meanConf=${meanConfidence.toFixed(2)}, ${inferenceMs}ms (mel ${melMs}ms, layout=${layout}, shape=[${outputShape.join(", ")}])`
    );

    return { frames: pitchFrames, inferenceMs, meanConfidence };
  } finally {
    disposeOrtTensor(tensor);
    disposeOrtResults(results);
  }
}
