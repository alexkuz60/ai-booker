/**
 * f5tts/modelRegistry.ts — F5-TTS ONNX model registry.
 *
 * Models are stored in the SAME flat vc-models/ directory as RVC models,
 * using f5tts-prefixed IDs. This lets vcModelCache.readModel() resolve them
 * and ensureVcSession() load them without changes.
 */
import type { F5ModelEntry, F5ModelId } from "./types";
import { downloadModel as downloadVcModel, hasModel, type ProgressCallback, type VcModelEntry } from "../vcModelCache";

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

/**
 * Convert F5ModelEntry to VcModelEntry for download compatibility.
 */
function toVcEntry(entry: F5ModelEntry): VcModelEntry {
  return {
    id: entry.id,
    label: entry.label,
    url: entry.url,
    sizeBytes: entry.sizeBytes,
    description: entry.description,
  };
}

/** Check if a specific model is cached */
export async function isF5ModelCached(modelId: F5ModelId): Promise<boolean> {
  return hasModel(modelId);
}

/** Get status of all F5-TTS models */
export async function getF5ModelStatus(): Promise<Record<F5ModelId, boolean>> {
  const result: Record<string, boolean> = {};
  for (const entry of F5_MODEL_REGISTRY) {
    result[entry.id] = await hasModel(entry.id);
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
  progress: number;
  bytesLoaded: number;
  bytesTotal: number;
}

/** Download a single F5-TTS model (uses vcModelCache download infrastructure) */
export async function downloadF5Model(
  modelId: F5ModelId,
  onProgress?: (p: F5DownloadProgress) => void,
): Promise<void> {
  const entry = F5_MODEL_REGISTRY.find((m) => m.id === modelId);
  if (!entry) throw new Error(`Unknown F5-TTS model: ${modelId}`);

  const cb: ProgressCallback | undefined = onProgress
    ? (p) => onProgress({
        modelId: entry.id as F5ModelId,
        label: entry.label,
        progress: p.fraction,
        bytesLoaded: p.bytesLoaded,
        bytesTotal: p.bytesTotal,
      })
    : undefined;

  const ok = await downloadVcModel(toVcEntry(entry), cb);
  if (!ok) throw new Error(`Failed to download F5-TTS model: ${entry.label}`);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(F5_MODEL_CACHE_EVENT));
  }
}

/** Download all 3 models sequentially */
export async function downloadAllF5Models(
  onProgress?: (p: F5DownloadProgress) => void,
): Promise<void> {
  for (const entry of F5_MODEL_REGISTRY) {
    if (await hasModel(entry.id)) continue;
    await downloadF5Model(entry.id as F5ModelId, onProgress);
  }
}

/** Delete a cached model */
export async function deleteF5Model(modelId: F5ModelId): Promise<void> {
  // Use the deleteModel from vcModelCache
  const { deleteModel } = await import("../vcModelCache");
  await deleteModel(modelId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(F5_MODEL_CACHE_EVENT));
  }
}
