/**
 * vcResample.ts — Resamples audio to 16 kHz mono Float32Array for VC models.
 * Uses OfflineAudioContext for high-quality resampling.
 */

const VC_SAMPLE_RATE = 16_000;

/**
 * Decode any audio blob/buffer into 16 kHz mono Float32Array.
 * Works in main thread; no Web Worker needed for typical TTS clip sizes (<30s).
 */
export async function resampleTo16kMono(
  input: ArrayBuffer | Blob,
  sourceSampleRate?: number,
): Promise<{ samples: Float32Array; sampleRate: number; durationSec: number }> {
  const buffer = input instanceof Blob ? await input.arrayBuffer() : input;

  // Decode with a temporary AudioContext
  const tmpCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await tmpCtx.decodeAudioData(buffer.slice(0)); // slice to avoid detach
  } finally {
    await tmpCtx.close();
  }

  const srcRate = sourceSampleRate ?? decoded.sampleRate;
  const duration = decoded.duration;
  const outLength = Math.ceil(duration * VC_SAMPLE_RATE);

  // Use OfflineAudioContext for resampling
  const offCtx = new OfflineAudioContext(1, outLength, VC_SAMPLE_RATE);
  const src = offCtx.createBufferSource();
  src.buffer = decoded;
  src.connect(offCtx.destination);
  src.start(0);

  const rendered = await offCtx.startRendering();
  const samples = rendered.getChannelData(0);

  console.info(
    `[vcResample] ${srcRate}Hz → ${VC_SAMPLE_RATE}Hz, ` +
    `${decoded.numberOfChannels}ch → mono, ` +
    `${(samples.length / VC_SAMPLE_RATE).toFixed(2)}s, ` +
    `${(samples.byteLength / 1024).toFixed(0)} KB`
  );

  return { samples, sampleRate: VC_SAMPLE_RATE, durationSec: duration };
}

/**
 * Split audio into fixed-length frames with optional overlap.
 * Returns array of Float32Array frames.
 */
export function frameAudio(
  samples: Float32Array,
  frameSize: number,
  hopSize: number,
): Float32Array[] {
  const frames: Float32Array[] = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    frames.push(samples.slice(start, start + frameSize));
  }
  return frames;
}

/**
 * Apply Hann window in-place.
 */
export function applyHannWindow(frame: Float32Array): Float32Array {
  const N = frame.length;
  for (let i = 0; i < N; i++) {
    frame[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  return frame;
}
