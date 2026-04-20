/**
 * VocoLoco — runtime configuration.
 *
 * Source of truth for model-agnostic constants extracted from upstream
 * config.json (gluschenko/omnivoice-onnx + higgs-audio-v2-tokenizer-onnx).
 *
 * Kept as a separate file (not hardcoded) so future upstream updates can be
 * delivered as a JSON swap without touching pipeline code.
 *
 * Verified by Stage A inspection of:
 *   - omnivoice.qint8_per_channel.onnx
 *   - higgs_audio_v2_tokenizer_encoder.onnx
 *   - higgs_audio_v2_tokenizer_decoder.onnx
 */

export interface VocoLocoConfig {
  /** Target waveform sample rate (Hz) — encoder input + decoder output */
  sampleRate: number;
  /** Number of audio codebooks (RVQ depth) used by the LLM */
  nCodebooks: number;
  /** Codebook vocabulary size (1024 tokens + 1 mask token) */
  vocabSize: number;
  /** Mask token id (last index) */
  maskTokenId: number;
  /** Audio frame rate at codebook level (frames/sec) */
  framesPerSecond: number;
  /** LLM backbone identification (informational) */
  llmBackbone: string;
  /**
   * Default diffusion sampling steps (typical 16–32).
   *
   * Set to 16 because LLM forward dominates the wall-clock budget — each
   * step is one full Qwen3 forward over [2, 8, L]. On INT8/WebGPU we measure
   * ~10 s/step, so 32 steps = ~5 minutes. 16 steps cuts it in half with
   * acceptable quality for a "draft" preview. Higher-quality presets can
   * raise this back to 24-32 explicitly.
   */
  defaultDiffusionSteps: number;
}

export const VOCOLOCO_CONFIG: VocoLocoConfig = {
  sampleRate: 24_000,
  nCodebooks: 8,
  vocabSize: 1025, // 1024 + mask
  maskTokenId: 1024,
  framesPerSecond: 25, // 24000 / 960 hop_length
  llmBackbone: "qwen3-0.6b",
  defaultDiffusionSteps: 16,
};
