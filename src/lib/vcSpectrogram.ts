/**
 * vcSpectrogram.ts — Render a mel-scale spectrogram from audio samples onto a canvas.
 *
 * Uses a simple STFT (Short-Time Fourier Transform) with Hann window.
 * Frequency axis is mapped to mel scale for perceptually accurate display.
 * Supports optional F0 pitch contour overlay.
 */

import type { PitchFrame } from "./vcCrepe";

const DEFAULT_FFT_SIZE = 2048;
const DEFAULT_HOP = 512;
const DEFAULT_HEIGHT = 200;
const DEFAULT_WIDTH = 600;

export interface SpectrogramOptions {
  fftSize?: number;
  hop?: number;
  width?: number;
  height?: number;
  /** Min dB floor (default -90) */
  minDb?: number;
  /** Max dB ceiling (default 0) */
  maxDb?: number;
  /** Color palette: "magma" | "viridis" | "grayscale" */
  palette?: "magma" | "viridis" | "grayscale";
  /** Label to draw at top-left */
  label?: string;
  /** Optional F0 pitch contour to overlay */
  f0Frames?: PitchFrame[];
  /** Color for F0 line (default cyan) */
  f0Color?: string;
}

// ── Mel scale helpers ──

function hzToMel(f: number): number {
  return 2595 * Math.log10(1 + f / 700);
}

function melToHz(m: number): number {
  return 700 * (Math.pow(10, m / 2595) - 1);
}

/**
 * Decode any audio source to mono Float32Array at native sample rate.
 */
export async function decodeAudioToMono(
  source: Blob | ArrayBuffer,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const buf = source instanceof Blob ? await source.arrayBuffer() : source;
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    if (decoded.numberOfChannels === 1) {
      return { samples: decoded.getChannelData(0), sampleRate: decoded.sampleRate };
    }
    const mono = new Float32Array(decoded.length);
    const ch = decoded.numberOfChannels;
    for (let c = 0; c < ch; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < mono.length; i++) {
        mono[i] += data[i] / ch;
      }
    }
    return { samples: mono, sampleRate: decoded.sampleRate };
  } finally {
    await ctx.close();
  }
}

/**
 * Compute STFT magnitudes in dB.
 * Returns [numFrames][numBins] where numBins = fftSize/2.
 */
function computeSTFT(
  samples: Float32Array,
  fftSize: number,
  hop: number,
): Float32Array[] {
  const numBins = fftSize / 2;
  const frames: Float32Array[] = [];

  const win = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  for (let start = 0; start + fftSize <= samples.length; start += hop) {
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      real[i] = samples[start + i] * win[i];
    }
    fftInPlace(real, imag);

    const mags = new Float32Array(numBins);
    for (let k = 0; k < numBins; k++) {
      const mag = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
      mags[k] = 20 * Math.log10(Math.max(mag, 1e-10));
    }
    frames.push(mags);
  }

  return frames;
}

/**
 * In-place radix-2 FFT (Cooley-Tukey).
 */
function fftInPlace(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2;
    const angle = (-2 * Math.PI) / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < halfSize; k++) {
        const cos = Math.cos(angle * k);
        const sin = Math.sin(angle * k);
        const tReal = real[i + k + halfSize] * cos - imag[i + k + halfSize] * sin;
        const tImag = real[i + k + halfSize] * sin + imag[i + k + halfSize] * cos;
        real[i + k + halfSize] = real[i + k] - tReal;
        imag[i + k + halfSize] = imag[i + k] - tImag;
        real[i + k] += tReal;
        imag[i + k] += tImag;
      }
    }
  }
}

// ── Color palettes ──

type ColorFn = (t: number) => [number, number, number];

const magmaColors: ColorFn = (t) => {
  const r = Math.round(255 * Math.min(1, t * 3.5 - 0.15));
  const g = Math.round(255 * Math.max(0, Math.min(1, t * 2.5 - 0.6)));
  const b = Math.round(255 * Math.min(1, Math.max(0, 0.5 + 0.5 * Math.sin(Math.PI * (t * 0.8 + 0.3)))));
  return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
};

const viridisColors: ColorFn = (t) => {
  const r = Math.round(255 * Math.max(0, Math.min(1, -0.5 + 1.8 * t)));
  const g = Math.round(255 * Math.max(0, Math.min(1, 0.1 + 0.85 * t)));
  const b = Math.round(255 * Math.max(0, Math.min(1, 0.35 + 0.5 * Math.sin(Math.PI * (1.2 - t)))));
  return [r, g, b];
};

const grayscaleColors: ColorFn = (t) => {
  const v = Math.round(255 * t);
  return [v, v, v];
};

const PALETTES: Record<string, ColorFn> = {
  magma: magmaColors,
  viridis: viridisColors,
  grayscale: grayscaleColors,
};

// ── Mel-scale bin lookup ──

/**
 * Build a lookup table: for each pixel row y ∈ [0, height), 
 * return the corresponding linear FFT bin index using mel-scale mapping.
 */
