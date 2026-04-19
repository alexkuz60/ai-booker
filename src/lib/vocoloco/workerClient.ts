/**
 * VocoLoco — main-thread client for vocoLocoWorker.
 *
 * Wraps the postMessage protocol in typed promises and handles
 * worker lifecycle. Calling `terminateVocoLocoWorker()` is the ONLY
 * reliable way to release VRAM in browsers (Firefox especially).
 */
import { readVocoLocoModel } from "./modelCache";
import { findVocoLocoModel, VOCOLOCO_IO_CONTRACT } from "./modelRegistry";

export type VocoLocoBackend = "webgpu" | "wasm";

interface WorkerOutput {
  name: string;
  buffer: ArrayBuffer;
  dims: number[];
  dtype: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
}

let workerInstance: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingRequest>();
const activeSessions = new Set<string>();

function getWorker(): Worker {
  if (workerInstance) return workerInstance;
  workerInstance = new Worker(new URL("../vocoLocoWorker.ts", import.meta.url), { type: "module" });
  workerInstance.onmessage = (e: MessageEvent) => {
    const { id, type, message, ...rest } = e.data;
    const req = pending.get(id);
    if (!req) return;
    pending.delete(id);
    if (type === "error") {
      req.reject(new Error(message ?? "VocoLoco worker error"));
    } else {
      req.resolve({ type, ...rest });
    }
  };
  workerInstance.onerror = (e) => {
    console.error("[VocoLoco worker] fatal error", e);
    for (const req of pending.values()) {
      req.reject(new Error(e.message ?? "VocoLoco worker crashed"));
    }
    pending.clear();
    activeSessions.clear();
    workerInstance = null;
  };
  return workerInstance;
}

function send<T = any>(message: Record<string, unknown>, transferables: Transferable[] = []): Promise<T> {
  const worker = getWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, ...message }, transferables);
  });
}

export interface CreateSessionOptions {
  backend?: VocoLocoBackend;
  expectedInputs?: readonly string[];
  expectedOutputs?: readonly string[];
}

export interface CreateSessionResult {
  inputNames: string[];
  outputNames: string[];
  contractErrors: string[];
}

/**
 * Create an ONNX session in the worker for the given model id.
 * Reads the model from OPFS cache and validates I/O against the
 * registry contract (fail-fast on upstream breakage).
 */
export async function createVocoLocoSession(
  modelId: string,
  options: CreateSessionOptions = {},
): Promise<CreateSessionResult> {
  const entry = findVocoLocoModel(modelId);
  if (!entry) throw new Error(`[VocoLoco] Unknown model id: ${modelId}`);

  const buffer = await readVocoLocoModel(modelId);
  if (!buffer) {
    throw new Error(`[VocoLoco] Model "${modelId}" not in OPFS cache. Download it first.`);
  }

  const backend = options.backend ?? "webgpu";
  const executionProviders = backend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"];

  const expectedInputs = options.expectedInputs ?? VOCOLOCO_IO_CONTRACT[entry.role].inputs;
  const expectedOutputs = options.expectedOutputs ?? VOCOLOCO_IO_CONTRACT[entry.role].outputs;

  const result = await send<CreateSessionResult>(
    {
      type: "createSession",
      modelId,
      buffer,
      executionProviders,
      expectedInputs,
      expectedOutputs,
    },
    [buffer],
  );

  if (result.contractErrors.length > 0) {
    // Release immediately — broken contract, don't keep VRAM
    try { await send({ type: "releaseSession", modelId }); } catch { }
    throw new Error(
      `[VocoLoco] I/O contract mismatch for "${modelId}": ${result.contractErrors.join(", ")}. ` +
      `Got inputs=[${result.inputNames.join(",")}] outputs=[${result.outputNames.join(",")}].`,
    );
  }

  activeSessions.add(modelId);
  return result;
}

export interface TensorInput {
  name: string;
  buffer: ArrayBuffer;
  dims: number[];
  dtype: "float32" | "float16" | "int64" | "int32" | "int32_as_int64" | "int16" | "bool";
}

export async function runVocoLocoSession(
  modelId: string,
  inputs: TensorInput[],
): Promise<WorkerOutput[]> {
  const transferables = inputs.map((i) => i.buffer);
  const result = await send<{ outputs: WorkerOutput[] }>(
    { type: "run", modelId, inputs },
    transferables,
  );
  return result.outputs;
}

export async function releaseVocoLocoSession(modelId: string): Promise<void> {
  if (!activeSessions.has(modelId)) return;
  try {
    await send({ type: "releaseSession", modelId });
  } finally {
    activeSessions.delete(modelId);
  }
}

export async function releaseAllVocoLocoSessions(): Promise<void> {
  if (activeSessions.size === 0 && !workerInstance) return;
  try {
    await send({ type: "releaseAll" });
  } catch { /* worker may already be dead */ }
  activeSessions.clear();
}

/**
 * Hard kill — terminates the worker. The ONLY reliable way to release
 * VRAM on Firefox and stubborn Chromium builds. Use after a full
 * synthesis run is complete.
 */
export function terminateVocoLocoWorker(): void {
  if (workerInstance) {
    try { workerInstance.terminate(); } catch { }
    workerInstance = null;
  }
  activeSessions.clear();
  pending.clear();
}

export function getActiveVocoLocoSessions(): string[] {
  return [...activeSessions];
}
