/**
 * VocoLoco — In-browser Whisper STT (reference transcription).
 *
 * Three size variants (user-selectable):
 *   - tiny  (~40 MB)  — fastest, lower accuracy on long/accented speech
 *   - base  (~80 MB)  — balanced, default
 *   - small (~250 MB) — best quality, recommended for tricky references
 *
 * The active size is held in module state and can be switched at runtime
 * via `setWhisperSize`. Each size has its own pipeline instance — switching
 * sizes drops the previous one (frees VRAM/RAM) without touching cache, so
 * users can keep multiple sizes warmed in browser cache.
 *
 * Storage: transformers.js caches model files under its own Cache Storage
 * namespace — we do NOT mirror them into OPFS (Whisper is auxiliary, not
 * part of the Voice Cloning critical path).
 */
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

env.allowRemoteModels = true;
env.allowLocalModels = false;

export type WhisperSize = "tiny" | "base" | "small";

interface WhisperVariant {
  modelId: string;
  approxBytes: number;
  label: string;
}

export const WHISPER_VARIANTS: Record<WhisperSize, WhisperVariant> = {
  tiny:  { modelId: "Xenova/whisper-tiny",  approxBytes:  40 * 1024 * 1024, label: "Whisper Tiny" },
  base:  { modelId: "Xenova/whisper-base",  approxBytes:  80 * 1024 * 1024, label: "Whisper Base" },
  small: { modelId: "Xenova/whisper-small", approxBytes: 250 * 1024 * 1024, label: "Whisper Small" },
};

export const WHISPER_CACHE_EVENT = "booker-pro:vocoloco-whisper-cache-changed";
export const WHISPER_SIZE_EVENT = "booker-pro:vocoloco-whisper-size-changed";

let activeSize: WhisperSize = "base";
const pipelinePromises: Partial<Record<WhisperSize, Promise<AutomaticSpeechRecognitionPipeline>>> = {};

export interface WhisperLoadProgress {
  status: string;
  file?: string;
  bytesLoaded?: number;
  bytesTotal?: number;
  fraction?: number;
}

export function getWhisperSize(): WhisperSize { return activeSize; }
export function getWhisperVariant(size: WhisperSize = activeSize): WhisperVariant {
  return WHISPER_VARIANTS[size];
}

/** Switches active size. Drops the previous in-memory pipeline (cache untouched). */
export function setWhisperSize(size: WhisperSize): void {
  if (size === activeSize) return;
  activeSize = size;
  // Free RAM/VRAM held by previously active pipeline. Cache stays.
  for (const k of Object.keys(pipelinePromises) as WhisperSize[]) {
    if (k !== size) delete pipelinePromises[k];
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WHISPER_SIZE_EVENT, { detail: size }));
  }
}

function notifyCacheChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WHISPER_CACHE_EVENT));
  }
}

/** Best-effort: any Cache Storage entry mentioning the model id. */
export async function hasWhisperCached(size: WhisperSize = activeSize): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    const modelId = WHISPER_VARIANTS[size].modelId;
    const keys = await caches.keys();
    for (const k of keys) {
      const cache = await caches.open(k);
      const reqs = await cache.keys();
      if (reqs.some((r) => r.url.includes(modelId))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Lazy-load (and warm) the active Whisper pipeline. Calls are coalesced per size. */
export function loadWhisper(
  onProgress?: (p: WhisperLoadProgress) => void,
  size: WhisperSize = activeSize,
): Promise<AutomaticSpeechRecognitionPipeline> {
  const cached = pipelinePromises[size];
  if (cached) return cached;
  const modelId = WHISPER_VARIANTS[size].modelId;
  const promise = (async () => {
    try {
      const pipe = await pipeline(
        "automatic-speech-recognition",
        modelId,
        {
          device: "webgpu" as any,
          progress_callback: (p: any) => {
            if (!onProgress) return;
            const fraction =
              typeof p?.progress === "number" ? p.progress / 100 :
              typeof p?.loaded === "number" && typeof p?.total === "number" && p.total > 0
                ? p.loaded / p.total
                : undefined;
            onProgress({
              status: String(p?.status ?? "progress"),
              file: p?.file,
              bytesLoaded: p?.loaded,
              bytesTotal: p?.total,
              fraction,
            });
          },
        } as any,
      );
      notifyCacheChanged();
      return pipe as AutomaticSpeechRecognitionPipeline;
    } catch (err) {
      delete pipelinePromises[size];
      throw err;
    }
  })();
  pipelinePromises[size] = promise;
  return promise;
}

/** Transcribe an audio Blob using the active Whisper size. */
export async function transcribeBlob(
  blob: Blob,
  language: "ru" | "en" | "auto" = "auto",
): Promise<string> {
  const pipe = await loadWhisper();
  const samples = await blobToMono16k(blob);
  const opts: Record<string, unknown> = { chunk_length_s: 30, stride_length_s: 5 };
  if (language !== "auto") {
    opts.language = language === "ru" ? "russian" : "english";
    opts.task = "transcribe";
  }
  const out = await (pipe as any)(samples, opts);
  if (Array.isArray(out)) {
    return out.map((x) => x?.text ?? "").join(" ").trim();
  }
  return String(out?.text ?? "").trim();
}

async function blobToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuf = await blob.arrayBuffer();
  const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    const channelData = decoded.numberOfChannels > 1
      ? mergeChannels(decoded)
      : decoded.getChannelData(0).slice();
    if (decoded.sampleRate === 16000) return channelData;
    return resampleLinear(channelData, decoded.sampleRate, 16000);
  } finally {
    try { await ctx.close(); } catch { /* ignore */ }
  }
}

function mergeChannels(buffer: AudioBuffer): Float32Array {
  const len = buffer.length;
  const out = new Float32Array(len);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) out[i] += data[i];
  }
  const inv = 1 / buffer.numberOfChannels;
  for (let i = 0; i < len; i++) out[i] *= inv;
  return out;
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = src - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

/** Drops in-memory pipeline for the given size (or all). Cache untouched. */
export function releaseWhisper(size?: WhisperSize): void {
  if (size) delete pipelinePromises[size];
  else for (const k of Object.keys(pipelinePromises) as WhisperSize[]) delete pipelinePromises[k];
}

/** Deletes Cache Storage entries for the given size (default: active). */
export async function clearWhisperCache(size: WhisperSize = activeSize): Promise<void> {
  releaseWhisper(size);
  try {
    if (typeof caches === "undefined") return;
    const modelId = WHISPER_VARIANTS[size].modelId;
    const keys = await caches.keys();
    for (const k of keys) {
      const cache = await caches.open(k);
      const reqs = await cache.keys();
      for (const r of reqs) {
        if (r.url.includes(modelId)) {
          await cache.delete(r);
        }
      }
    }
    notifyCacheChanged();
  } catch (err) {
    console.warn("[whisperStt] clearCache failed:", err);
  }
}