function buildMelBinLookup(height: number, numBins: number, nyquist: number): Uint16Array {
  const melMin = hzToMel(0);
  const melMax = hzToMel(nyquist);
  const lookup = new Uint16Array(height);

  for (let y = 0; y < height; y++) {
    // y=0 → top → high freq, y=height-1 → bottom → low freq
    const melFrac = (height - 1 - y) / (height - 1);
    const mel = melMin + melFrac * (melMax - melMin);
    const hz = melToHz(mel);
    const bin = Math.round((hz / nyquist) * (numBins - 1));
    lookup[y] = Math.max(0, Math.min(numBins - 1, bin));
  }
  return lookup;
}

/**
 * Convert frequency in Hz to Y pixel position using mel scale.
 */
function freqToMelY(freq: number, height: number, nyquist: number): number {
  const melMin = hzToMel(0);
  const melMax = hzToMel(nyquist);
  const mel = hzToMel(freq);
  const melFrac = (mel - melMin) / (melMax - melMin);
  return height - 1 - Math.round(melFrac * (height - 1));
}

/**
 * Render spectrogram from audio samples onto a canvas element.
 * Uses mel-scale frequency axis for perceptually accurate display.
 */
export function renderSpectrogram(
  canvas: HTMLCanvasElement,
  samples: Float32Array,
  sampleRate: number,
  options?: SpectrogramOptions,
): void {
  const fftSize = options?.fftSize ?? DEFAULT_FFT_SIZE;
  const hop = options?.hop ?? DEFAULT_HOP;
  const width = options?.width ?? DEFAULT_WIDTH;
  const height = options?.height ?? DEFAULT_HEIGHT;
  const minDb = options?.minDb ?? -90;
  const maxDb = options?.maxDb ?? 0;
  const colorFn = PALETTES[options?.palette ?? "magma"] ?? magmaColors;
  const label = options?.label;
  const f0Frames = options?.f0Frames;
  const f0Color = options?.f0Color ?? "rgba(0, 255, 255, 0.85)";

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const frames = computeSTFT(samples, fftSize, hop);
  if (frames.length === 0) return;

  const numBins = fftSize / 2;
  const dbRange = maxDb - minDb;
  const nyquist = sampleRate / 2;

  // Build mel-scale bin lookup table
  const melBins = buildMelBinLookup(height, numBins, nyquist);

  // Create ImageData
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  for (let x = 0; x < width; x++) {
    const frameIdx = Math.floor((x / width) * frames.length);
    const frame = frames[Math.min(frameIdx, frames.length - 1)];

    for (let y = 0; y < height; y++) {
      const binIdx = melBins[y];
      const db = frame[binIdx];
      const normalized = Math.max(0, Math.min(1, (db - minDb) / dbRange));
      const [r, g, b] = colorFn(normalized);
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Draw frequency axis labels (mel-spaced)
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "10px monospace";
  const freqLabels = [100, 300, 500, 1000, 2000, 4000, 8000].filter(f => f < nyquist);
  for (const freq of freqLabels) {
    const yPos = freqToMelY(freq, height, nyquist);
    if (yPos > 12 && yPos < height - 4) {
      ctx.fillText(`${freq >= 1000 ? `${freq / 1000}k` : freq}`, 2, yPos + 3);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(30, yPos);
      ctx.lineTo(width, yPos);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ── F0 pitch contour overlay ──
  if (f0Frames && f0Frames.length > 0) {
    const durationSec = samples.length / sampleRate;
    ctx.strokeStyle = f0Color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();

    let started = false;
    for (let i = 0; i < f0Frames.length; i++) {
      const frame = f0Frames[i];
      if (frame.frequencyHz <= 0 || frame.confidence < 0.1) {
        started = false;
        continue;
      }
      const x = Math.round((frame.timeSec / durationSec) * width);
      const y = freqToMelY(frame.frequencyHz, height, nyquist);

      if (y < 0 || y >= height) { started = false; continue; }

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // F0 legend
    const legendX = width - 60;
    ctx.fillStyle = f0Color;
    ctx.font = "bold 9px monospace";
    ctx.fillText("── F0", legendX, 12);
  }

  // Draw label
  if (label) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, ctx.measureText(label).width + 12, 18);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(label, 6, 13);
  }

  // Draw time axis
  const durationSec = samples.length / sampleRate;
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "9px monospace";
  for (let t = 0.5; t < durationSec; t += 0.5) {
    const xPos = Math.round((t / durationSec) * width);
    ctx.fillText(`${t.toFixed(1)}s`, xPos + 2, height - 3);
  }
}

/**
 * Render spectrogram directly from a Blob (decodes internally).
 */
export async function renderSpectrogramFromBlob(
  canvas: HTMLCanvasElement,
  audioBlob: Blob,
  options?: SpectrogramOptions,
): Promise<void> {
  const { samples, sampleRate } = await decodeAudioToMono(audioBlob);
  renderSpectrogram(canvas, samples, sampleRate, options);
}
