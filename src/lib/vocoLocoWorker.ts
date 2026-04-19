/**
 * vocoLocoWorker.ts — dedicated Web Worker for VocoLoco ONNX sessions.
 *
 * Isolated from vcOrtWorker so VC (RVC) and VocoLoco (OmniVoice) sessions
 * never share VRAM lifecycle: terminating one worker doesn't kill the other.
 *
 * Protocol mirrors vcOrtWorker for consistency. All tensor data is
 * transferred (zero-copy) via Transferable ArrayBuffers.
 *
 * Stage A scope: session create/release + I/O contract validation + run.
 * Diffusion sampler logic stays on the main thread (Stage C).
 */
import * as ort from "onnxruntime-web";

const ORT_VERSION = "1.25.0-dev.20260327-722743c0e2";
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
ort.env.wasm.numThreads = navigator.hardwareConcurrency
  ? Math.min(navigator.hardwareConcurrency, 4)
  : 2;

/**
 * Pre-request a WebGPU adapter with raised `maxStorageBuffersPerShaderStage`.
 * The OmniVoice LLM uses Concat kernels that bind 14 storage buffers per
 * dispatch — well above the WebGPU spec default of 8. Without this, ORT-Web
 * fails with `Too many bindings of type StorageBuffers in Stage ShaderStages(COMPUTE)`.
 * Idempotent.
 */
let webgpuPrepared: Promise<void> | null = null;
function prepareWebGpuAdapter(): Promise<void> {
  if (webgpuPrepared) return webgpuPrepared;
  webgpuPrepared = (async () => {
    if (typeof navigator === "undefined" || !(navigator as any).gpu) return;
    try {
      const adapter = await (navigator as any).gpu.requestAdapter({
        powerPreference: "high-performance",
      });
      if (!adapter) return;
      const adapterMax = (adapter.limits as any).maxStorageBuffersPerShaderStage ?? 8;
      const desiredLimit = Math.min(adapterMax, 16);
      if (desiredLimit > 8) {
        const device = await adapter.requestDevice({
          requiredLimits: { maxStorageBuffersPerShaderStage: desiredLimit },
        });
        (ort.env.webgpu as any).adapter = adapter;
        (ort.env.webgpu as any).device = device;
      } else {
        (ort.env.webgpu as any).adapter = adapter;
        console.warn(
          `[VocoLoco worker] WebGPU adapter only supports ${adapterMax} storage buffers/stage; ` +
          `OmniVoice Concat kernels need ≥14 — synthesis will likely fail on WebGPU. ` +
          `Switch to WASM backend.`,
        );
      }
    } catch (err) {
      console.warn("[VocoLoco worker] WebGPU adapter prep failed:", err);
    }
  })();
  return webgpuPrepared;
}

const sessions = new Map<string, ort.InferenceSession>();
const SESSION_TIMEOUT_MS = 180_000; // LLM is large — allow 3 min

interface WorkerTensorInput {
  name: string;
  buffer: ArrayBuffer;
  dims: number[];
  dtype: string;
}

