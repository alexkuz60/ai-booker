/**
 * vcNormalize.ts — RMS loudness normalization for Voice Conversion pipeline.
 *
 * Normalizes input audio to a consistent RMS level before feeding into
 * speech encoders (ContentVec/WavLM), eliminating amplitude variance
 * across different TTS providers (Yandex, ElevenLabs, SaluteSpeech, etc.)
 */

/** Target RMS in dBFS — EBU R128 speech level */
const DEFAULT_TARGET_DB = -23;

/** Ceiling in dBFS — prevents hard clipping */
const CEILING_DB = -1;

/** Convert dBFS to linear amplitude */
function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/** Convert linear amplitude to dBFS */
function linearToDb(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-10));
}

/** Compute RMS of audio buffer */
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
  /** Input RMS in dBFS */
  inputRmsDb: number;
  /** Output RMS in dBFS */
  outputRmsDb: number;
  /** Whether ceiling limiter was applied */
  limited: boolean;
  /** Processing time in ms */
  normalizeMs: number;
}

/**
 * Normalize audio RMS to target level with soft ceiling limiter.
 *
 * @param samples - Input audio samples (mono, any sample rate)
 * @param targetDb - Target RMS in dBFS (default -23)
 * @returns Normalized audio with metadata
 */
export function normalizeRms(
  samples: Float32Array,
  targetDb = DEFAULT_TARGET_DB,
): NormalizeResult {
  const t0 = performance.now();

  const inputRms = computeRms(samples);
  const inputRmsDb = linearToDb(inputRms);

  // Skip normalization for silence
  if (inputRms < 1e-8) {
    console.info(`[vcNormalize] Input is silence, skipping`);
    return {
      samples,
      gainDb: 0,
      inputRmsDb: -Infinity,
      outputRmsDb: -Infinity,
      limited: false,
      normalizeMs: Math.round(performance.now() - t0),
    };
  }

  // Calculate required gain
  const targetRms = dbToLinear(targetDb);
  const gain = targetRms / inputRms;
  const gainDb = linearToDb(gain);

  // Apply gain
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i] * gain;
  }

  // Check for clipping and apply soft ceiling limiter
  const ceiling = dbToLinear(CEILING_DB);
  const peak = computePeak(output);
  let limited = false;

  if (peak > ceiling) {
    // Soft limiter: tanh-based saturation
    const scale = ceiling / peak;
    for (let i = 0; i < output.length; i++) {
      const scaled = output[i] * scale;
      // Gentle tanh compression in the top 3 dB
      if (Math.abs(scaled) > ceiling * 0.9) {
        output[i] = Math.tanh(scaled / ceiling) * ceiling;
      } else {
        output[i] = scaled;
      }
    }
    limited = true;
  }

  const outputRms = computeRms(output);
  const outputRmsDb = linearToDb(outputRms);
  const normalizeMs = Math.round(performance.now() - t0);

  console.info(
    `[vcNormalize] ${inputRmsDb.toFixed(1)} dBFS → ${outputRmsDb.toFixed(1)} dBFS ` +
    `(gain ${gainDb > 0 ? "+" : ""}${gainDb.toFixed(1)} dB${limited ? ", limited" : ""}), ${normalizeMs}ms`
  );

  return { samples: output, gainDb, inputRmsDb, outputRmsDb, limited, normalizeMs };
}
