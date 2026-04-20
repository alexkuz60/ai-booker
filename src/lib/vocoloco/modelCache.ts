/**
 * VocoLoco — OPFS model cache.
 *
 * Mirrors vcModelCache.ts pattern but uses a separate `vocoloco-models/`
 * directory so VC and VocoLoco never share/collide on file handles.
 *
 * **External data files**: when an entry declares `externalDataUrl`
 * (e.g. for the LLM where the .onnx is just a graph and weights live in
 * a sidecar `.onnx_data`), the downloader fetches BOTH files in sequence,
 * writes both into OPFS, and treats the pair as one logical model.
 * `hasVocoLocoModel()` returns true only when both files are present.
 */
import { VOCOLOCO_ALL_MODELS, totalModelBytes, type VocoLocoModelEntry } from "./modelRegistry";

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
  /** Which sub-file is being processed (graph vs weights). */
  part?: "graph" | "weights";
  error?: string;
}

export type VocoLocoProgressCallback = (p: VocoLocoDownloadProgress) => void;

function graphFileName(entry: VocoLocoModelEntry): string {
  return `${entry.id}.onnx`;
}

/**
 * External data file name kept WITHOUT the model id prefix because ORT-Web
 * resolves external data references by the literal name embedded in the
 * .onnx graph (e.g. `omnivoice.qint8_per_channel.onnx_data`). We mirror
 * the upstream filename so the worker can register it under that exact key
 * via `externalData: [{ path: <thisName>, data }]`.
 */
function externalDataFileName(entry: VocoLocoModelEntry): string | null {
  if (!entry.externalDataUrl) return null;
  const url = entry.externalDataUrl;
  const last = url.split("/").pop() ?? "";
  return last || null;
}

export function getExternalDataFileName(entry: VocoLocoModelEntry): string | null {
  return externalDataFileName(entry);
}

/**
 * Fetch a remote file into OPFS with automatic retries on transient network
 * failures. HuggingFace's CDN occasionally drops connections mid-stream for
 * large files (>100 MB), so each attempt restarts from scratch with the same
 * file handle being recreated. We do NOT use HTTP Range resume because not
 * every CDN edge supports it consistently — restart is simpler and reliable.
 *
 * Retries: up to 3 attempts, with 1.5s / 4s backoff. AbortSignal short-circuits
 * the loop immediately.
 */
