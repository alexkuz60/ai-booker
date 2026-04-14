/**
 * vcSpectrogram.ts — Render a spectrogram from audio samples onto a canvas.
 *
 * Uses a simple STFT (Short-Time Fourier Transform) with Hann window.
 * Output: a 2D magnitude heatmap drawn on an OffscreenCanvas or regular canvas.
 */

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
    // Mix to mono
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

  // Precompute Hann window
  const win = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  for (let start = 0; start + fftSize <= samples.length; start += hop) {
    // Apply window
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      real[i] = samples[start + i] * win[i];
    }

    // In-place FFT (Cooley-Tukey radix-2)
    fftInPlace(real, imag);

    // Magnitude in dB
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
  // Bit-reversal permutation
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

  // Butterfly stages
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
  // Simplified magma colormap
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

/**
 * Render spectrogram from audio samples onto a canvas element.
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

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const frames = computeSTFT(samples, fftSize, hop);
  if (frames.length === 0) return;

  const numBins = fftSize / 2;
  const dbRange = maxDb - minDb;

  // Create ImageData
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  for (let x = 0; x < width; x++) {
    const frameIdx = Math.floor((x / width) * frames.length);
    const frame = frames[Math.min(frameIdx, frames.length - 1)];

    for (let y = 0; y < height; y++) {
      // y=0 is top → high freq, y=height-1 is bottom → low freq
      const binIdx = Math.floor(((height - 1 - y) / (height - 1)) * (numBins - 1));
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

  // Draw frequency axis labels
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "10px monospace";
  const nyquist = sampleRate / 2;
  const freqLabels = [100, 500, 1000, 2000, 4000, 8000].filter(f => f < nyquist);
  for (const freq of freqLabels) {
    const binRatio = freq / nyquist;
    const yPos = height - 1 - Math.round(binRatio * (height - 1));
    if (yPos > 12 && yPos < height - 4) {
      ctx.fillText(`${freq >= 1000 ? `${freq / 1000}k` : freq}`, 2, yPos + 3);
      // Draw a thin dotted line
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(30, yPos);
      ctx.lineTo(width, yPos);
      ctx.stroke();
      ctx.setLineDash([]);
    }
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
