/**
 * vcInferenceSession.ts — Wrapper around ONNX Runtime Web InferenceSession.
 * Provides WebGPU → WASM automatic fallback, lazy init, and session caching.
 *
 * Usage:
 *   const session = await createVcSession("contentvec");
 *   const result = await session.run({ source: tensor });
 */
import * as ort from "onnxruntime-web";
import { readModel } from "./vcModelCache";
import { getSharedAdapter } from "./webgpuAdapter";

// Configure ONNX Runtime Web paths for WASM backend
// WASM files must be served from CDN because Vite does not serve node_modules assets
const ORT_VERSION = "1.24.3";
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
ort.env.wasm.numThreads = navigator.hardwareConcurrency
  ? Math.min(navigator.hardwareConcurrency, 4)
  : 2;

export type VcBackend = "webgpu" | "wasm";

export interface VcSessionOptions {
  /** Preferred backend; falls back to WASM if WebGPU unavailable */
  preferredBackend?: VcBackend;
  /** Graph optimization level */
  graphOptimization?: "disabled" | "basic" | "extended" | "all";
}

/** Cached sessions keyed by modelId */
const sessionCache = new Map<string, ort.InferenceSession>();

/** Track model buffer sizes for VRAM estimation */
const sessionSizes = new Map<string, number>();

/** Track which backend each session was created with */
const sessionBackends = new Map<string, VcBackend>();

/** Log estimated VRAM usage across all loaded sessions */
function logVramUsage(action: string, modelId: string): void {
  let totalBytes = 0;
  for (const sz of sessionSizes.values()) totalBytes += sz;
  const models = Array.from(sessionSizes.keys()).join(", ");
  console.info(
    `[vcSession] 💾 VRAM after ${action} "${modelId}": ~${(totalBytes / 1e6).toFixed(1)} MB total | loaded: [${models}]`,
  );
}

/** Detect if WebGPU execution provider is available (uses shared adapter) */
async function isWebGpuAvailable(): Promise<boolean> {
  const adapter = await getSharedAdapter();
  return !!adapter;
}

let resolvedBackend: VcBackend | null = null;

/**
 * User-forced backend override. When set, bypasses auto-detection.
 * null = auto (WebGPU → WASM fallback), "wasm" = force CPU, "webgpu" = force GPU.
 */
let forcedBackend: VcBackend | null = null;

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

/**
 * Create (or return cached) ONNX InferenceSession for a VC model.
 * Model must already be downloaded to OPFS via vcModelCache.
 */
export async function createVcSession(
  modelId: string,
  options?: VcSessionOptions,
): Promise<ort.InferenceSession> {
  // Return cached session if available
  const cached = sessionCache.get(modelId);
  if (cached) return cached;

  // Read model from OPFS
  const buffer = await readModel(modelId);
  if (!buffer) {
    throw new Error(`[vcSession] Model "${modelId}" not found in OPFS cache. Download it first.`);
  }

  const backend = options?.preferredBackend ?? (await getAvailableBackend());
  const graphOpt = options?.graphOptimization ?? "all";

  // Build execution providers list with fallback
  const executionProviders: string[] =
    backend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"];

  console.info(`[vcSession] Creating session for "${modelId}" (backend: ${backend}, ${(buffer.byteLength / 1e6).toFixed(1)} MB)`);
  const startMs = performance.now();

  const session = await ort.InferenceSession.create(
    new Uint8Array(buffer),
    {
      executionProviders,
      graphOptimizationLevel: graphOpt,
    },
  );

  const elapsed = Math.round(performance.now() - startMs);
  const actualBackend = executionProviders[0] as VcBackend;
  console.info(`[vcSession] Session "${modelId}" ready in ${elapsed}ms (backend: ${actualBackend})`);

  sessionCache.set(modelId, session);
  sessionSizes.set(modelId, buffer.byteLength);
  sessionBackends.set(modelId, actualBackend);
  logVramUsage("load", modelId);
  return session;
}

/** Release a cached session */
export async function releaseVcSession(modelId: string): Promise<void> {
  const session = sessionCache.get(modelId);
  if (session) {
    await session.release();
    sessionCache.delete(modelId);
    sessionSizes.delete(modelId);
    sessionBackends.delete(modelId);
    logVramUsage("release", modelId);
  }
}

/** Release all cached sessions */
export async function releaseAllVcSessions(): Promise<void> {
  const ids = Array.from(sessionCache.keys());
  for (const [, session] of sessionCache) {
    try { await session.release(); } catch { /* ok */ }
  }
  sessionCache.clear();
  sessionSizes.clear();
  sessionBackends.clear();
  console.info(`[vcSession] 💾 VRAM after releaseAll: 0 MB | released: [${ids.join(", ")}]`);
}

/** Get info about loaded sessions */
export function getLoadedSessions(): string[] {
  return Array.from(sessionCache.keys());
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