async function fetchToOPFS(
  dir: FileSystemDirectoryHandle,
  url: string,
  fileName: string,
  expectedSize: number,
  signal: AbortSignal | undefined,
  onChunk: (loaded: number, total: number) => void,
): Promise<number> {
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [1500, 4000];
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const resp = await fetch(url, { signal, cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${url}`);
      const contentLength = Number(resp.headers.get("content-length")) || expectedSize;
      const reader = resp.body?.getReader();
      if (!reader) throw new Error(`No readable body for ${url}`);

      const fh = await dir.getFileHandle(fileName, { create: true });
      const writable = await fh.createWritable();
      let loaded = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writable.write(value);
          loaded += value.byteLength;
          onChunk(loaded, contentLength);
        }
        await writable.close();
      } catch (e) {
        try { await writable.abort(); } catch { /* ignore */ }
        try { reader.cancel(); } catch { /* ignore */ }
        throw e;
      }
      return loaded;
    } catch (e: any) {
      lastError = e;
      // User-initiated abort — bubble up immediately, no retry.
      if (e?.name === "AbortError" || signal?.aborted) throw e;
      const isLast = attempt === MAX_ATTEMPTS;
      console.warn(
        `[vocoloco/modelCache] Fetch attempt ${attempt}/${MAX_ATTEMPTS} for ${fileName} failed: ${e?.message ?? e}` +
        (isLast ? " — giving up" : ` — retrying in ${BACKOFF_MS[attempt - 1]}ms`),
      );
      if (isLast) break;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, BACKOFF_MS[attempt - 1]);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Fetch of ${fileName} failed after ${MAX_ATTEMPTS} attempts`);
}

export async function hasVocoLocoModel(modelId: string): Promise<boolean> {
  const dir = await getCacheDir();
  if (!dir) return false;
  const entry = VOCOLOCO_ALL_MODELS.find((m) => m.id === modelId);
  if (!entry) return false;
  try {
    const handle = await dir.getFileHandle(graphFileName(entry));
    const file = await handle.getFile();
    if (file.size === 0) return false;

    const dataName = externalDataFileName(entry);
    if (dataName) {
      const dh = await dir.getFileHandle(dataName);
      const df = await dh.getFile();
      if (df.size === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Read the .onnx graph file — small for external-data models. */
export async function readVocoLocoModel(modelId: string): Promise<ArrayBuffer | null> {
  const dir = await getCacheDir();
  if (!dir) return null;
  const entry = VOCOLOCO_ALL_MODELS.find((m) => m.id === modelId);
  if (!entry) return null;
  try {
    const handle = await dir.getFileHandle(graphFileName(entry));
    const file = await handle.getFile();
    return file.size > 0 ? file.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/**
 * Read the external data file alongside an .onnx graph (if any).
 * Returns null when the model has no external data or when the file is missing.
 */
export async function readVocoLocoExternalData(
  modelId: string,
): Promise<{ name: string; buffer: ArrayBuffer } | null> {
  const dir = await getCacheDir();
  if (!dir) return null;
  const entry = VOCOLOCO_ALL_MODELS.find((m) => m.id === modelId);
  if (!entry) return null;
  const name = externalDataFileName(entry);
  if (!name) return null;
  try {
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    if (file.size === 0) return null;
    return { name, buffer: await file.arrayBuffer() };
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
      bytesLoaded: 0, bytesTotal: totalModelBytes(entry),
      fraction: 0, phase: "error", error: "OPFS unavailable",
    });
    return false;
  }

  const total = totalModelBytes(entry);
  const dataName = externalDataFileName(entry);
  let loadedAcc = 0;

  const emit = (phase: VocoLocoDownloadProgress["phase"], part: "graph" | "weights", localLoaded: number, localTotal: number) => {
    const overall = loadedAcc + localLoaded;
    onProgress?.({
      modelId: entry.id, label: entry.label,
      bytesLoaded: overall, bytesTotal: total,
      fraction: total > 0 ? Math.min(overall / total, 1) : 0,
      phase, part,
    });
  };

  try {
    // 1) graph .onnx
    console.info(`[vocoloco/modelCache] ${entry.id}: fetching graph from ${entry.url}`);
    const graphLoaded = await fetchToOPFS(
      dir,
      entry.url,
      graphFileName(entry),
      entry.sizeBytes,
      signal,
      (loaded, totalLocal) => emit("downloading", "graph", loaded, totalLocal),
    );
    loadedAcc += graphLoaded;
    console.info(`[vocoloco/modelCache] ${entry.id}: graph done (${(graphLoaded / 1e6).toFixed(2)} MB)`);

    // 2) optional .onnx_data
    if (dataName && entry.externalDataUrl) {
      console.info(`[vocoloco/modelCache] ${entry.id}: fetching weights "${dataName}" from ${entry.externalDataUrl}`);
      // Reset progress to weights phase explicitly so UI doesn't appear stuck.
      emit("downloading", "weights", 0, entry.externalDataSize ?? 0);
      const dataLoaded = await fetchToOPFS(
        dir,
        entry.externalDataUrl,
        dataName,
        entry.externalDataSize ?? 0,
        signal,
        (loaded, totalLocal) => emit("downloading", "weights", loaded, totalLocal),
      );
      loadedAcc += dataLoaded;
      console.info(`[vocoloco/modelCache] ${entry.id}: weights done (${(dataLoaded / 1e6).toFixed(2)} MB)`);
      if (dataLoaded < (entry.externalDataSize ?? 0) * 0.9) {
        throw new Error(
          `External data file "${dataName}" downloaded only ${dataLoaded} bytes ` +
          `(expected ~${entry.externalDataSize}). Network interrupted?`,
        );
      }
    }

    onProgress?.({
      modelId: entry.id, label: entry.label,
      bytesLoaded: loadedAcc, bytesTotal: total,
      fraction: 1, phase: "writing",
    });

    // Post-download integrity check — both files must be readable from OPFS.
    // Catches: silent OPFS write failures, quota exhaustion, or registry
    // updates where externalDataUrl was added after the user already cached
    // the .onnx-only graph from a previous app version.
    const verified = await hasVocoLocoModel(entry.id);
    if (!verified) {
      throw new Error(
        `OPFS verification failed for "${entry.id}" after download` +
        (dataName ? ` (expected ${graphFileName(entry)} + ${dataName})` : "") +
        `. Check available disk space (need ${(total / 1e9).toFixed(1)} GB) and retry.`,
      );
    }

    notifyVocoLocoCacheChanged();
    onProgress?.({
      modelId: entry.id, label: entry.label,
      bytesLoaded: loadedAcc, bytesTotal: total,
      fraction: 1, phase: "done",
    });

    console.info(
      `[vocoloco/modelCache] Cached ${entry.id}` +
      (dataName ? ` (graph + ${dataName})` : "") +
      ` total ${(loadedAcc / 1e6).toFixed(1)} MB`,
    );
    return true;
  } catch (e: any) {
    if (e?.name === "AbortError") return false;
    console.error(`[vocoloco/modelCache] Download failed for ${entry.id}:`, e);
    onProgress?.({
      modelId: entry.id, label: entry.label,
      bytesLoaded: loadedAcc, bytesTotal: total,
      fraction: 0, phase: "error", error: e?.message ?? String(e),
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
  let any = false;
  try {
    await dir.removeEntry(graphFileName(entry));
    any = true;
  } catch { /* ignore */ }
  const dataName = externalDataFileName(entry);
  if (dataName) {
    try {
      await dir.removeEntry(dataName);
      any = true;
    } catch { /* ignore */ }
  }
  if (any) notifyVocoLocoCacheChanged();
  return any;
}

export async function clearAllVocoLocoModels(): Promise<void> {
  const dir = await getCacheDir();
  if (!dir) return;
  for (const entry of VOCOLOCO_ALL_MODELS) {
    try { await dir.removeEntry(graphFileName(entry)); } catch { /* ok */ }
    const dataName = externalDataFileName(entry);
    if (dataName) {
      try { await dir.removeEntry(dataName); } catch { /* ok */ }
    }
  }
  notifyVocoLocoCacheChanged();
}
