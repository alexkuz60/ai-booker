/**
 * omniVoiceAudioPrep.ts — Prepare reference audio for OmniVoice Cloning.
 *
 * OmniVoice server expects 24 kHz mono WAV. We:
 *   1. Decode the source blob via AudioContext (any format the browser supports).
 *   2. If sampleRate is already 24000 and mono — return original blob untouched.
 *   3. Otherwise downmix to mono, resample to 24000 Hz via OfflineAudioContext,
 *      and encode as 16-bit PCM WAV.
 */

const TARGET_SAMPLE_RATE = 24000;

export interface PreparedRefAudio {
  blob: Blob;
  fileName: string;
  sampleRate: number;
  channels: number;
  durationMs: number;
  converted: boolean;
}

/** Decode an arbitrary audio blob to AudioBuffer using a temporary AudioContext. */
async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const arrayBuf = await blob.arrayBuffer();
  const Ctx: typeof AudioContext =
    (window.AudioContext as typeof AudioContext) ||
    ((window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(arrayBuf.slice(0));
  } finally {
    ctx.close().catch(() => undefined);
  }
}

/** Mix all channels into a single Float32Array (averaged) and resample to TARGET_SAMPLE_RATE. */
async function downmixAndResample(buffer: AudioBuffer): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const Off: typeof OfflineAudioContext =
    (window.OfflineAudioContext as typeof OfflineAudioContext) ||
    ((window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext);

  const targetLength = Math.ceil(buffer.duration * TARGET_SAMPLE_RATE);
  const off = new Off(1, targetLength, TARGET_SAMPLE_RATE);

  // Build a mono source buffer from the original (averaging channels).
  const monoSrc = off.createBuffer(1, buffer.length, buffer.sampleRate);
  const dst = monoSrc.getChannelData(0);
  if (buffer.numberOfChannels === 1) {
    dst.set(buffer.getChannelData(0));
  } else {
    const n = buffer.numberOfChannels;
    for (let c = 0; c < n; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < ch.length; i++) dst[i] += ch[i] / n;
    }
  }

  const src = off.createBufferSource();
  src.buffer = monoSrc;
  src.connect(off.destination);
  src.start(0);

  const rendered = await off.startRendering();
  return { pcm: rendered.getChannelData(0), sampleRate: TARGET_SAMPLE_RATE };
}

/** Encode a mono Float32 PCM array as a 16-bit PCM WAV blob. */
function encodeWav16(pcm: Float32Array, sampleRate: number): Blob {
  const numFrames = pcm.length;
  const byteRate = sampleRate * 2;
  const blockAlign = 2;
  const dataSize = numFrames * 2;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);              // fmt chunk size
  view.setUint16(20, 1, true);               // PCM
  view.setUint16(22, 1, true);               // channels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);              // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Ensure the blob is a 24 kHz mono WAV. If already conformant, returns it as-is.
 * Throws if decode fails.
 */
export async function prepareRefAudioForOmniVoice(
  blob: Blob,
  baseName = "reference",
): Promise<PreparedRefAudio> {
  const decoded = await decodeAudio(blob);
  const isMono = decoded.numberOfChannels === 1;
  const isTargetRate = decoded.sampleRate === TARGET_SAMPLE_RATE;

  if (isMono && isTargetRate && /\.wav$/i.test(baseName)) {
    return {
      blob,
      fileName: baseName,
      sampleRate: decoded.sampleRate,
      channels: 1,
      durationMs: Math.round(decoded.duration * 1000),
      converted: false,
    };
  }

  const { pcm, sampleRate } = await downmixAndResample(decoded);
  const wavBlob = encodeWav16(pcm, sampleRate);
  const cleanName = baseName.replace(/\.[a-z0-9]+$/i, "");
  return {
    blob: wavBlob,
    fileName: `${cleanName}_24k.wav`,
    sampleRate,
    channels: 1,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
    converted: true,
  };
}
