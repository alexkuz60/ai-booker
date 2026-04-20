/**
 * VocoLoco — Float32 PCM → 16-bit PCM WAV encoder.
 *
 * Output of designVoice/cloneVoice is a Float32Array at 24 kHz mono. We wrap
 * it into a standard WAV blob so the existing OmniVoiceResultCard can play
 * and download it through the same code path used for server-mode results.
 *
 * Mirrors encodeWav16 from omniVoiceAudioPrep but lives in the vocoloco
 * module so the local engine has zero coupling to the server-mode prep code.
 */

export function encodeFloat32ToWav(
  pcm: Float32Array,
  sampleRate: number,
): Blob {
  const numFrames = pcm.length;
  const blockAlign = 2; // mono * 16-bit
  const byteRate = sampleRate * blockAlign;
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
  view.setUint32(16, 16, true);   // fmt chunk size
  view.setUint16(20, 1, true);    // PCM format
  view.setUint16(22, 1, true);    // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);   // bits per sample
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
 * Decode an arbitrary audio blob to a 24 kHz mono Float32Array — the format
 * the VocoLoco encoder expects for reference audio in cloneVoice().
 *
 * Uses a temporary AudioContext + OfflineAudioContext for resampling. Browser
 * decodes any format it natively supports (wav, mp3, ogg, m4a…).
 */
export async function decodeBlobToMono24kFloat32(blob: Blob): Promise<Float32Array> {
  const arrayBuf = await blob.arrayBuffer();
  const Ctx: typeof AudioContext =
    (window.AudioContext as typeof AudioContext) ||
    ((window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
  } finally {
    ctx.close().catch(() => undefined);
  }

  const TARGET = 24_000;
  const Off: typeof OfflineAudioContext =
    (window.OfflineAudioContext as typeof OfflineAudioContext) ||
    ((window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext);

  const targetLength = Math.ceil(decoded.duration * TARGET);
  const off = new Off(1, targetLength, TARGET);

  // Build a mono source buffer averaging input channels.
  const monoSrc = off.createBuffer(1, decoded.length, decoded.sampleRate);
  const dst = monoSrc.getChannelData(0);
  if (decoded.numberOfChannels === 1) {
    dst.set(decoded.getChannelData(0));
  } else {
    const n = decoded.numberOfChannels;
    for (let c = 0; c < n; c++) {
      const ch = decoded.getChannelData(c);
      for (let i = 0; i < ch.length; i++) dst[i] += ch[i] / n;
    }
  }

  const src = off.createBufferSource();
  src.buffer = monoSrc;
  src.connect(off.destination);
  src.start(0);

  const rendered = await off.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}
