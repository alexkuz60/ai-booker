/**
 * audioEngineTypes — shared types for the audio engine.
 *
 * Extracted from audioEngine.ts for clarity and reusability.
 */

export type FilterType = "lowpass" | "highpass" | "bandpass" | "lowshelf" | "highshelf" | "notch" | "allpass" | "peaking";
export type FilterRolloff = -12 | -24 | -48 | -96;

export interface FilterBandParams {
  frequency: number;
  type: FilterType;
  Q: number;
  gain: number;
  rolloff: FilterRolloff;
}

export interface MultibandCompBandParams {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
}

export interface MultibandCompParams {
  low: MultibandCompBandParams;
  mid: MultibandCompBandParams;
  high: MultibandCompBandParams;
  lowFrequency: number;
  highFrequency: number;
}

export const DEFAULT_MULTIBAND_COMP: MultibandCompParams = {
  low:  { threshold: -24, ratio: 4, attack: 0.01, release: 0.2, knee: 10 },
  mid:  { threshold: -18, ratio: 3, attack: 0.005, release: 0.15, knee: 8 },
  high: { threshold: -12, ratio: 2, attack: 0.003, release: 0.1, knee: 6 },
  lowFrequency: 250,
  highFrequency: 3500,
};

export const DEFAULT_FILTER_BANDS: FilterBandParams[] = [
  { frequency: 30, type: "highpass", Q: 0.707, gain: 0, rolloff: -12 },
  { frequency: 200, type: "lowshelf", Q: 0.707, gain: 0, rolloff: -12 },
  { frequency: 1000, type: "peaking", Q: 1, gain: 0, rolloff: -12 },
  { frequency: 8000, type: "highshelf", Q: 0.707, gain: 0, rolloff: -12 },
  { frequency: 18000, type: "lowpass", Q: 0.707, gain: 0, rolloff: -12 },
];

export interface TrackConfig {
  id: string;
  url: string;
  startSec: number;
  durationSec: number;
  overlay?: boolean;
  volume?: number;
  pan?: number;
  bus?: "voice" | "atmosphere" | "sfx";
  fadeInSec?: number;
  fadeOutSec?: number;
  loop?: boolean;
  clipLenSec?: number;
  loopCrossfadeSec?: number;
  label?: string;
  cacheKey?: string;
  segmentType?: string;
}

export interface LoadProgress {
  total: number;
  done: number;
  loaded: number;
  failed: number;
  currentId: string;
  currentLabel: string;
}

export interface LoadTracksResult {
  total: number;
  loaded: number;
  dropped: number;
}

export type EngineState = "stopped" | "playing" | "paused";

export interface TrackMeterData {
  level: number;
  levelL: number;
  levelR: number;
}

export interface MasterMeterData {
  levelL: number;
  levelR: number;
  peakL: number;
  peakR: number;
}

export interface ChannelEqState {
  low: number;
  mid: number;
  high: number;
  bypassed: boolean;
}

export interface ChannelCompState {
  threshold: number;
  ratio: number;
  knee: number;
  attack: number;
  release: number;
  bypassed: boolean;
}

export interface ChannelLimiterState {
  threshold: number;
  bypassed: boolean;
}

export interface TrackMixState {
  volume: number;
  pan: number;
  reverbWet: number;
  reverbBypassed: boolean;
  preFxBypassed: boolean;
  muted: boolean;
  solo: boolean;
  eq: ChannelEqState;
  comp: ChannelCompState;
  limiter: ChannelLimiterState;
}

export interface EngineSnapshot {
  state: EngineState;
  positionSec: number;
  totalDuration: number;
  volume: number;
}

export type StateListener = (snapshot: EngineSnapshot) => void;

/** Convert 0-100 linear volume to dB (-Infinity…0) using Tone.js native */
export { volumeToDB };

import * as Tone from "tone";
function volumeToDB(v: number): number {
  if (v <= 0) return -Infinity;
  return Tone.gainToDb(v / 100);
}
