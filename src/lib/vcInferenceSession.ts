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

/** Underlying raw sessions kept separately from the lock proxy wrapper */
const sessionTargets = new Map<string, ort.InferenceSession>();

/** Track model buffer sizes for VRAM estimation */
const sessionSizes = new Map<string, number>();

/** Track which backend each session was created with */
const sessionBackends = new Map<string, VcBackend>();

/** Serialize ONNX inference per model — ORT rejects concurrent session.run() calls */
const sessionRunQueues = new Map<string, Promise<void>>();

/** Deduplicate concurrent session creation per model to avoid orphaned GPU sessions */
const sessionCreatePromises = new Map<string, Promise<ort.InferenceSession>>();

/** Reference count active users of a model session */
const sessionRefCounts = new Map<string, number>();

function retainSession(modelId: string): void {
  sessionRefCounts.set(modelId, (sessionRefCounts.get(modelId) ?? 0) + 1);
}

function releaseSessionRef(modelId: string): number {
  const current = sessionRefCounts.get(modelId) ?? 0;
  if (current <= 1) {
    sessionRefCounts.delete(modelId);
    return 0;
  }
  const next = current - 1;
  sessionRefCounts.set(modelId, next);
  return next;
}

async function waitForSessionCreation(modelId: string): Promise<void> {
  const pending = sessionCreatePromises.get(modelId);
  if (!pending) return;
  await pending.catch(() => undefined);
}

async function runSessionExclusive<T>(modelId: string, task: () => Promise<T>): Promise<T> {
  const previous = sessionRunQueues.get(modelId);
  if (previous) {
    console.info(`[vcSession] Queueing inference for "${modelId}" until previous run completes`);
  }

  let releaseQueue!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  sessionRunQueues.set(
    modelId,
    (previous ?? Promise.resolve()).catch(() => undefined).then(() => current),
  );

  await (previous?.catch(() => undefined) ?? Promise.resolve());

  try {
    return await task();
  } finally {
    releaseQueue();
  }
}

async function waitForSessionIdle(modelId: string): Promise<void> {
  while (true) {
    const pending = sessionRunQueues.get(modelId);
    if (!pending) return;

    await pending.catch(() => undefined);

    if (sessionRunQueues.get(modelId) === pending) {
      sessionRunQueues.delete(modelId);
      return;
    }
  }
}

function createLockedSession(modelId: string, session: ort.InferenceSession): ort.InferenceSession {
  return new Proxy(session, {
    get(target, prop, receiver) {
      if (prop === "run") {
        return (...args: any[]) => runSessionExclusive(
          modelId,
          () => (target.run as (...innerArgs: any[]) => Promise<any>)(...args),
        );
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ort.InferenceSession;
}

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
  retainSession(modelId);

  const cached = sessionCache.get(modelId);
  if (cached) return cached;

  const pending = sessionCreatePromises.get(modelId);
  if (pending) {
    console.info(`[vcSession] Awaiting in-flight session creation for "${modelId}"`);
    try {
      return await pending;
    } catch (error) {
      releaseSessionRef(modelId);
      throw error;
    }
  }

  const createPromise = (async (): Promise<ort.InferenceSession> => {
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

    // Timeout for session creation — large models can hang during shader compilation
    const SESSION_TIMEOUT_MS = 120_000; // 2 minutes max
    const sessionPromise = ort.InferenceSession.create(
      new Uint8Array(buffer),
      {
        executionProviders,
        graphOptimizationLevel: graphOpt,
      },
    );
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(
        `Session creation for "${modelId}" timed out after ${SESSION_TIMEOUT_MS / 1000}s. Try switching to CPU (WASM) backend.`
      )), SESSION_TIMEOUT_MS),
    );
    const session = await Promise.race([sessionPromise, timeoutPromise]);

    const elapsed = Math.round(performance.now() - startMs);
    const actualBackend = executionProviders[0] as VcBackend;
    console.info(`[vcSession] Session "${modelId}" ready in ${elapsed}ms (backend: ${actualBackend})`);

    const lockedSession = createLockedSession(modelId, session);
    sessionCache.set(modelId, lockedSession);
    sessionTargets.set(modelId, session);
    sessionSizes.set(modelId, buffer.byteLength);
    sessionBackends.set(modelId, actualBackend);
    logVramUsage("load", modelId);
    return lockedSession;
  })();

  sessionCreatePromises.set(modelId, createPromise);

  try {
    return await createPromise;
  } catch (error) {
    releaseSessionRef(modelId);
    throw error;
  } finally {
    if (sessionCreatePromises.get(modelId) === createPromise) {
      sessionCreatePromises.delete(modelId);
    }
  }
}

/** Release a cached session */
export async function releaseVcSession(modelId: string): Promise<void> {
  await waitForSessionCreation(modelId);

  const remainingRefs = releaseSessionRef(modelId);
  if (remainingRefs > 0) {
    console.info(`[vcSession] Retaining session "${modelId}" (${remainingRefs} refs left)`);
    return;
  }

  await waitForSessionIdle(modelId);

  if ((sessionRefCounts.get(modelId) ?? 0) > 0) {
    console.info(`[vcSession] Skip release for "${modelId}" — session was reacquired`);
    return;
  }

  const session = sessionTargets.get(modelId) ?? sessionCache.get(modelId);
  if (session) {
    sessionCache.delete(modelId);
    sessionTargets.delete(modelId);
    sessionSizes.delete(modelId);
    sessionBackends.delete(modelId);
    sessionRunQueues.delete(modelId);

    try {
      await session.release();
    } finally {
      logVramUsage("release", modelId);
    }
  }
}

/** Release all cached sessions */
export async function releaseAllVcSessions(): Promise<void> {
  if (sessionCreatePromises.size > 0) {
    await Promise.allSettled(Array.from(sessionCreatePromises.values()));
  }

  const ids = Array.from(new Set([
    ...sessionCache.keys(),
    ...sessionTargets.keys(),
  ]));

  for (const modelId of ids) {
    await waitForSessionIdle(modelId);
  }

  const sessions = ids
    .map((modelId) => sessionTargets.get(modelId) ?? sessionCache.get(modelId))
    .filter((session): session is ort.InferenceSession => !!session);

  sessionCache.clear();
  sessionTargets.clear();
  sessionSizes.clear();
  sessionBackends.clear();
  sessionRunQueues.clear();
  sessionCreatePromises.clear();
  sessionRefCounts.clear();

  for (const session of sessions) {
    try {
      await session.release();
    } catch {
      // ok
    }
  }

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
