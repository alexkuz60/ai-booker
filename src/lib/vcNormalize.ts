/**
 * vcNormalize.ts — Peak normalization for Voice Conversion pipeline.
 *
 * Peak-normalizes input audio to [-1.0, 1.0] before feeding into
 * speech encoders (ContentVec/WavLM), matching librosa.load() behavior
 * which is the standard input normalization for RVC models.
 */

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
  /** Always false for peak-normalize (no limiter needed) */
  limited: boolean;
  /** Processing time in ms */
  normalizeMs: number;
}

/**
 * Peak-normalize audio to [-1.0, 1.0].
 *
 * Matches librosa.load() behavior — the standard input normalization
 * for RVC/ContentVec/WavLM models. Simple linear scaling by 1/peak.
 *
 * @param samples - Input audio samples (mono, any sample rate)
 * @param _targetDb - Ignored (kept for API compatibility)
 * @returns Normalized audio with metadata
 */
export function normalizeRms(
  samples: Float32Array,
  _targetDb?: number,
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

  // Peak-normalize: scale so max(abs) = 1.0
  const gain = 1.0 / inputPeak;
  const gainDb = linearToDb(gain);

  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i] * gain;
  }

  const outputRms = computeRms(output);
  const outputRmsDb = linearToDb(outputRms);
  const normalizeMs = Math.round(performance.now() - t0);

  console.info(
    `[vcNormalize] Peak-norm: peak ${inputPeakDb.toFixed(1)} dBFS → 0.0 dBFS ` +
    `(gain ${gainDb > 0 ? "+" : ""}${gainDb.toFixed(1)} dB), ` +
    `RMS ${inputRmsDb.toFixed(1)} → ${outputRmsDb.toFixed(1)} dBFS, ${normalizeMs}ms`
  );

  return { samples: output, gainDb, inputRmsDb, outputRmsDb, inputPeakDb, limited: false, normalizeMs };
}
