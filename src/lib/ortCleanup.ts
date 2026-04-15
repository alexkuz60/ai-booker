/**
 * ortCleanup.ts — ORT tensor disposal utilities.
 *
 * ONNX Runtime Web tensors hold GPU/WASM memory buffers that are NOT
 * automatically freed by JS garbage collection. This module provides
 * helpers to deterministically release them after inference.
 */
import type { Tensor } from "onnxruntime-web";

/**
 * Dispose all tensors in a feeds/results record.
 * Safe to call with undefined — no-op in that case.
 */
export function disposeOrtResults(
  record: Record<string, Tensor> | undefined | null,
): void {
  if (!record) return;
  for (const tensor of Object.values(record)) {
    try {
      tensor.dispose();
    } catch {
      // Already disposed or not disposable — ignore
    }
  }
}

/**
 * Dispose a single ORT tensor. Safe no-op if null/undefined.
 */
export function disposeOrtTensor(tensor: Tensor | null | undefined): void {
  if (!tensor) return;
  try {
    tensor.dispose();
  } catch {
    // Already disposed — ignore
  }
}
