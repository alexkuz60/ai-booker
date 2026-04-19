/**
 * VocoLoco — OPFS model cache.
 *
 * Mirrors vcModelCache.ts pattern but uses a separate `vocoloco-models/`
 * directory so VC and VocoLoco never share/collide on file handles.
 */
import { VOCOLOCO_ALL_MODELS, type VocoLocoModelEntry } from "./modelRegistry";

const VOCOLOCO_CACHE_DIR = "vocoloco-models";
export const VOCOLOCO_MODEL_CACHE_EVENT = "booker-pro:vocoloco-model-cache-changed";

let persistenceRequested = false;

async function requestPersistence(): Promise<void> {
  if (persistenceRequested) return;
  persistenceRequested = true;
  try {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      console.info(`[vocoloco/modelCache] Persistent storage ${granted ? "granted" : "denied"}`);
    }
  } catch { /* ignore */ }
}

async function getCacheDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(VOCOLOCO_CACHE_DIR, { create: true });
  } catch (e) {
    console.warn("[vocoloco/modelCache] Cannot open OPFS cache dir:", e);
    return null;
  }
}

export function notifyVocoLocoCacheChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(VOCOLOCO_MODEL_CACHE_EVENT));
  }
}

export interface VocoLocoDownloadProgress {
  modelId: string;
  label: string;
  bytesLoaded: number;
  bytesTotal: number;
  fraction: number;
  phase: "downloading" | "writing" | "done" | "error";
  error?: string;
}

export type VocoLocoProgressCallback = (p: VocoLocoDownloadProgress) => void;

function fileNameFor(entry: VocoLocoModelEntry): string {
  return `${entry.id}.onnx`;
}

export async function hasVocoLocoModel(modelId: string): Promise<boolean> {
  const dir = await getCacheDir();
  if (!dir) return false;
  const entry = VOCOLOCO_ALL_MODELS.find((m) => m.id === modelId);
  if (!entry) return false;
  try {
    const handle = await dir.getFileHandle(fileNameFor(entry));
    const file = await handle.getFile();
    return file.size > 0;
  } catch {
    return false;
  }
}

export async function readVocoLocoModel(modelId: string): Promise<ArrayBuffer | null> {
  const dir = await getCacheDir();
  if (!dir) return null;
  const entry = VOCOLOCO_ALL_MODELS.find((m) => m.id === modelId);
  if (!entry) return null;
  try {
    const handle = await dir.getFileHandle(fileNameFor(entry));
    const file = await handle.getFile();
    return file.size > 0 ? file.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export async function downloadVocoLocoModel(
  entry: VocoLocoModelEntry,
  onProgress?: VocoLocoProgressCallback,
  signal?: AbortSignal,
): Promise<boolean> {
  await requestPersistence();
  const dir = await getCacheDir();
  if (!dir) {
    onProgress?.({
      modelId: entry.id, label: entry.label,
      bytesLoaded: 0, bytesTotal: entry.sizeBytes,
      fraction: 0, phase: "error", error: "OPFS unavailable",
    });
    return false;
  }

  try {
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

    const blob = new Blob(chunks as unknown as BlobPart[]);

    onProgress?.({
      modelId: entry.id, label: entry.label,
      bytesLoaded: loaded, bytesTotal: contentLength,
      fraction: 1, phase: "writing",
    });

    const fh = await dir.getFileHandle(fileNameFor(entry), { create: true });
    const writable = await fh.createWritable();
    await writable.write(blob);
    await writable.close();
    notifyVocoLocoCacheChanged();

    onProgress?.({
      modelId: entry.id, label: entry.label,
      bytesLoaded: loaded, bytesTotal: contentLength,
      fraction: 1, phase: "done",
    });

    console.info(`[vocoloco/modelCache] Cached ${entry.id} (${(loaded / 1e6).toFixed(1)} MB)`);
    return true;
  } catch (e: any) {
    if (e.name === "AbortError") return false;
    console.error(`[vocoloco/modelCache] Download failed for ${entry.id}:`, e);
    onProgress?.({
      modelId: entry.id, label: entry.label,
      bytesLoaded: 0, bytesTotal: entry.sizeBytes,
      fraction: 0, phase: "error", error: e.message,
    });
    return false;
  }
}

export async function getVocoLocoStatus(): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    VOCOLOCO_ALL_MODELS.map(async (entry) => [entry.id, await hasVocoLocoModel(entry.id)] as const),
  );
  return Object.fromEntries(entries);
}

export async function deleteVocoLocoModel(modelId: string): Promise<boolean> {
  const dir = await getCacheDir();
  if (!dir) return false;
  const entry = VOCOLOCO_ALL_MODELS.find((m) => m.id === modelId);
  if (!entry) return false;
  try {
    await dir.removeEntry(fileNameFor(entry));
    notifyVocoLocoCacheChanged();
    return true;
  } catch {
    return false;
  }
}

export async function clearAllVocoLocoModels(): Promise<void> {
  const dir = await getCacheDir();
  if (!dir) return;
  for (const entry of VOCOLOCO_ALL_MODELS) {
    try { await dir.removeEntry(fileNameFor(entry)); } catch { /* ok */ }
  }
  notifyVocoLocoCacheChanged();
}