function bufferToTypedArray(buffer: ArrayBuffer, dtype: string): { data: ort.Tensor["data"]; ortDtype: string } {
  switch (dtype) {
    case "float32": return { data: new Float32Array(buffer), ortDtype: "float32" };
    case "float16": return { data: new Uint16Array(buffer), ortDtype: "float16" };
    case "int64": return { data: new BigInt64Array(buffer), ortDtype: "int64" };
    case "int32_as_int64": {
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
        const { modelId, buffer, externalData, executionProviders, graphOpt, expectedInputs, expectedOutputs } = payload;

        // If WebGPU is in the EP list, ensure adapter has raised storage-buffer limit
        // BEFORE ORT-Web creates its own default device.
        if (Array.isArray(executionProviders) && (executionProviders as string[]).includes("webgpu")) {
          await prepareWebGpuAdapter();
        }

        // ONNX models with external data (e.g. Qwen3-based LLM where the .onnx
        // is just the graph) require the companion `.onnx_data` to be mounted
        // into ORT-Web's virtual FS via the `externalData` session option.
        // Without it ORT throws: "Failed to load external data file ... 
        // Module.MountedFiles is not available."
        const sessionOptions: ort.InferenceSession.SessionOptions = {
          executionProviders: executionProviders as string[],
          graphOptimizationLevel: graphOpt ?? "all",
        };
        if (Array.isArray(externalData) && externalData.length > 0) {
          (sessionOptions as any).externalData = (externalData as Array<{ path: string; buffer: ArrayBuffer }>)
            .map(({ path, buffer: dataBuf }) => ({ path, data: new Uint8Array(dataBuf) }));
        }

        const sessionPromise = ort.InferenceSession.create(
          new Uint8Array(buffer as ArrayBuffer),
          sessionOptions,
        );
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(
              `[VocoLoco] Session creation for "${modelId}" timed out after ${SESSION_TIMEOUT_MS / 1000}s.`,
            )),
            SESSION_TIMEOUT_MS,
          ),
        );
        const session = await Promise.race([sessionPromise, timeoutPromise]);
        sessions.set(modelId, session);

        const inputNames = [...session.inputNames];
        const outputNames = [...session.outputNames];

        // Diagnostic: probe input dtypes via every known ORT-Web internal API.
        // ORT-Web hides metadata in different places per backend (jsep/wasm/webgpu).
        try {
          const s: any = session;
          const candidates = [
            s.inputMetadata,
            s.handler?.inputMetadata,
            s.handler?._inputMetadata,
            s.handler?.session?.inputMetadata,
            s._inputMetadata,
          ];
          let foundMeta: any = null;
          for (const c of candidates) {
            if (c && (Array.isArray(c) ? c.length : Object.keys(c).length)) {
              foundMeta = c;
              break;
            }
          }
          const dtypeMap: Record<string, any> = {};
          if (foundMeta) {
            if (Array.isArray(foundMeta)) {
              // newer ORT: array aligned with inputNames
              for (let i = 0; i < inputNames.length; i++) {
                const m = foundMeta[i];
                dtypeMap[inputNames[i]] = m?.type ?? m?.dataType ?? m;
              }
            } else if (typeof foundMeta.get === "function") {
              for (const n of inputNames) {
                const m = foundMeta.get(n);
                dtypeMap[n] = m?.type ?? m?.dataType ?? m;
              }
            } else {
              for (const n of inputNames) {
                const m = foundMeta[n];
                dtypeMap[n] = m?.type ?? m?.dataType ?? m;
              }
            }
            console.log(`[VocoLoco worker] "${modelId}" input dtypes:`, JSON.stringify(dtypeMap));
          } else {
            const probedKeys = Object.keys(s).concat(s.handler ? Object.keys(s.handler).map((k: string) => `handler.${k}`) : []);
            console.log(
              `[VocoLoco worker] "${modelId}" no inputMetadata in any candidate. session keys=`,
              probedKeys,
              `inputNames=`, inputNames,
            );
          }
        } catch (e) {
          console.warn(`[VocoLoco worker] inputMetadata probe failed:`, e);
        }

        // Contract validation — fail-fast if upstream broke I/O
        const contractErrors: string[] = [];
        if (Array.isArray(expectedInputs)) {
          for (const expected of expectedInputs as string[]) {
            if (!inputNames.includes(expected)) {
              contractErrors.push(`missing input "${expected}"`);
            }
          }
        }
        if (Array.isArray(expectedOutputs)) {
          for (const expected of expectedOutputs as string[]) {
            if (!outputNames.includes(expected)) {
              contractErrors.push(`missing output "${expected}"`);
            }
          }
        }

        self.postMessage({
          id,
          type: "sessionCreated",
          inputNames,
          outputNames,
          contractErrors,
        });
        break;
      }

      case "run": {
        const { modelId, inputs } = payload as { modelId: string; inputs: WorkerTensorInput[] };
        const session = sessions.get(modelId);
        if (!session) throw new Error(`[VocoLoco] No session for "${modelId}". Call createSession first.`);

        const feeds: Record<string, ort.Tensor> = {};
        const feedDiag: Record<string, string> = {};
        for (const inp of inputs) {
          const { data, ortDtype } = bufferToTypedArray(inp.buffer, inp.dtype);
          feeds[inp.name] = new ort.Tensor(ortDtype as any, data, inp.dims);
          feedDiag[inp.name] = `${ortDtype}[${inp.dims.join(",")}]`;
        }

        let results: ort.InferenceSession.ReturnType;
        try {
          if (modelId.includes("llm")) {
            console.log(`[VocoLoco worker] run("${modelId}") feeds:`, JSON.stringify(feedDiag));
          }
          results = await session.run(feeds);
        } catch (runErr: any) {
          console.error(`[VocoLoco worker] run("${modelId}") failed. Feeds sent:`, JSON.stringify(feedDiag));
          throw runErr;
        }

        const outputs: { name: string; buffer: ArrayBuffer; dims: number[]; dtype: string }[] = [];
        const transferables: ArrayBuffer[] = [];

        for (const [name, tensor] of Object.entries(results)) {
          const srcData = tensor.data;
          let outBuf: ArrayBuffer;

          if (srcData instanceof Float32Array) {
            outBuf = new Float32Array(srcData).buffer;
          } else if (srcData instanceof BigInt64Array) {
            outBuf = new BigInt64Array(srcData).buffer;
          } else if (srcData instanceof Int32Array) {
            outBuf = new Int32Array(srcData).buffer;
          } else if (srcData instanceof Int16Array) {
            outBuf = new Int16Array(srcData).buffer;
          } else if (srcData instanceof Uint16Array) {
            outBuf = new Uint16Array(srcData).buffer;
          } else {
            outBuf = new Float32Array(srcData as any).buffer;
          }

          outputs.push({
            name,
            buffer: outBuf,
            dims: Array.from(tensor.dims),
            dtype: tensor.type,
          });
          transferables.push(outBuf);

          try { tensor.dispose(); } catch {}
        }

        for (const t of Object.values(feeds)) {
          try { t.dispose(); } catch {}
        }

        (self as unknown as Worker).postMessage(
          { id, type: "runResult", outputs },
          transferables as any,
        );
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
        self.postMessage({ id, type: "error", message: `[VocoLoco] Unknown message type: ${type}` });
    }
  } catch (err: any) {
    self.postMessage({
      id,
      type: "error",
      message: err?.message ?? String(err),
    });
  }
};
