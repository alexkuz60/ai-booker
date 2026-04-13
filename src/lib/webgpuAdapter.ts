/**
 * webgpuAdapter.ts — Singleton WebGPU adapter cache.
 * Prevents creating multiple GPUAdapter instances across the app.
 * Used by: useWebGPU (detection/benchmark), vcInferenceSession (ONNX).
 */

let cachedAdapter: GPUAdapter | null = null;
let adapterPromise: Promise<GPUAdapter | null> | null = null;

/**
 * Get the shared GPUAdapter. Creates one on first call, returns cached after.
 * Returns null if WebGPU is unavailable.
 */
export function getSharedAdapter(): Promise<GPUAdapter | null> {
  if (cachedAdapter) return Promise.resolve(cachedAdapter);
  if (adapterPromise) return adapterPromise;

  adapterPromise = (async () => {
    if (!navigator.gpu) return null;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      cachedAdapter = adapter;
      return adapter;
    } catch {
      return null;
    } finally {
      adapterPromise = null;
    }
  })();

  return adapterPromise;
}

/** Invalidate cached adapter (e.g. after device.destroy() in tests). */
export function clearAdapterCache(): void {
  cachedAdapter = null;
  adapterPromise = null;
}
