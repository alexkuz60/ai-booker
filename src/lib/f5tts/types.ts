/**
 * f5tts/types.ts — Shared types for F5-TTS ONNX pipeline.
 */

/** F5-TTS model IDs */
export type F5ModelId = "f5tts-encoder" | "f5tts-transformer" | "f5tts-decoder";

/** F5-TTS model registry entry */
export interface F5ModelEntry {
  id: F5ModelId;
  label: string;
  url: string;
  sizeBytes: number;
  description: string;
}

/** Reference voice with transcript */
export interface F5Reference {
  /** PCM int16 mono 24kHz */
  audio: Int16Array;
  /** Reference transcript text */
  text: string;
  /** Duration in samples */
  samples: number;
}

/** Synthesis options */
export interface F5SynthesisOptions {
  /** Number of Flow-matching Euler steps (default 16) */
  nfeSteps?: number;
  /** Speed factor (default 1.0, higher = faster speech) */
  speed?: number;
  /** Callback for step progress */
  onStep?: (step: number, total: number) => void;
}

/** Synthesis result */
export interface F5SynthesisResult {
  /** Generated PCM int16 mono 24kHz */
  audio: Int16Array;
  /** Duration in seconds */
  durationSec: number;
  /** Per-stage timing */
  timing: {
    encoderMs: number;
    transformerMs: number;
    decoderMs: number;
    totalMs: number;
  };
  /** NFE steps used */
  nfeSteps: number;
}

/** Output sample rate of F5-TTS */
export const F5_SAMPLE_RATE = 24_000;
export const F5_HOP_LENGTH = 256;
