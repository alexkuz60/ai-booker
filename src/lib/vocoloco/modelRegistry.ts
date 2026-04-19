/**
 * VocoLoco — ONNX model registry.
 *
 * 3-file stack from gluschenko/omnivoice-onnx + higgs-audio-v2-tokenizer-onnx:
 *   - higgs encoder (FP32, 654 MB)  — wav 24k → audio_codes [B, 8, T]
 *   - omnivoice LLM (3 quants)      — Qwen3-0.6B backbone, single forward
 *   - higgs decoder (FP32, 86 MB)   — audio_codes [B, 8, T] → wav [B, 1, S]
 *
 * Versioning policy: registry entries are identified by `id` (e.g.
 * `omnivoice-llm-int8`). Upstream weight refreshes that keep the I/O contract
 * = bump `revision` + `sha256` only. Breaking I/O changes = new `id@v2`.
 *
 * The pipeline reads model files from OPFS (`vocoloco-models/`) via
 * vcModelCache helpers — see modelCache.ts wrapper.
 */

export type VocoLocoModelRole = "encoder" | "llm" | "decoder";

export interface VocoLocoModelEntry {
  id: string;
  role: VocoLocoModelRole;
  /** Display name shown in UI */
  label: string;
  /** Remote source URL of the .onnx graph file */
  url: string;
  /** Approximate size in bytes of the .onnx graph (for progress UI) */
  sizeBytes: number;
  /**
   * Optional companion ONNX external-data file URL (e.g. `*.onnx_data`).
   * Required when the .onnx is just a graph and weights live separately.
   * If provided, downloader fetches both, modelCache stores both,
   * and the worker mounts the data file via `externalData` session option
   * so ORT-Web can resolve `Module.MountedFiles` lookups.
   */
  externalDataUrl?: string;
  externalDataSize?: number;
  /** Schema/version identifier — bump on upstream weight changes */
  revision: string;
  /** Quant variant (LLM only) */
  quant?: "fp32" | "qint16" | "qint8" | "quint8" | "qdq-u8s8";
  /** Description for UI */
  description: string;
}

/**
 * Encoder — required ONLY for Voice Cloning mode.
 * Voice Design (no reference) skips this model entirely.
 */
export const VOCOLOCO_ENCODER: VocoLocoModelEntry = {
  id: "vocoloco-encoder",
  role: "encoder",
  label: "Higgs Audio Encoder",
  url: "https://huggingface.co/gluschenko/higgs-audio-v2-tokenizer-onnx/resolve/main/onnx/higgs_audio_v2_tokenizer_encoder.onnx",
  sizeBytes: 654_396_774,
  revision: "2026-04-19b",
  description: "Reference audio → 8-codebook tokens (24 kHz mono input)",
};

/**
 * Decoder — required for ALL modes (codes → waveform).
 * Small (86 MB), can be pre-cached aggressively.
 */
export const VOCOLOCO_DECODER: VocoLocoModelEntry = {
  id: "vocoloco-decoder",
  role: "decoder",
  label: "Higgs Audio Decoder",
  url: "https://huggingface.co/gluschenko/higgs-audio-v2-tokenizer-onnx/resolve/main/onnx/higgs_audio_v2_tokenizer_decoder.onnx",
  sizeBytes: 86_346_947,
  revision: "2026-04-19b",
  description: "Audio codes → 24 kHz mono waveform",
};

/**
 * LLM — multiple quants, user-selectable in UI.
 * Default: INT8 per-channel (best balance of size/quality/compatibility).
 */
export const VOCOLOCO_LLM_VARIANTS: VocoLocoModelEntry[] = [
  {
    id: "vocoloco-llm-int8",
    role: "llm",
    quant: "qint8",
    label: "OmniVoice LLM (INT8 per-channel)",
    url: "https://huggingface.co/gluschenko/omnivoice-onnx/resolve/main/onnx/omnivoice.qint8_per_channel.onnx",
    sizeBytes: 3_951_539,
    externalDataUrl: "https://huggingface.co/gluschenko/omnivoice-onnx/resolve/main/onnx/omnivoice.qint8_per_channel.onnx_data",
    externalDataSize: 612_773_952,
    revision: "2026-04-19b",
    description: "Default — Qwen3-0.6B backbone, balanced quality/size",
  },
  {
    id: "vocoloco-llm-qint16",
    role: "llm",
    quant: "qint16",
    label: "OmniVoice LLM (QInt16)",
    url: "https://huggingface.co/gluschenko/omnivoice-onnx/resolve/main/onnx/omnivoice.qint16_per_channel.onnx",
    sizeBytes: 3_951_539,
    externalDataUrl: "https://huggingface.co/gluschenko/omnivoice-onnx/resolve/main/onnx/omnivoice.qint16_per_channel.onnx_data",
    externalDataSize: 1_061_572_672,
    revision: "2026-04-19b",
    description: "Higher quality, +400 MB to OPFS and VRAM",
  },
  {
    id: "vocoloco-llm-qdq",
    role: "llm",
    quant: "qdq-u8s8",
    label: "OmniVoice LLM (Static QDQ u8s8)",
    url: "https://huggingface.co/gluschenko/omnivoice-onnx/resolve/main/onnx/omnivoice.static_qdq_u8s8.onnx",
    sizeBytes: 3_951_539,
    externalDataUrl: "https://huggingface.co/gluschenko/omnivoice-onnx/resolve/main/onnx/omnivoice.static_qdq_u8s8.onnx_data",
    externalDataSize: 612_577_344,
    revision: "2026-04-19b",
    description: "Best CPU/WASM performance — recommended if WebGPU unstable",
  },
];

/** Total bytes a model occupies on disk (graph + optional external data). */
export function totalModelBytes(entry: VocoLocoModelEntry): number {
  return entry.sizeBytes + (entry.externalDataSize ?? 0);
}

export const VOCOLOCO_LLM_DEFAULT_ID = "vocoloco-llm-int8";

/** All entries flat — useful for cache iteration */
export const VOCOLOCO_ALL_MODELS: VocoLocoModelEntry[] = [
  VOCOLOCO_ENCODER,
  VOCOLOCO_DECODER,
  ...VOCOLOCO_LLM_VARIANTS,
];

export function findVocoLocoModel(id: string): VocoLocoModelEntry | undefined {
  return VOCOLOCO_ALL_MODELS.find((m) => m.id === id);
}

/**
 * Expected I/O signatures — used as a contract test on session creation.
 * Fail-fast guarantees: if upstream ever changes input/output names, we
 * detect it at session-init time, not at first inference.
 */
export const VOCOLOCO_IO_CONTRACT = {
  encoder: {
    inputs: ["audio"], // waveform [B, 1, samples] — exact name verified at runtime
    outputs: ["audio_codes"], // [B, 8, T]
  },
  llm: {
    inputs: ["input_ids", "audio_mask", "attention_mask", "position_ids"],
    outputs: ["logits"], // [B, 8, T, 1025]
  },
  decoder: {
    inputs: ["audio_codes"],
    outputs: ["audio_values"], // [B, 1, samples]
  },
} as const;
