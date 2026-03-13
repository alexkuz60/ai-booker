/**
 * Web Worker for computing scene-wide multi-LOD stereo waveform peaks.
 * Receives raw channel data (Float32Array) via transferable objects for zero-copy.
 *
 * Message protocol:
 *   IN:  { clips: ClipChannelData[], sceneDuration, lodLevels, sampleRate }
 *   OUT: { lods: SerializedLod[] }   (Float32Arrays transferred back)
 */

export interface ClipChannelData {
  startSec: number;
  durationSec: number;
  bufferDuration: number;
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

export interface SerializedLod {
  lodLevel: number;
  left: Float32Array;
  right: Float32Array;
}

export interface PeaksWorkerInput {
  clips: ClipChannelData[];
  sceneDuration: number;
  lodLevels: number[];
  sampleRate: number;
}

export interface PeaksWorkerOutput {
  lods: SerializedLod[];
  sampleRate: number;
  duration: number;
}

function computeInWorker(data: PeaksWorkerInput): PeaksWorkerOutput {
  const { clips, sceneDuration, lodLevels, sampleRate } = data;

  const lodsResult: SerializedLod[] = [];

  for (const lodLevel of lodLevels) {
    const leftPeaks = new Float32Array(lodLevel);
    const rightPeaks = new Float32Array(lodLevel);
    const secPerBin = sceneDuration / lodLevel;

    for (const clip of clips) {
      const clipStart = clip.startSec;
      const clipEnd = clipStart + clip.durationSec;
      const leftData = clip.left;
      const rightData = clip.right;
      const bufDur = clip.bufferDuration;
      const sr = clip.sampleRate;

      const binStart = Math.max(0, Math.floor(clipStart / secPerBin));
      const binEnd = Math.min(lodLevel, Math.ceil(clipEnd / secPerBin));

      for (let i = binStart; i < binEnd; i++) {
        const binTimeSec = i * secPerBin;
        const binTimeEndSec = (i + 1) * secPerBin;

        const audioStartSec = Math.max(0, binTimeSec - clipStart);
        const audioEndSec = Math.min(bufDur, binTimeEndSec - clipStart);

        if (audioEndSec <= audioStartSec) continue;

        const sStart = Math.floor(audioStartSec * sr);
        const sEnd = Math.min(leftData.length, Math.ceil(audioEndSec * sr));

        let maxL = 0;
        let maxR = 0;
        for (let j = sStart; j < sEnd; j++) {
          const vl = Math.abs(leftData[j]);
          const vr = Math.abs(rightData[j]);
          if (vl > maxL) maxL = vl;
          if (vr > maxR) maxR = vr;
        }

        if (maxL > leftPeaks[i]) leftPeaks[i] = maxL;
        if (maxR > rightPeaks[i]) rightPeaks[i] = maxR;
      }
    }

    lodsResult.push({ lodLevel, left: leftPeaks, right: rightPeaks });
  }

  return { lods: lodsResult, sampleRate, duration: sceneDuration };
}

// Worker entry point
self.onmessage = (e: MessageEvent<PeaksWorkerInput>) => {
  const result = computeInWorker(e.data);
  // Transfer all Float32Array buffers back for zero-copy
  const transferables: Transferable[] = [];
  for (const lod of result.lods) {
    transferables.push(lod.left.buffer as ArrayBuffer, lod.right.buffer as ArrayBuffer);
  }
  (self as unknown as Worker).postMessage(result, transferables);
};
