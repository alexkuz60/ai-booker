/**
 * vcInferenceSession.ts — Worker-proxied ONNX Runtime session manager.
 *
 * All ORT sessions run inside a Web Worker (vcOrtWorker.ts).
 * GPU memory (WebGPU buffers, shader caches) is owned by the worker.
 * `releaseAllVcSessions()` terminates the worker — the ONLY reliable
 * way to reclaim VRAM in Firefox and Chromium where `session.release()`
 * does not free GPU memory.
 *
 * Public API:
 *   ensureVcSession(modelId)  — create/cache session in worker
 *   runVcInference(modelId, feeds) — run inference in worker
 *   releaseVcSession(modelId) — release one session
 *   releaseAllVcSessions()    — TERMINATE worker (frees all VRAM)
 */
import { readModel } from "./vcModelCache";
import { getSharedAdapter } from "./webgpuAdapter";

// ── Types ───────────────────────────────────────────────────────────────

export type VcBackend = "webgpu" | "wasm";

export interface VcSessionOptions {
  /** Preferred backend; falls back to WASM if WebGPU unavailable */
  preferredBackend?: VcBackend;
  /** Graph optimization level */
  graphOptimization?: "disabled" | "basic" | "extended" | "all";
}

export interface VramUsageSnapshot {
  estimatedBytes: number;
  gpuSessions: number;
  totalSessions: number;
  models: string[];
}

/**
 * Describes a tensor for worker-based inference.
 * Replaces direct ort.Tensor creation in consumer code.
 */
export interface TensorDesc {
  data: Float32Array | BigInt64Array | Int32Array | Uint8Array;
  dims: number[];
  dtype: "float32" | "int64" | "int32" | "int32_as_int64" | "bool";
}

/**
 * Session metadata returned by ensureVcSession.
 * Replaces direct access to ort.InferenceSession properties.
 */
export interface SessionInfo {
  inputNames: string[];
  outputNames: string[];
  metadata?: Record<string, string>;
}

type VramUsageListener = (snapshot: VramUsageSnapshot) => void;

// ── Worker lifecycle ────────────────────────────────────────────────────

let worker: Worker | null = null;
let requestIdCounter = 0;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}
const pendingRequests = new Map<number, PendingRequest>();

/** Session info cache (mirrors worker state) */
const sessionInfoCache = new Map<string, SessionInfo>();

/** Track model buffer sizes for VRAM estimation */
const sessionSizes = new Map<string, number>();

/** Track which backend each session was created with */
const sessionBackends = new Map<string, VcBackend>();

/** Deduplicate concurrent session creation per model */
const sessionCreatePromises = new Map<string, Promise<SessionInfo>>();

/** Reactive VRAM listeners */
const vramListeners = new Set<VramUsageListener>();

function getOrCreateWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL("./vcOrtWorker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (err) => {
      console.error("[vcSession] Worker error:", err);
    };
    console.info("[vcSession] Worker created");
  }
  return worker;
}

function handleWorkerMessage(e: MessageEvent): void {
  const { id, type, ...data } = e.data;
  const pending = pendingRequests.get(id);
  if (!pending) return;
  pendingRequests.delete(id);

  if (type === "error") {
    pending.reject(new Error(data.message));
  } else {
    pending.resolve({ type, ...data });
  }
}

function sendToWorker(msg: Record<string, any>, transferables?: Transferable[]): Promise<any> {
  const id = ++requestIdCounter;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    getOrCreateWorker().postMessage({ ...msg, id }, transferables ?? []);
  });
}

/**
 * Extract an owned ArrayBuffer from a TypedArray.
 * If the view covers the entire buffer, returns it directly (zero-copy on transfer).
 * Otherwise copies the relevant slice.
 */
