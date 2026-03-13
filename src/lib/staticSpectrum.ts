/**
 * Static spectrum analysis — computes FFT from waveform peak data
 * or decoded audio buffers at a specific position or averaged over a range.
 *
 * Uses a simple pub/sub to bridge WaveformEditor → SpectrumAnalyzer.
 */

export interface StaticSpectrumData {
  /** FFT magnitudes in dB, same length as the live FFT bins */
  bins: Float32Array;
  /** Label describing what was analyzed */
  label: string;
}

type Listener = (data: StaticSpectrumData | null) => void;

let _data: StaticSpectrumData | null = null;
const _listeners = new Set<Listener>();

export function setStaticSpectrum(data: StaticSpectrumData | null) {
  _data = data;
  _listeners.forEach(fn => fn(data));
}

export function getStaticSpectrum(): StaticSpectrumData | null {
  return _data;
}

export function subscribeStaticSpectrum(fn: Listener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/**
 * Compute FFT at a specific sample position from an AudioBuffer.
 * Returns dB magnitudes array of `fftSize / 2` bins.
 */
export function computeFFTAtPosition(
  buffer: AudioBuffer,
  positionSec: number,
  fftSize: number = 256,
): Float32Array {
  const sr = buffer.sampleRate;
  const startSample = Math.max(0, Math.floor(positionSec * sr) - fftSize / 2);
  const numBins = fftSize / 2;
  const result = new Float32Array(numBins);

  // Extract windowed samples (mono mix of all channels)
  const windowSamples = new Float32Array(fftSize);
  const numCh = buffer.numberOfChannels;
  for (let ch = 0; ch < numCh; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < fftSize; i++) {
      const idx = startSample + i;
      if (idx >= 0 && idx < data.length) {
        windowSamples[i] += data[idx] / numCh;
      }
    }
  }

  // Apply Hann window
  for (let i = 0; i < fftSize; i++) {
    windowSamples[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  // DFT (real input → magnitude spectrum)
  for (let k = 0; k < numBins; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < fftSize; n++) {
      const angle = (-2 * Math.PI * k * n) / fftSize;
      re += windowSamples[n] * Math.cos(angle);
      im += windowSamples[n] * Math.sin(angle);
    }
    const mag = Math.sqrt(re * re + im * im) / fftSize;
    result[k] = mag > 0 ? 20 * Math.log10(mag) : -100;
  }

  return result;
}

/**
 * Compute averaged FFT over a time range.
 */
export function computeAveragedFFT(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  fftSize: number = 256,
  hopCount: number = 16,
): Float32Array {
  const numBins = fftSize / 2;
  const avgResult = new Float32Array(numBins).fill(0);
  const duration = endSec - startSec;
  const step = duration / hopCount;

  for (let i = 0; i < hopCount; i++) {
    const pos = startSec + step * (i + 0.5);
    const snapshot = computeFFTAtPosition(buffer, pos, fftSize);
    // Average in linear power domain for accuracy
    for (let k = 0; k < numBins; k++) {
      avgResult[k] += Math.pow(10, snapshot[k] / 20);
    }
  }

  // Convert back to dB
  for (let k = 0; k < numBins; k++) {
    const avg = avgResult[k] / hopCount;
    avgResult[k] = avg > 0 ? 20 * Math.log10(avg) : -100;
  }

  return avgResult;
}
