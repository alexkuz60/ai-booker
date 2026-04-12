/**
 * vcModelCache.ts — Global OPFS cache for Voice Conversion ONNX models.
 * Stores models in a dedicated `vc-models/` directory in the browser's OPFS,
 * separate from per-project storage. Models persist across sessions.
 *
 * Architecture: analogous to audioAssetCache.ts (atmo-cache/).
 */

/** Model registry — canonical source of model URLs and metadata */
export interface VcModelEntry {
  id: string;
  /** Display name */
  label: string;
  /** Remote URL (HuggingFace CDN) */
  url: string;
  /** Expected file size in bytes (approximate, for progress) */
  sizeBytes: number;
  /** ONNX opset or description */
  description: string;
}

/**
 * Models required for the full VC pipeline.
 * ContentVec extracts phonetic embeddings; CREPE extracts pitch;
 * RVC converts timbre; OpenVoice transfers style/energy.
 */
export const VC_MODEL_REGISTRY: VcModelEntry[] = [
  {
    id: "contentvec",
    label: "ContentVec (HuBERT)",
    url: "https://huggingface.co/MidFord327/Hubert-Base-ONNX/resolve/main/hubert_base.onnx",
    sizeBytes: 94_000_000,
    description: "Phonetic feature extractor (768-dim, 12 layers)",
  },
  {
    id: "crepe-tiny",
    label: "CREPE Tiny",
    url: "https://huggingface.co/phineas-gage/CREPE-ONNX/resolve/main/crepe_tiny.onnx",
    sizeBytes: 8_000_000,
    description: "Pitch (F0) extraction model",
  },
  // RVC and OpenVoice models will be added in Étape 3-4
  // when we have verified ONNX exports available on CDN.
];

const VC_CACHE_DIR = "vc-models";

// ---------- OPFS directory helpers ----------

async function getVcCacheDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(VC_CACHE_DIR, { create: true });
  } catch (e) {
    console.warn("[vcModelCache] Cannot open OPFS cache dir:", e);
    return null;
  }
}

// ---------- Progress callback ----------

export interface ModelDownloadProgress {
  modelId: string;
  label: string;
  bytesLoaded: number;
  bytesTotal: number;
  /** 0..1 */
  fraction: number;
  phase: "downloading" | "writing" | "done" | "error";
  error?: string;
}

export type ProgressCallback = (progress: ModelDownloadProgress) => void;

// ---------- Public API ----------

/** Check if a model is already cached in OPFS */
export async function hasModel(modelId: string): Promise<boolean> {
  const dir = await getVcCacheDir();
  if (!dir) return false;
  try {
    await dir.getFileHandle(`${modelId}.onnx`);
    return true;
  } catch {
    return false;
  }
}

/** Get cached model as ArrayBuffer (for ort.InferenceSession.create) */
export async function readModel(modelId: string): Promise<ArrayBuffer | null> {
  const dir = await getVcCacheDir();
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(`${modelId}.onnx`);
    const file = await fh.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

/** Download a model from remote URL and cache it in OPFS */
export async function downloadModel(
  entry: VcModelEntry,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<boolean> {
  const dir = await getVcCacheDir();
  if (!dir) {
    onProgress?.({
      modelId: entry.id, label: entry.label,
      bytesLoaded: 0, bytesTotal: entry.sizeBytes,
      fraction: 0, phase: "error", error: "OPFS unavailable",
    });
    return false;
  }

  try {
    // Fetch with streaming progress
    const resp = await fetch(entry.url, { signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const contentLength = Number(resp.headers.get("content-length")) || entry.sizeBytes;
    const reader = resp.body?.getReader();
    if (!reader) throw new Error("No readable body");

    const chunks: Uint8Array[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({
        modelId: entry.id, label: entry.label,
        bytesLoaded: loaded, bytesTotal: contentLength,
        fraction: Math.min(loaded / contentLength, 1),
        phase: "downloading",
      });
    }

    // Merge chunks
    const blob = new Blob(chunks);

    // Write to OPFS
    onProgress?.({
      modelId: entry.id, label: entry.label,
      bytesLoaded: loaded, bytesTotal: contentLength,
      fraction: 1, phase: "writing",
    });

    const fh = await dir.getFileHandle(`${entry.id}.onnx`, { create: true });
    const writable = await fh.createWritable();
    await writable.write(blob);
    await writable.close();

    onProgress?.({
      modelId: entry.id, label: entry.label,
      bytesLoaded: loaded, bytesTotal: contentLength,
      fraction: 1, phase: "done",
    });

    console.info(`[vcModelCache] Cached ${entry.id} (${(loaded / 1e6).toFixed(1)} MB)`);
    return true;
  } catch (e: any) {
    if (e.name === "AbortError") return false;
    console.error(`[vcModelCache] Download failed for ${entry.id}:`, e);
    onProgress?.({
      modelId: entry.id, label: entry.label,
      bytesLoaded: 0, bytesTotal: entry.sizeBytes,
      fraction: 0, phase: "error", error: e.message,
    });
    return false;
  }
}

/** Download all models that aren't cached yet */
export async function downloadAllModels(
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<boolean> {
  for (const entry of VC_MODEL_REGISTRY) {
    if (signal?.aborted) return false;
    const cached = await hasModel(entry.id);
    if (cached) {
      onProgress?.({
        modelId: entry.id, label: entry.label,
        bytesLoaded: entry.sizeBytes, bytesTotal: entry.sizeBytes,
        fraction: 1, phase: "done",
      });
      continue;
    }
    const ok = await downloadModel(entry, onProgress, signal);
    if (!ok) return false;
  }
  return true;
}

/** Check which models are already cached */
export async function getModelStatus(): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  for (const entry of VC_MODEL_REGISTRY) {
    result[entry.id] = await hasModel(entry.id);
  }
  return result;
}

/** Delete a cached model */
export async function deleteModel(modelId: string): Promise<boolean> {
  const dir = await getVcCacheDir();
  if (!dir) return false;
  try {
    await dir.removeEntry(`${modelId}.onnx`);
    return true;
  } catch {
    return false;
  }
}

/** Delete all cached VC models */
export async function clearAllModels(): Promise<void> {
  const dir = await getVcCacheDir();
  if (!dir) return;
  for (const entry of VC_MODEL_REGISTRY) {
    try { await dir.removeEntry(`${entry.id}.onnx`); } catch { /* ok */ }
  }
}

/** Total size of all models in registry (bytes) */
export function getTotalModelSize(): number {
  return VC_MODEL_REGISTRY.reduce((sum, e) => sum + e.sizeBytes, 0);
}
