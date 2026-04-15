/**
 * f5tts/modelRegistry.ts — F5-TTS ONNX model registry and OPFS cache.
 *
 * Models stored in vc-models/f5tts/ subdirectory of OPFS.
 * Reuses the persistence/download patterns from vcModelCache.ts.
 */
import type { F5ModelEntry, F5ModelId } from "./types";

/** F5-TTS model registry */
export const F5_MODEL_REGISTRY: F5ModelEntry[] = [
  {
    id: "f5tts-encoder",
    label: "F5-TTS Encoder",
    url: "https://huggingface.co/nsarang/F5-TTS-ONNX/resolve/main/encoder_fp32.onnx",
    sizeBytes: 2_500_000,
    description: "Preprocessor: audio + text → latent tensors",
  },
  {
    id: "f5tts-transformer",
    label: "F5-TTS Transformer (FP16)",
    url: "https://huggingface.co/nsarang/F5-TTS-ONNX/resolve/main/transformer_fp16.onnx",
    sizeBytes: 200_000_000,
    description: "Flow-matching denoiser — iterative NFE loop",
  },
  {
    id: "f5tts-decoder",
    label: "F5-TTS Decoder",
    url: "https://huggingface.co/nsarang/F5-TTS-ONNX/resolve/main/decoder_fp32.onnx",
    sizeBytes: 5_000_000,
    description: "Mel → waveform vocoder (24kHz)",
  },
];

export const F5_MODEL_CACHE_EVENT = "booker-pro:f5tts-model-cache-changed";

const F5_CACHE_DIR = "vc-models";
const F5_SUBDIR = "f5tts";

function notifyChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(F5_MODEL_CACHE_EVENT));
  }
}

async function getF5CacheDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const vcDir = await root.getDirectoryHandle(F5_CACHE_DIR, { create: true });
    return vcDir.getDirectoryHandle(F5_SUBDIR, { create: true });
  } catch {
    return null;
  }
}

/** Check if a specific model is cached */
export async function isF5ModelCached(modelId: F5ModelId): Promise<boolean> {
  const dir = await getF5CacheDir();
  if (!dir) return false;
  try {
    const handle = await dir.getFileHandle(`${modelId}.onnx`);
    const file = await handle.getFile();
    return file.size > 0;
  } catch {
    return false;
  }
}

/** Get status of all F5-TTS models */
export async function getF5ModelStatus(): Promise<Record<F5ModelId, boolean>> {
  const result: Record<string, boolean> = {};
  for (const entry of F5_MODEL_REGISTRY) {
    result[entry.id] = await isF5ModelCached(entry.id);
  }
  return result as Record<F5ModelId, boolean>;
}

/** Check if all 3 models are cached */
export async function areF5ModelsReady(): Promise<boolean> {
  const status = await getF5ModelStatus();
  return Object.values(status).every(Boolean);
}

export interface F5DownloadProgress {
  modelId: F5ModelId;
  label: string;
  progress: number; // 0..1
  bytesLoaded: number;
  bytesTotal: number;
}

/** Download a single F5-TTS model */
export async function downloadF5Model(
  modelId: F5ModelId,
  onProgress?: (p: F5DownloadProgress) => void,
): Promise<void> {
  const entry = F5_MODEL_REGISTRY.find((m) => m.id === modelId);
  if (!entry) throw new Error(`Unknown F5-TTS model: ${modelId}`);

  const dir = await getF5CacheDir();
  if (!dir) throw new Error("OPFS unavailable for F5-TTS model cache");

  // Request persistent storage
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch { /* OK */ }

  const resp = await fetch(entry.url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);

  const total = parseInt(resp.headers.get("content-length") ?? "0", 10) || entry.sizeBytes;
  const reader = resp.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({
      modelId: entry.id,
      label: entry.label,
      progress: Math.min(loaded / total, 1),
      bytesLoaded: loaded,
      bytesTotal: total,
    });
  }

  // Write to OPFS
  const blob = new Blob(chunks);
  const handle = await dir.getFileHandle(`${modelId}.onnx`, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();

  console.info(`[f5tts] Model "${entry.label}" cached (${(loaded / 1e6).toFixed(1)} MB)`);
  notifyChanged();
}

/** Download all 3 models sequentially */
export async function downloadAllF5Models(
  onProgress?: (p: F5DownloadProgress) => void,
): Promise<void> {
  for (const entry of F5_MODEL_REGISTRY) {
    if (await isF5ModelCached(entry.id)) continue;
    await downloadF5Model(entry.id, onProgress);
  }
}

/** Read model bytes from OPFS cache */
export async function readF5Model(modelId: F5ModelId): Promise<ArrayBuffer> {
  const dir = await getF5CacheDir();
  if (!dir) throw new Error("OPFS unavailable");
  try {
    const handle = await dir.getFileHandle(`${modelId}.onnx`);
    const file = await handle.getFile();
    return file.arrayBuffer();
  } catch {
    throw new Error(`F5-TTS model "${modelId}" not cached. Download it first.`);
  }
}

/** Delete a cached model */
export async function deleteF5Model(modelId: F5ModelId): Promise<void> {
  const dir = await getF5CacheDir();
  if (!dir) return;
  try {
    await dir.removeEntry(`${modelId}.onnx`);
    console.info(`[f5tts] Model "${modelId}" deleted from cache`);
    notifyChanged();
  } catch { /* not found — OK */ }
}
