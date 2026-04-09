/**
 * localTtsStorage — OPFS-backed storage for TTS audio clips (WAV).
 *
 * All TTS audio is stored locally at:
 *   chapters/{chapterId}/scenes/{sceneId}/tts/{segmentId}.wav
 *
 * This replaces the legacy approach of uploading to Supabase Storage.
 * Audio stays on the user's device, saving bandwidth and server resources.
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";
import { guardedDelete } from "@/lib/storageGuard";

// ── Write / Read / Delete ───────────────────────────────────

/**
 * Write a TTS WAV clip to OPFS.
 * @param storage  Active project storage
 * @param sceneId  Scene the segment belongs to
 * @param segmentId Segment identifier (used as filename)
 * @param wavData  Raw WAV audio bytes
 * @param chapterId Optional pre-resolved chapter ID
 */
export async function writeTtsClip(
  storage: ProjectStorage,
  sceneId: string,
  segmentId: string,
  wavData: ArrayBuffer,
  chapterId?: string,
): Promise<void> {
  const filePath = paths.ttsClip(segmentId, sceneId, chapterId);
  if (filePath.includes("__unresolved__")) {
    console.error(`[localTtsStorage] Cannot write TTS clip — unresolved chapterId for scene ${sceneId}`);
    return;
  }
  await storage.writeBlob(filePath, new Blob([wavData], { type: "audio/wav" }), "audio/wav");
}

/**
 * Read a TTS WAV clip from OPFS.
 * Returns null if not found.
 */
export async function readTtsClip(
  storage: ProjectStorage,
  sceneId: string,
  segmentId: string,
  chapterId?: string,
): Promise<ArrayBuffer | null> {
  const filePath = paths.ttsClip(segmentId, sceneId, chapterId);
  if (filePath.includes("__unresolved__")) return null;
  try {
    const blob = await storage.readBlob(filePath);
    if (!blob) return null;
    return await blob.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Check if a TTS clip exists in OPFS.
 */
export async function hasTtsClip(
  storage: ProjectStorage,
  sceneId: string,
  segmentId: string,
  chapterId?: string,
): Promise<boolean> {
  const filePath = paths.ttsClip(segmentId, sceneId, chapterId);
  if (filePath.includes("__unresolved__")) return false;
  return storage.exists(filePath);
}

/**
 * Delete a TTS clip from OPFS (via guardedDelete — path must match whitelist).
 */
export async function deleteTtsClip(
  storage: ProjectStorage,
  sceneId: string,
  segmentId: string,
  chapterId?: string,
): Promise<boolean> {
  const filePath = paths.ttsClip(segmentId, sceneId, chapterId);
  if (filePath.includes("__unresolved__")) return false;
  return guardedDelete(storage, filePath, "localTtsStorage.deleteTtsClip");
}

/**
 * Write an inline narration overlay clip to OPFS.
 * Path: chapters/{ch}/scenes/{sc}/tts/{segmentId}_narrator_{index}.wav
 */
export async function writeNarrationClip(
  storage: ProjectStorage,
  sceneId: string,
  segmentId: string,
  index: number,
  wavData: ArrayBuffer,
  chapterId?: string,
): Promise<string> {
  const fileName = `${segmentId}_narrator_${index}`;
  const filePath = paths.ttsClip(fileName, sceneId, chapterId);
  if (filePath.includes("__unresolved__")) {
    console.error(`[localTtsStorage] Cannot write narration clip — unresolved chapterId for scene ${sceneId}`);
    return "";
  }
  await storage.writeBlob(filePath, new Blob([wavData], { type: "audio/wav" }), "audio/wav");
  return filePath;
}

/**
 * Read an inline narration overlay clip from OPFS.
 */
export async function readNarrationClip(
  storage: ProjectStorage,
  sceneId: string,
  segmentId: string,
  index: number,
  chapterId?: string,
): Promise<ArrayBuffer | null> {
  const fileName = `${segmentId}_narrator_${index}`;
  const filePath = paths.ttsClip(fileName, sceneId, chapterId);
  if (filePath.includes("__unresolved__")) return null;
  try {
    const blob = await storage.readBlob(filePath);
    if (!blob) return null;
    return await blob.arrayBuffer();
  } catch {
    return null;
  }
}

// ── Phrase-level clips for merged segments ──────────────────

/**
 * Write a phrase-level TTS clip for a merged segment.
 * Stored as: tts/{segmentId}_p{phraseIndex}.wav
 */
export async function writePhraseClip(
  storage: ProjectStorage,
  sceneId: string,
  segmentId: string,
  phraseIndex: number,
  wavData: ArrayBuffer,
  chapterId?: string,
): Promise<string> {
  const filePath = paths.ttsPhraseClip(segmentId, phraseIndex, sceneId, chapterId);
  if (filePath.includes("__unresolved__")) {
    console.error(`[localTtsStorage] Cannot write phrase clip — unresolved chapterId for scene ${sceneId}`);
    return "";
  }
  await storage.writeBlob(filePath, new Blob([wavData], { type: "audio/wav" }), "audio/wav");
  return filePath;
}

// ── Batch helpers ───────────────────────────────────────────

/**
 * List all TTS clip filenames in a scene's tts/ directory.
 */
export async function listTtsClips(
  storage: ProjectStorage,
  sceneId: string,
  chapterId?: string,
): Promise<string[]> {
  // The tts directory path is: chapters/{ch}/scenes/{sc}/tts
  const clipPath = paths.ttsClip("_dummy_", sceneId, chapterId);
  if (clipPath.includes("__unresolved__")) return [];
  const ttsDir = clipPath.substring(0, clipPath.lastIndexOf("/"));
  try {
    return await storage.listDir(ttsDir);
  } catch {
    return [];
  }
}

// ── WAV header utilities ────────────────────────────────────

/**
 * Create a WAV header for raw PCM data.
 * @param pcmLength  Length of raw PCM data in bytes
 * @param sampleRate Sample rate (e.g. 48000, 44100, 16000)
 * @param channels   Number of channels (1 = mono, 2 = stereo)
 * @param bitsPerSample Bits per sample (usually 16)
 */
export function createWavHeader(
  pcmLength: number,
  sampleRate: number,
  channels: number = 1,
  bitsPerSample: number = 16,
): ArrayBuffer {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const totalLength = 44 + pcmLength;

  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, totalLength - 8, true); // file size - 8
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);             // chunk size
  view.setUint16(20, 1, true);              // audio format (PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, pcmLength, true);

  return buffer;
}

