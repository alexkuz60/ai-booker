/**
 * Multi-LOD stereo waveform peak computation + Cache API storage.
 * 
 * LOD levels: 200 (overview), 800 (medium), 3200 (detail)
 * Each LOD stores separate L/R channel peaks as Float32Array pairs.
 */

const PEAK_CACHE_NAME = "booker-waveform-peaks-v1";
const LOD_LEVELS = [200, 800, 3200] as const;
export type LodLevel = typeof LOD_LEVELS[number];

export interface StereoPeaks {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  duration: number;
  lodLevel: LodLevel;
}

export interface MultiLodPeaks {
  lods: Map<LodLevel, StereoPeaks>;
  sampleRate: number;
  duration: number;
}

/**
 * Compute peaks for a single channel at a given LOD.
 */
function computeChannelPeaks(data: Float32Array, peakCount: number): Float32Array {
  const step = Math.max(1, Math.floor(data.length / peakCount));
  const peaks = new Float32Array(peakCount);

  for (let i = 0; i < peakCount; i++) {
    const start = i * step;
    let maxVal = 0;
    const end = Math.min(start + step, data.length);
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > maxVal) maxVal = v;
    }
    peaks[i] = maxVal;
  }

  return peaks;
}

/**
 * Compute multi-LOD stereo peaks from an AudioBuffer.
 */
export function computeMultiLodPeaks(buffer: AudioBuffer): MultiLodPeaks {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

  const lods = new Map<LodLevel, StereoPeaks>();

  for (const level of LOD_LEVELS) {
    lods.set(level, {
      left: computeChannelPeaks(left, level),
      right: computeChannelPeaks(right, level),
      sampleRate: buffer.sampleRate,
      duration: buffer.duration,
      lodLevel: level,
    });
  }

  return { lods, sampleRate: buffer.sampleRate, duration: buffer.duration };
}

/**
 * Choose the best LOD level for the current zoom/viewport.
 * Aim for ~2-4 peaks per visible pixel.
 */
export function chooseLod(
  visibleWidthPx: number,
  totalDurationSec: number,
  visibleDurationSec: number,
): LodLevel {
  if (visibleWidthPx <= 0 || visibleDurationSec <= 0) return 200;
  
  const peaksPerPixel = 2;
  const neededPeaks = visibleWidthPx * peaksPerPixel;
  const neededTotal = Math.round(neededPeaks * (totalDurationSec / visibleDurationSec));
  
  // Pick smallest LOD that gives enough detail
  for (const level of LOD_LEVELS) {
    if (level >= neededTotal) return level;
  }
  return LOD_LEVELS[LOD_LEVELS.length - 1];
}

// ── Cache API persistence ────────────────────────────────

function cacheKey(audioPath: string): string {
  return `/_wfpeaks_/${audioPath}`;
}

/**
 * Serialize MultiLodPeaks to a compact binary format for Cache API storage.
 * Format: [sampleRate:f32][duration:f32][numLods:u32]
 *   For each LOD: [level:u32][length:u32][leftPeaks:f32*N][rightPeaks:f32*N]
 */
function serializePeaks(peaks: MultiLodPeaks): ArrayBuffer {
  let totalFloats = 0;
  for (const [, lod] of peaks.lods) {
    totalFloats += lod.left.length + lod.right.length;
  }
  // Header: sampleRate + duration + numLods = 3 * 4 bytes
  // Per LOD: level + length = 2 * 4 bytes + data
  const headerSize = 12;
  const lodHeaderSize = peaks.lods.size * 8;
  const dataSize = totalFloats * 4;
  const buf = new ArrayBuffer(headerSize + lodHeaderSize + dataSize);
  const view = new DataView(buf);
  let offset = 0;

  view.setFloat32(offset, peaks.sampleRate); offset += 4;
  view.setFloat32(offset, peaks.duration); offset += 4;
  view.setUint32(offset, peaks.lods.size); offset += 4;

  for (const [level, lod] of peaks.lods) {
    view.setUint32(offset, level); offset += 4;
    view.setUint32(offset, lod.left.length); offset += 4;
    const leftArr = new Float32Array(buf, offset, lod.left.length);
    leftArr.set(lod.left); offset += lod.left.length * 4;
    const rightArr = new Float32Array(buf, offset, lod.right.length);
    rightArr.set(lod.right); offset += lod.right.length * 4;
  }

  return buf;
}

function deserializePeaks(buf: ArrayBuffer): MultiLodPeaks | null {
  try {
    const view = new DataView(buf);
    let offset = 0;

    const sampleRate = view.getFloat32(offset); offset += 4;
    const duration = view.getFloat32(offset); offset += 4;
    const numLods = view.getUint32(offset); offset += 4;

    const lods = new Map<LodLevel, StereoPeaks>();

    for (let i = 0; i < numLods; i++) {
      const level = view.getUint32(offset) as LodLevel; offset += 4;
      const length = view.getUint32(offset); offset += 4;
      const left = new Float32Array(buf, offset, length); offset += length * 4;
      const right = new Float32Array(buf, offset, length); offset += length * 4;
      lods.set(level, { left, right, sampleRate, duration, lodLevel: level });
    }

    return { lods, sampleRate, duration };
  } catch {
    return null;
  }
}

/**
 * Load cached peaks from Cache API.
 */
export async function loadCachedPeaks(audioPath: string): Promise<MultiLodPeaks | null> {
  try {
    const cache = await caches.open(PEAK_CACHE_NAME);
    const resp = await cache.match(cacheKey(audioPath));
    if (!resp) return null;
    const buf = await resp.arrayBuffer();
    return deserializePeaks(buf);
  } catch {
    return null;
  }
}

/**
 * Save computed peaks to Cache API.
 */
export async function savePeaksToCache(audioPath: string, peaks: MultiLodPeaks): Promise<void> {
  try {
    const cache = await caches.open(PEAK_CACHE_NAME);
    const buf = serializePeaks(peaks);
    const resp = new Response(buf, {
      headers: { "Content-Type": "application/octet-stream" },
    });
    await cache.put(cacheKey(audioPath), resp);
  } catch (e) {
    console.warn("[WaveformPeaks] Failed to cache peaks:", e);
  }
}

/**
 * Clear the entire peaks cache.
 */
export async function clearPeaksCache(): Promise<void> {
  try {
    await caches.delete(PEAK_CACHE_NAME);
  } catch {
    // ignore
  }
}
