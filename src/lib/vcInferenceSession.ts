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

/** Get the best available backend (cached after first check) */
export async function getAvailableBackend(): Promise<VcBackend> {
  if (resolvedBackend) return resolvedBackend;
  resolvedBackend = (await isWebGpuAvailable()) ? "webgpu" : "wasm";
  console.info(`[vcSession] Resolved backend: ${resolvedBackend}`);
  return resolvedBackend;
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
  console.info(`[vcSession] Session "${modelId}" ready in ${elapsed}ms`);

  sessionCache.set(modelId, session);
  sessionSizes.set(modelId, buffer.byteLength);
  logVramUsage("load", modelId);
  return session;
}

/** Release a cached session */
export async function releaseVcSession(modelId: string): Promise<void> {
  const session = sessionCache.get(modelId);
  if (session) {
    await session.release();
    sessionCache.delete(modelId);
    console.info(`[vcSession] Released session "${modelId}"`);
  }
}

/** Release all cached sessions */
export async function releaseAllVcSessions(): Promise<void> {
  for (const [id, session] of sessionCache) {
    try { await session.release(); } catch { /* ok */ }
    console.info(`[vcSession] Released session "${id}"`);
  }
  sessionCache.clear();
}

/** Get info about loaded sessions */
export function getLoadedSessions(): string[] {
  return Array.from(sessionCache.keys());
}
