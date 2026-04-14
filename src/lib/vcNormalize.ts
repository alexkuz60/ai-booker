/**
 * vcNormalize.ts — RMS normalization for Voice Conversion pipeline.
 *
 * RMS-normalizes input audio to a target loudness level (-20 dBFS)
 * with a soft ceiling limiter at -1 dBFS to prevent clipping.
 * This provides consistent loudness matching the RVC training data,
 * which is more stable than simple peak normalization.
 */

/** Default target RMS in dBFS — typical for RVC training data */
const DEFAULT_TARGET_RMS_DB = -20;

/** Ceiling in linear — soft limiter threshold to prevent clipping */
const CEILING_LINEAR = 0.891; // ≈ -1 dBFS

/** Convert linear amplitude to dBFS */
function linearToDb(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-10));
}

/** Compute RMS of audio buffer (for diagnostics only) */
function computeRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/** Compute peak amplitude */
function computePeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

export interface NormalizeResult {
  /** Normalized samples */
  samples: Float32Array;
  /** Applied gain in dB */
  gainDb: number;
  /** Input RMS in dBFS (diagnostic) */
  inputRmsDb: number;
  /** Output RMS in dBFS (diagnostic) */
  outputRmsDb: number;
  /** Input peak in dBFS */
  inputPeakDb: number;
  /** Whether soft limiter was applied */
  limited: boolean;
  /** Processing time in ms */
  normalizeMs: number;
}

/**
 * RMS-normalize audio to a target loudness level.
 *
 * Scales audio so its RMS matches the target (default -20 dBFS),
 * then applies a soft tanh limiter to prevent clipping above -1 dBFS.
 * This provides consistent loudness across different TTS providers
 * and matches typical RVC training data normalization.
 *
 * @param samples - Input audio samples (mono, any sample rate)
 * @param targetRmsDb - Target RMS level in dBFS (default -20)
 * @returns Normalized audio with metadata
 */
export function normalizeRms(
  samples: Float32Array,
  targetRmsDb = DEFAULT_TARGET_RMS_DB,
): NormalizeResult {
  const t0 = performance.now();

  const inputPeak = computePeak(samples);
  const inputPeakDb = linearToDb(inputPeak);
  const inputRms = computeRms(samples);
  const inputRmsDb = linearToDb(inputRms);

  // Skip normalization for silence
  if (inputPeak < 1e-8) {
    console.info(`[vcNormalize] Input is silence, skipping`);
    return {
      samples,
      gainDb: 0,
      inputRmsDb: -Infinity,
      outputRmsDb: -Infinity,
      inputPeakDb: -Infinity,
      limited: false,
      normalizeMs: Math.round(performance.now() - t0),
    };
  }

  // RMS-normalize: scale so RMS matches target
  const targetRmsLinear = Math.pow(10, targetRmsDb / 20);
  const gain = inputRms > 1e-10 ? targetRmsLinear / inputRms : 1;
  const gainDb = linearToDb(gain);

  const output = new Float32Array(samples.length);
  let limited = false;

  for (let i = 0; i < samples.length; i++) {
    let s = samples[i] * gain;
    // Soft tanh limiter above ceiling
    if (Math.abs(s) > CEILING_LINEAR) {
      limited = true;
      s = Math.sign(s) * (CEILING_LINEAR + (1 - CEILING_LINEAR) * Math.tanh((Math.abs(s) - CEILING_LINEAR) / (1 - CEILING_LINEAR)));
    }
    output[i] = s;
  }

  const outputRms = computeRms(output);
  const outputRmsDb = linearToDb(outputRms);
  const outputPeak = computePeak(output);
  const outputPeakDb = linearToDb(outputPeak);
  const normalizeMs = Math.round(performance.now() - t0);

  console.info(
    `[vcNormalize] RMS-norm: target ${targetRmsDb} dBFS, ` +
    `(gain ${gainDb > 0 ? "+" : ""}${gainDb.toFixed(1)} dB), ` +
    `RMS ${inputRmsDb.toFixed(1)} → ${outputRmsDb.toFixed(1)} dBFS, ` +
    `peak ${inputPeakDb.toFixed(1)} → ${outputPeakDb.toFixed(1)} dBFS` +
    `${limited ? " [LIMITED]" : ""}, ${normalizeMs}ms`
  );

  return { samples: output, gainDb, inputRmsDb, outputRmsDb, inputPeakDb, limited, normalizeMs };
}
