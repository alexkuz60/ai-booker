/**
 * vcOrtWorker.ts — Web Worker that owns all ONNX Runtime sessions.
 *
 * All GPU memory (WebGPU buffers, shader caches) lives inside this worker.
 * Calling `worker.terminate()` from the main thread is the ONLY reliable
 * way to release VRAM in browsers (especially Firefox) where
 * `session.release()` does not reclaim GPU memory.
 *
 * Protocol: main thread sends typed messages, worker responds with results.
 * All tensor data is transferred (zero-copy) via Transferable ArrayBuffers.
 */
import * as ort from "onnxruntime-web";

// Configure ORT WASM paths (CDN — Vite does not serve node_modules assets)
const ORT_VERSION = "1.25.0-dev.20260327-722743c0e2";
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
ort.env.wasm.numThreads = navigator.hardwareConcurrency
  ? Math.min(navigator.hardwareConcurrency, 4)
  : 2;

/** Cached sessions keyed by modelId */
const sessions = new Map<string, ort.InferenceSession>();

/** Max time for session creation (shader compilation can be slow) */
const SESSION_TIMEOUT_MS = 120_000;

interface WorkerTensorInput {
  name: string;
  buffer: ArrayBuffer;
  dims: number[];
  dtype: string; // "float32" | "int64" | "bool"
}

function bufferToTypedArray(buffer: ArrayBuffer, dtype: string): { data: ort.Tensor["data"]; ortDtype: string } {
  switch (dtype) {
    case "float32": return { data: new Float32Array(buffer), ortDtype: "float32" };
    case "float16": return { data: new Uint16Array(buffer), ortDtype: "float16" };
    case "int64": return { data: new BigInt64Array(buffer), ortDtype: "int64" };
    case "int32_as_int64": {
      // Main thread sends int32 to avoid BigInt64Array serialization overhead.
      // Convert to int64 here in the worker where ORT expects it.
      const i32 = new Int32Array(buffer);
      const i64 = new BigInt64Array(i32.length);
      for (let i = 0; i < i32.length; i++) i64[i] = BigInt(i32[i]);
      return { data: i64, ortDtype: "int64" };
    }
    case "int32": return { data: new Int32Array(buffer), ortDtype: "int32" };
    case "int16": return { data: new Int16Array(buffer), ortDtype: "int16" };
    case "bool": return { data: new Uint8Array(buffer), ortDtype: "bool" };
    default: return { data: new Float32Array(buffer), ortDtype: "float32" };
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { id, type, ...payload } = e.data;
  try {
    switch (type) {
      case "createSession": {
        const { modelId, buffer, executionProviders, graphOpt } = payload;

        // Race session creation against timeout
        const sessionPromise = ort.InferenceSession.create(
          new Uint8Array(buffer as ArrayBuffer),
          {
            executionProviders: executionProviders as string[],
            graphOptimizationLevel: graphOpt ?? "all",
          },
        );
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(
              `Session creation for "${modelId}" timed out after ${SESSION_TIMEOUT_MS / 1000}s. ` +
              `Try switching to CPU (WASM) backend.`
            )),
            SESSION_TIMEOUT_MS,
          ),
        );
        const session = await Promise.race([sessionPromise, timeoutPromise]);
        sessions.set(modelId, session);

        // Extract optional model metadata (for output SR detection)
        let metadata: Record<string, string> | undefined;
        try {
          metadata = (session as any).handler?.metadata;
        } catch {
          // Metadata access may not be supported — OK
        }

        self.postMessage({
          id,
          type: "sessionCreated",
          inputNames: [...session.inputNames],
          outputNames: [...session.outputNames],
          metadata,
        });
        break;
      }

      case "run": {
        const { modelId, inputs } = payload as { modelId: string; inputs: WorkerTensorInput[] };
        const session = sessions.get(modelId);
        if (!session) throw new Error(`No ORT session for model "${modelId}". Call ensureVcSession first.`);

        // Build ORT tensors from serialized inputs
        const feeds: Record<string, ort.Tensor> = {};
        for (const inp of inputs) {
          const { data, ortDtype } = bufferToTypedArray(inp.buffer, inp.dtype);
          feeds[inp.name] = new ort.Tensor(ortDtype as any, data, inp.dims);
        }

        // Run inference
        const results = await session.run(feeds);

        // Serialize outputs + collect transferables for zero-copy return
        const outputs: { name: string; buffer: ArrayBuffer; dims: number[]; dtype: string }[] = [];
        const transferables: ArrayBuffer[] = [];

        for (const [name, tensor] of Object.entries(results)) {
          const srcData = tensor.data;
          let outBuf: ArrayBuffer;

          if (srcData instanceof Float32Array) {
            const copy = new Float32Array(srcData);
            outBuf = copy.buffer;
          } else if (srcData instanceof BigInt64Array) {
            const copy = new BigInt64Array(srcData);
            outBuf = copy.buffer;
          } else if (srcData instanceof Int32Array) {
            const copy = new Int32Array(srcData);
            outBuf = copy.buffer;
          } else if (srcData instanceof Int16Array) {
            const copy = new Int16Array(srcData);
            outBuf = copy.buffer;
          } else if (srcData instanceof Uint16Array) {
            // float16 tensors come as Uint16Array
            const copy = new Uint16Array(srcData);
            outBuf = copy.buffer;
          } else {
            // Fallback: treat as float32
            const copy = new Float32Array(srcData as any);
            outBuf = copy.buffer;
          }

          outputs.push({
            name,
            buffer: outBuf,
            dims: Array.from(tensor.dims),
            dtype: tensor.type,
          });
          transferables.push(outBuf);

          // Dispose ORT output tensor (frees GPU-side buffer)
          try { tensor.dispose(); } catch {}
        }

        // Dispose ORT input tensors (frees GPU-side copies)
        for (const t of Object.values(feeds)) {
          try { t.dispose(); } catch {}
        }

        (self as unknown as Worker).postMessage({ id, type: "runResult", outputs }, transferables as any);
        break;
      }

      case "releaseSession": {
        const session = sessions.get(payload.modelId);
        if (session) {
          try { await session.release(); } catch {}
          sessions.delete(payload.modelId);
        }
        self.postMessage({ id, type: "released" });
        break;
      }

      case "releaseAll": {
        const ids = [...sessions.keys()];
        for (const [, session] of sessions) {
          try { await session.release(); } catch {}
        }
        sessions.clear();
        self.postMessage({ id, type: "releasedAll", modelIds: ids });
        break;
      }

      default:
        self.postMessage({ id, type: "error", message: `Unknown message type: ${type}` });
    }
  } catch (err: any) {
    self.postMessage({
      id,
      type: "error",
      message: err?.message ?? String(err),
    });
  }
};
