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
/**
 * Core models required for the basic VC pipeline.
 */
export const VC_MODEL_REGISTRY: VcModelEntry[] = [
  {
    id: "contentvec",
    label: "ContentVec (HuBERT)",
    url: "https://huggingface.co/MidFord327/Hubert-Base-ONNX/resolve/main/hubert_base.onnx",
    sizeBytes: 378_000_000,
    description: "Phonetic feature extractor (768-dim, 12 layers)",
  },
  {
    id: "crepe-tiny",
    label: "CREPE Tiny",
    url: `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/vc-models/crepe-tiny.onnx`,
    sizeBytes: 1_956_000,
    description: "Pitch (F0) extraction — fast, lower accuracy",
  },
  {
    id: "rvc-v2",
    label: "RVC v2 Synthesizer",
    url: "https://huggingface.co/Cycl0/voice-changer-models/resolve/main/rvc_full.onnx",
    sizeBytes: 111_000_000,
    description: "Voice conversion synthesizer (SynthesizerTrn, NSF-HiFiGAN)",
  },
];

/** Pitch algorithm options */
export type PitchAlgorithm = "crepe-tiny" | "crepe-full" | "swiftf0" | "rmvpe";

export const PITCH_ALGORITHM_LABELS: Record<PitchAlgorithm, { ru: string; en: string; size: string }> = {
  "crepe-tiny": { ru: "CREPE Tiny (быстро)", en: "CREPE Tiny (fast)", size: "~2 MB" },
  "crepe-full": { ru: "CREPE Full (качество)", en: "CREPE Full (quality)", size: "~89 MB" },
  "swiftf0": { ru: "SwiftF0 (сверхбыстро)", en: "SwiftF0 (ultra-fast)", size: "~400 KB" },
  "rmvpe": { ru: "RMVPE (золотой стандарт)", en: "RMVPE (gold standard)", size: "~362 MB" },
};

/**
 * Optional pitch models — downloaded on demand when user selects algorithm.
 */
export const VC_PITCH_MODELS: VcModelEntry[] = [
  {
    id: "crepe-full",
    label: "CREPE Full",
    url: "https://huggingface.co/AnhP/Vietnamese-RVC-Project/resolve/main/predictors/crepe_full.onnx",
    sizeBytes: 89_000_000,
    description: "Pitch (F0) extraction — high accuracy, slower",
  },
  {
    id: "swiftf0",
    label: "SwiftF0",
    url: "https://raw.githubusercontent.com/lars76/swift-f0/main/swift_f0/model.onnx",
    sizeBytes: 398_000,
    description: "Ultra-fast pitch detector — 96K params, 42× faster than CREPE",
  },
  {
    id: "rmvpe",
    label: "RMVPE",
    url: "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.onnx",
    sizeBytes: 362_000_000,
    description: "Robust Model for Voice Pitch Estimation — best quality",
  },
];

/** All models combined (core + optional pitch) */
export const VC_ALL_MODELS: VcModelEntry[] = [...VC_MODEL_REGISTRY, ...VC_PITCH_MODELS];

const VC_CACHE_DIR = "vc-models";
export const VC_MODEL_CACHE_EVENT = "booker-pro:vc-model-cache-changed";

const LEGACY_MODEL_FILE_NAMES: Partial<Record<string, string[]>> = {
  contentvec: ["hubert_base.onnx", "hubert-base.onnx"],
  "crepe-tiny": ["crepe_tiny.onnx"],
  "crepe-full": ["crepe_full.onnx"],
  swiftf0: ["model.onnx", "swiftf0.onnx"],
  "rvc-v2": ["rvc_full.onnx", "rvc.onnx"],
  rmvpe: ["rmvpe.onnx"],
};

interface ResolvedModelFile {
  file: File;
  fileName: string;
  handle: FileSystemFileHandle;
}

export function notifyVcModelCacheChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(VC_MODEL_CACHE_EVENT));
  }
}

function getModelFileNames(entry: VcModelEntry): string[] {
  const fileNames = new Set<string>([
    `${entry.id}.onnx`,
    ...(LEGACY_MODEL_FILE_NAMES[entry.id] ?? []),
  ]);

  try {
    const baseName = new URL(entry.url).pathname.split("/").pop();
    if (baseName?.endsWith(".onnx")) {
      fileNames.add(baseName);
    }
  } catch {
    /* ignore malformed URLs */
  }

  return Array.from(fileNames);
}

async function resolveModelFile(modelId: string): Promise<ResolvedModelFile | null> {
  const dir = await getVcCacheDir();
  if (!dir) return null;

  const entry = VC_ALL_MODELS.find(model => model.id === modelId);
  if (!entry) return null;

  for (const fileName of getModelFileNames(entry)) {
    try {
      const handle = await dir.getFileHandle(fileName);
      const file = await handle.getFile();
      if (file.size > 0) {
        return { file, fileName, handle };
      }
    } catch {
      /* try next alias */
    }
  }

  return null;
}

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
  return !!(await resolveModelFile(modelId));
}

/** Get cached model as ArrayBuffer (for ort.InferenceSession.create) */
export async function readModel(modelId: string): Promise<ArrayBuffer | null> {
  const resolved = await resolveModelFile(modelId);
  return resolved ? resolved.file.arrayBuffer() : null;
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
    const blob = new Blob(chunks as unknown as BlobPart[]);

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
    notifyVcModelCacheChanged();

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
  const entries = await Promise.all(
    VC_MODEL_REGISTRY.map(async (entry) => [entry.id, await hasModel(entry.id)] as const),
  );

  return Object.fromEntries(entries);
}

/** Delete a cached model */
export async function deleteModel(modelId: string): Promise<boolean> {
  const dir = await getVcCacheDir();
  if (!dir) return false;

  const entry = VC_ALL_MODELS.find(model => model.id === modelId);
  if (!entry) return false;

  let removed = false;
  for (const fileName of getModelFileNames(entry)) {
    try {
      await dir.removeEntry(fileName);
      removed = true;
    } catch {
      /* file alias may not exist */
    }
  }

  if (removed) notifyVcModelCacheChanged();
  return removed;
}

/** Delete all cached VC models */
export async function clearAllModels(): Promise<void> {
  const dir = await getVcCacheDir();
  if (!dir) return;
  for (const entry of VC_ALL_MODELS) {
    for (const fileName of getModelFileNames(entry)) {
      try { await dir.removeEntry(fileName); } catch { /* ok */ }
    }
  }
  notifyVcModelCacheChanged();
}

/** Total size of all models in registry (bytes) */
export function getTotalModelSize(): number {
  return VC_MODEL_REGISTRY.reduce((sum, e) => sum + e.sizeBytes, 0);
}