function ownedBuffer(view: ArrayBufferView): ArrayBuffer {
  const buf = view.buffer as ArrayBuffer;
  if (view.byteOffset === 0 && view.byteLength === buf.byteLength) {
    return buf;
  }
  return buf.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

// ── VRAM tracking ───────────────────────────────────────────────────────

export function getVramUsageSnapshot(): VramUsageSnapshot {
  const loadedIds = Array.from(sessionInfoCache.keys());
  const gpuModels = loadedIds.filter((id) => sessionBackends.get(id) === "webgpu");
  const estimatedBytes = gpuModels.reduce((sum, id) => sum + (sessionSizes.get(id) ?? 0), 0);

  return {
    estimatedBytes,
    gpuSessions: gpuModels.length,
    totalSessions: loadedIds.length,
    models: gpuModels,
  };
}

function notifyVramUsage(): void {
  const snapshot = getVramUsageSnapshot();
  vramListeners.forEach((listener) => {
    try { listener(snapshot); } catch {}
  });
}

/** Subscribe to estimated VRAM usage updates */
export function subscribeVramUsage(listener: VramUsageListener): () => void {
  vramListeners.add(listener);
  listener(getVramUsageSnapshot());
  return () => { vramListeners.delete(listener); };
}

function logVramUsage(action: string, modelId: string): void {
  const snapshot = getVramUsageSnapshot();
  console.info(
    `[vcSession] 💾 VRAM after ${action} "${modelId}": ~${(snapshot.estimatedBytes / 1e6).toFixed(1)} MB total | loaded: [${snapshot.models.join(", ")}]`,
  );
  notifyVramUsage();
}

// ── Backend detection ───────────────────────────────────────────────────

let resolvedBackend: VcBackend | null = null;
let forcedBackend: VcBackend | null = null;

async function isWebGpuAvailable(): Promise<boolean> {
  const adapter = await getSharedAdapter();
  return !!adapter;
}

/** Force a specific backend. Pass null to restore auto-detection. */
export function setForcedBackend(backend: VcBackend | null): void {
  forcedBackend = backend;
  console.info(`[vcSession] Backend override: ${backend ?? "auto"}`);
}

/** Get current forced backend (null = auto) */
export function getForcedBackend(): VcBackend | null {
  return forcedBackend;
}

/** Get the best available backend (respects forced override) */
export async function getAvailableBackend(): Promise<VcBackend> {
  if (forcedBackend) return forcedBackend;
  if (resolvedBackend) return resolvedBackend;
  resolvedBackend = (await isWebGpuAvailable()) ? "webgpu" : "wasm";
  console.info(`[vcSession] Resolved backend: ${resolvedBackend}`);
  return resolvedBackend;
}

/** Get the backend used for a loaded session */
export function getSessionBackend(modelId: string): VcBackend | null {
  return sessionBackends.get(modelId) ?? null;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Create (or return cached) ONNX session in the worker.
 * Model must already be downloaded to OPFS via vcModelCache.
 * Returns session metadata (inputNames, outputNames) for building feeds.
 */
export async function ensureVcSession(
  modelId: string,
  options?: VcSessionOptions,
): Promise<SessionInfo> {
  // Return cached info if session is already in worker
  const cached = sessionInfoCache.get(modelId);
  if (cached) return cached;

  // Deduplicate concurrent creation for same model
  const pending = sessionCreatePromises.get(modelId);
  if (pending) {
    console.info(`[vcSession] Awaiting in-flight session creation for "${modelId}"`);
    return pending;
  }

  const createPromise = (async (): Promise<SessionInfo> => {
    // Read model from OPFS
    const buffer = await readModel(modelId);
    if (!buffer) {
      throw new Error(`[vcSession] Model "${modelId}" not found in OPFS cache. Download it first.`);
    }

    const backend = options?.preferredBackend ?? (await getAvailableBackend());
    const graphOpt = options?.graphOptimization ?? "all";
    const executionProviders: string[] =
      backend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"];

    console.info(`[vcSession] Creating session for "${modelId}" (backend: ${backend}, ${(buffer.byteLength / 1e6).toFixed(1)} MB)`);
    const startMs = performance.now();

    // Send model buffer to worker (zero-copy transfer)
    const response = await sendToWorker(
      {
        type: "createSession",
        modelId,
        buffer,
        executionProviders,
        graphOpt,
      },
      [buffer], // transfer the ArrayBuffer
    );

    const elapsed = Math.round(performance.now() - startMs);
    const actualBackend = executionProviders[0] as VcBackend;
    console.info(`[vcSession] Session "${modelId}" ready in ${elapsed}ms (backend: ${actualBackend})`);

    const info: SessionInfo = {
      inputNames: response.inputNames,
      outputNames: response.outputNames,
      metadata: response.metadata,
    };

    sessionInfoCache.set(modelId, info);
    sessionSizes.set(modelId, buffer.byteLength);
    sessionBackends.set(modelId, actualBackend);
    logVramUsage("load", modelId);

    return info;
  })();

  sessionCreatePromises.set(modelId, createPromise);
  try {
    return await createPromise;
  } finally {
    if (sessionCreatePromises.get(modelId) === createPromise) {
      sessionCreatePromises.delete(modelId);
    }
  }
}

/**
 * Run inference in the worker.
 * Session must already be created via ensureVcSession().
 * Input/output data is transferred (zero-copy) between threads.
 */
export async function runVcInference(
  modelId: string,
  feeds: Record<string, TensorDesc>,
): Promise<Record<string, TensorDesc>> {
  // Serialize inputs for worker
  const inputs: { name: string; buffer: ArrayBuffer; dims: number[]; dtype: string }[] = [];
  const transferables: ArrayBuffer[] = [];

  for (const [name, desc] of Object.entries(feeds)) {
    const buf = ownedBuffer(desc.data);
    inputs.push({ name, buffer: buf, dims: desc.dims, dtype: desc.dtype });
    transferables.push(buf);
  }

  const response = await sendToWorker(
    { type: "run", modelId, inputs },
    transferables,
  );

  // Deserialize outputs
  const results: Record<string, TensorDesc> = {};
  for (const out of response.outputs) {
    let data: Float32Array | BigInt64Array | Int32Array | Uint8Array;
    if (out.dtype === "int64") {
      data = new BigInt64Array(out.buffer);
    } else if (out.dtype === "int32") {
      data = new Int32Array(out.buffer);
    } else if (out.dtype === "bool") {
      data = new Uint8Array(out.buffer);
    } else {
      data = new Float32Array(out.buffer);
    }
    results[out.name] = { data, dims: out.dims, dtype: out.dtype as TensorDesc["dtype"] };
  }

  return results;
}

/** Release a single cached session in the worker */
export async function releaseVcSession(modelId: string): Promise<void> {
  if (!sessionInfoCache.has(modelId)) return;

  if (worker) {
    try {
      await sendToWorker({ type: "releaseSession", modelId });
    } catch {
      // Worker may already be terminated
    }
  }

  sessionInfoCache.delete(modelId);
  sessionSizes.delete(modelId);
  sessionBackends.delete(modelId);
  logVramUsage("release", modelId);
}

/**
 * TERMINATE the worker — guaranteed VRAM release.
 *
 * Unlike session.release() which does NOT free GPU memory in most browsers,
 * worker.terminate() destroys the WebGPU device context, forcing the browser
 * to reclaim all associated GPU buffers and shader caches.
 *
 * A new worker is created lazily on the next ensureVcSession() call.
 */
export async function releaseAllVcSessions(): Promise<void> {
  const ids = Array.from(sessionInfoCache.keys());

  if (worker) {
    // Terminate the worker — this is the key to real VRAM release
    worker.terminate();
    worker = null;
    console.info(`[vcSession] 🔥 Worker terminated — VRAM forcefully released`);
  }

  // Reject all pending requests
  for (const [, req] of pendingRequests) {
    req.reject(new Error("Worker terminated for GPU cleanup"));
  }
  pendingRequests.clear();

  // Clear all caches
  sessionInfoCache.clear();
  sessionSizes.clear();
  sessionBackends.clear();
  sessionCreatePromises.clear();

  console.info(`[vcSession] 💾 VRAM after releaseAll: 0 MB | released: [${ids.join(", ")}]`);
  notifyVramUsage();
}

/** Get info about loaded sessions */
export function getLoadedSessions(): string[] {
  return Array.from(sessionInfoCache.keys());
}

// ── WebGPU corruption detection ─────────────────────────────────────────

/**
 * Custom error class thrown when ONNX inference output is corrupted
 * (all zeros, NaN, Inf). Signals the pipeline to retry with WASM.
 */
export class WebGPUCorruptError extends Error {
  constructor(modelId: string, detail: string) {
    super(`[WebGPUCorrupt] Model "${modelId}": ${detail}`);
    this.name = "WebGPUCorruptError";
  }
}

/**
 * Validate Float32Array output from ONNX inference.
 * Throws WebGPUCorruptError if output is all zeros, contains NaN/Inf,
 * or has suspiciously low variance (likely corrupted).
 */
export function validateInferenceOutput(
  data: Float32Array,
  modelId: string,
  label = "output",
): void {
  if (data.length === 0) {
    throw new WebGPUCorruptError(modelId, `${label} is empty`);
  }
  let nanCount = 0, infCount = 0, zeroCount = 0;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (Number.isNaN(v)) { nanCount++; continue; }
    if (!Number.isFinite(v)) { infCount++; continue; }
    if (v === 0) zeroCount++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (nanCount > 0) {
    throw new WebGPUCorruptError(modelId, `${label} contains ${nanCount} NaN values`);
  }
  if (infCount > 0) {
    throw new WebGPUCorruptError(modelId, `${label} contains ${infCount} Inf values`);
  }
  if (zeroCount === data.length) {
    throw new WebGPUCorruptError(modelId, `${label} is all zeros (${data.length} samples)`);
  }
  // If >99% zeros with tiny range, likely corrupted
  if (zeroCount > data.length * 0.99 && max - min < 1e-10) {
    throw new WebGPUCorruptError(modelId, `${label} is effectively silent (${zeroCount}/${data.length} zeros)`);
  }
}