/**
 * Wrap raw PCM bytes in a WAV container.
 */
export function wrapPcmInWav(
  pcmData: Uint8Array,
  sampleRate: number,
  channels: number = 1,
  bitsPerSample: number = 16,
): ArrayBuffer {
  const header = createWavHeader(pcmData.length, sampleRate, channels, bitsPerSample);
  const wav = new Uint8Array(header.byteLength + pcmData.length);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcmData, header.byteLength);
  return wav.buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Parse WAV header to extract duration in milliseconds.
 * Falls back to rough estimation if header is invalid.
 */
export function parseWavDurationMs(wavData: ArrayBuffer): number {
  try {
    const view = new DataView(wavData);
    // Verify RIFF/WAVE header
    if (view.getUint32(0) !== 0x52494646) return estimateDuration(wavData.byteLength);
    if (view.getUint32(8) !== 0x57415645) return estimateDuration(wavData.byteLength);

    const sampleRate = view.getUint32(24, true);
    const blockAlign = view.getUint16(32, true);
    const dataSize = view.getUint32(40, true);

    if (sampleRate === 0 || blockAlign === 0) return estimateDuration(wavData.byteLength);

    const totalSamples = dataSize / blockAlign;
    return Math.round((totalSamples / sampleRate) * 1000);
  } catch {
    return estimateDuration(wavData.byteLength);
  }
}

function estimateDuration(byteLength: number): number {
  // Rough estimate: assume 48kHz, 16-bit, mono = 96000 bytes/sec
  return Math.round((byteLength / 96000) * 1000);
}
