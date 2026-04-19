/**
 * VocoLoco — In-browser Whisper STT (reference transcription).
 *
 * Uses @huggingface/transformers (Xenova) `automatic-speech-recognition`
 * pipeline with `Xenova/whisper-base` (~80 MB encoder + decoder ONNX).
 *
 * Storage: transformers.js caches model files in IndexedDB under its own
 * cache namespace — we do NOT mirror them into OPFS because:
 *   1. transformers.js owns the file layout and validation, mixing it with
 *      OPFS would require reimplementing its loader.
 *   2. Whisper is auxiliary (not part of the Voice Cloning critical path),
 *      so independent cache lifecycle is acceptable.
 *
 * Public API:
 *   - hasWhisperCached() → best-effort check via `caches`/IDB presence
 *   - loadWhisper(onProgress?) → warms the pipeline, idempotent
 *   - transcribeBlob(blob, lang?) → string
 *   - releaseWhisper() → drops the in-memory pipeline (does NOT clear cache)
 *   - clearWhisperCache() → wipes IDB entries for the model
 *
 * The pipeline is single-instance per page — concurrent callers share the
 * same warm-up promise.
 */
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

env.allowRemoteModels = true;
env.allowLocalModels = false;

const WHISPER_MODEL_ID = "Xenova/whisper-base";
export const WHISPER_APPROX_BYTES = 80 * 1024 * 1024; // ~80 MB across encoder/decoder
export const WHISPER_CACHE_EVENT = "booker-pro:vocoloco-whisper-cache-changed";

export interface WhisperLoadProgress {
  /** transformers.js raw status: 'initiate' | 'download' | 'progress' | 'done' | 'ready' */
  status: string;
  /** File being fetched (e.g. encoder_model_quantized.onnx) */
  file?: string;
  bytesLoaded?: number;
  bytesTotal?: number;
  /** Aggregated 0..1 across files when computable */
  fraction?: number;
}

let pipelinePromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function notifyCacheChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WHISPER_CACHE_EVENT));
  }
}

/**
 * Best-effort cache probe — transformers.js v4 stores files in the Cache
 * Storage API under the host name. We check whether ANY entry mentions
 * the Whisper model id. Returns false on any error (treat as "not cached").
 */
export async function hasWhisperCached(): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    const keys = await caches.keys();
    for (const k of keys) {
      const cache = await caches.open(k);
      const reqs = await cache.keys();
      if (reqs.some((r) => r.url.includes(WHISPER_MODEL_ID))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Lazy-load (and warm) the Whisper pipeline. Calls are coalesced — the second
 * caller awaits the first one. On failure the promise is reset so retries
 * actually re-attempt loading.
 */
export function loadWhisper(
  onProgress?: (p: WhisperLoadProgress) => void,
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    try {
      const pipe = await pipeline(
        "automatic-speech-recognition",
        WHISPER_MODEL_ID,
        {
          // CPU (WASM) backend — WebGPU EP в ORT-Web падает на decoder Whisper
          // с "Invalid buffer" в Download() из buffer_manager.cc (известный баг
          // ORT-Web 1.x при mapAsync для динамических буферов decoder loop).
          // dtype: "fp32" форсируем — на WASM по умолчанию transformers.js берёт
          // q8 quantized whisper-base, который ломается на decoder с
          // "Missing required scale model.decoder.embed_tokens.weight_merged_0_scale"
          // (qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits). FP32 = ~290MB,
          // но это единственный вариант, который грузится без ошибок QDQ.
          device: "wasm" as any,
          dtype: "fp32" as any,
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
      pipelinePromise = null;
      throw err;
    }
  })();
  return pipelinePromise;
}

/**
 * Transcribe an audio Blob (any format the browser can decode) into text.
 * Decodes via WebAudio at 16 kHz mono — Whisper's required input.
 */
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

export function releaseWhisper(): void {
  pipelinePromise = null;
}

/** Deletes Cache Storage entries that include the Whisper model id. */
export async function clearWhisperCache(): Promise<void> {
  releaseWhisper();
  try {
    if (typeof caches === "undefined") return;
    const keys = await caches.keys();
    for (const k of keys) {
      const cache = await caches.open(k);
      const reqs = await cache.keys();
      for (const r of reqs) {
        if (r.url.includes(WHISPER_MODEL_ID)) {
          await cache.delete(r);
        }
      }
    }
    notifyCacheChanged();
  } catch (err) {
    console.warn("[whisperStt] clearCache failed:", err);
  }
}
