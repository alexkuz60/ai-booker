/**
 * VocoLoco — Qwen3 BPE tokenizer wrapper.
 *
 * Uses @huggingface/transformers (Xenova) which lazy-loads the tokenizer
 * config + merges + vocab JSON files from the HuggingFace CDN on first use,
 * then caches them in IndexedDB via the `transformers.js` cache layer.
 *
 * The OmniVoice LLM (gluschenko/omnivoice-onnx) wraps Qwen3-0.6B which uses
 * the Qwen2Tokenizer BPE — `Qwen/Qwen3-0.6B` repo provides the same files.
 *
 * Public API is intentionally tiny: encode(text) → BigInt64Array.
 * Model loading is async and idempotent — first call warms the cache.
 *
 * NOTE: We deliberately keep the tokenizer on the main thread (not in the
 * worker). Tokenization is fast (<5 ms per phrase) and putting BPE inside
 * the worker would force every text to round-trip through postMessage.
 */
import { AutoTokenizer, env, type PreTrainedTokenizer } from "@huggingface/transformers";

// Allow remote model fetches (transformers.js disables them by default in some setups)
env.allowRemoteModels = true;
env.allowLocalModels = false;

/**
 * Qwen3-0.6B tokenizer repo — using the `onnx-community` mirror because
 * the official `Qwen/Qwen3-0.6B` repo is missing `special_tokens_map.json`
 * which makes transformers.js v4 throw "i is undefined" during init.
 *
 * Both repos share the same `Qwen2Tokenizer` class, vocab.json and merges.txt
 * (151 936 token BPE), so token IDs are identical — fully compatible with the
 * OmniVoice LLM (gluschenko/omnivoice-onnx) which wraps Qwen3-0.6B.
 *
 * If a future OmniVoice revision switches the backbone (e.g. Qwen3.5),
 * bump this constant — pipeline contract test will surface vocab mismatch.
 */
const QWEN3_TOKENIZER_REPO = "onnx-community/Qwen3-0.6B-ONNX";

let tokenizerPromise: Promise<PreTrainedTokenizer> | null = null;

/**
 * Lazy-load the Qwen3 tokenizer. Subsequent calls return the cached instance.
 * Throws on network/CDN failure — caller decides whether to retry or fall back.
 */
export function getQwen3Tokenizer(): Promise<PreTrainedTokenizer> {
  if (!tokenizerPromise) {
    tokenizerPromise = AutoTokenizer.from_pretrained(QWEN3_TOKENIZER_REPO).catch((err) => {
      // Reset so the next caller can retry instead of getting a stuck rejection
      tokenizerPromise = null;
      throw new Error(`[VocoLoco] Failed to load Qwen3 tokenizer: ${err?.message ?? err}`);
    });
  }
  return tokenizerPromise;
}

/**
 * Tokenize a text string into the BigInt64Array tensor data expected by
 * the OmniVoice LLM `input_ids` input.
 *
 * @param text Input string (any language Qwen3 supports — RU/EN/ZH/etc.)
 * @returns BigInt64 array of token ids ready for ort.Tensor("int64", ..., [1, N])
 */
export async function tokenizeForVocoLoco(text: string): Promise<BigInt64Array> {
  if (typeof text !== "string") throw new Error("[VocoLoco] tokenize: text must be a string");
  const tok = await getQwen3Tokenizer();
  // `add_special_tokens: false` — OmniVoice prepends its own audio control
  // tokens at the LLM stage, we don't want extra BOS/EOS confusing the codebook stream.
  const encoded = await tok(text, { add_special_tokens: false });
  // transformers.js returns a Tensor with `.data` as BigInt64Array for int64 dtype
  const data = encoded.input_ids?.data;
  if (!(data instanceof BigInt64Array)) {
    throw new Error(`[VocoLoco] Unexpected tokenizer output type: ${data?.constructor?.name ?? typeof data}`);
  }
  return data;
}

/**
 * Cheap helper for diagnostics — returns the human-readable token strings.
 */
export async function previewTokens(text: string): Promise<string[]> {
  const tok = await getQwen3Tokenizer();
  return tok.tokenize(text);
}

/**
 * Reset internal cache — used by tests and on tokenizer-version mismatch.
 */
export function resetVocoLocoTokenizer(): void {
  tokenizerPromise = null;
}

/** Repo identifier (exposed for diagnostics + future versioning UI) */
export const VOCOLOCO_TOKENIZER_REPO = QWEN3_TOKENIZER_REPO;
