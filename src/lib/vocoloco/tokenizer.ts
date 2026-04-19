/**
 * VocoLoco — OmniVoice tokenizer wrapper (k2-fsa/OmniVoice).
 *
 * The OmniVoice LLM expects audio-codebook-shaped input_ids `[B, 8, L]`.
 * Text tokens are produced by a Qwen3 BPE tokenizer that has been EXTENDED
 * with 7 OmniVoice-specific control tokens (<|text_start|>, <|denoise|>,
 * <|lang_start|>, …) — these are added on top of the 151643-token Qwen3
 * vocab and share the same Qwen2Tokenizer class.
 *
 * IMPORTANT: We use `k2-fsa/OmniVoice` as the canonical source instead of
 * the stock `Qwen/Qwen3-0.6B` — the latter does not contain the OmniVoice
 * extra tokens, so the model would never see them and the diffusion loop
 * would degenerate to noise.
 *
 * Tokenization is fast (<5 ms per phrase) and stays on the main thread —
 * no need to round-trip through the worker.
 */
import { AutoTokenizer, env, type PreTrainedTokenizer } from "@huggingface/transformers";
import { OMNIVOICE_SPECIAL_TOKENS, type SpecialTokenName } from "./specialTokens";

env.allowRemoteModels = true;
env.allowLocalModels = false;

/**
 * k2-fsa/OmniVoice repo — the canonical OmniVoice tokenizer with the
 * extended special tokens. Same Qwen2Tokenizer BPE class as Qwen3-0.6B.
 */
const OMNIVOICE_TOKENIZER_REPO = "k2-fsa/OmniVoice";

let tokenizerPromise: Promise<PreTrainedTokenizer> | null = null;

/**
 * Lazy-load the OmniVoice tokenizer. Subsequent calls return the cached
 * instance. Throws on network/CDN failure — caller decides retry policy.
 */
export function getOmniVoiceTokenizer(): Promise<PreTrainedTokenizer> {
  if (!tokenizerPromise) {
    tokenizerPromise = AutoTokenizer.from_pretrained(OMNIVOICE_TOKENIZER_REPO).catch((err) => {
      tokenizerPromise = null;
      throw new Error(`[VocoLoco] Failed to load OmniVoice tokenizer: ${err?.message ?? err}`);
    });
  }
  return tokenizerPromise;
}

/**
 * Tokenize a wrapped prompt string into a flat number[] of token ids.
 * The input string MUST already include the OmniVoice control tokens
 * (built by `buildOmniVoicePrompt`).
 *
 * `add_special_tokens: false` — we never want extra BOS/EOS confusing
 * the LLM's audio codebook stream.
 */
export async function tokenizeOmniVoiceText(text: string): Promise<number[]> {
  if (typeof text !== "string") throw new Error("[VocoLoco] tokenize: text must be a string");
  const tok = await getOmniVoiceTokenizer();
  const encoded = await tok(text, { add_special_tokens: false });
  const data = encoded.input_ids?.data;
  if (!(data instanceof BigInt64Array)) {
    throw new Error(`[VocoLoco] Unexpected tokenizer output type: ${data?.constructor?.name ?? typeof data}`);
  }
  // Return as plain number[] — values fit in 32-bit easily (max ~152000).
  const out: number[] = new Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = Number(data[i]);
  return out;
}

/**
 * Resolve a special-token id from the live tokenizer (slow path) and fall
 * back to the hardcoded constants when the tokenizer reports unknown — the
 * constants were verified on 2026-04-19 against the upstream tokenizer.json.
 */
export async function resolveSpecialTokenId(name: SpecialTokenName): Promise<number> {
  const tok = await getOmniVoiceTokenizer();
  // transformers.js exposes `model.tokens_to_ids` for added_tokens lookup.
  const literal = `<|${name}|>`;
  const ids = (tok as any)?.model?.tokens_to_ids?.get?.(literal);
  if (typeof ids === "number") return ids;
  // Fallback: encoded with add_special_tokens:false should yield exactly 1 token
  const encoded = await tok(literal, { add_special_tokens: false });
  const arr = encoded.input_ids?.data as BigInt64Array | undefined;
  if (arr && arr.length === 1) return Number(arr[0]);
  // Last resort — hardcoded fallback
  return OMNIVOICE_SPECIAL_TOKENS[name];
}

/**
 * Cheap helper for diagnostics — returns the human-readable token strings.
 */
export async function previewTokens(text: string): Promise<string[]> {
  const tok = await getOmniVoiceTokenizer();
  return tok.tokenize(text);
}

/**
 * Reset internal cache — used by tests and on tokenizer-version mismatch.
 */
export function resetVocoLocoTokenizer(): void {
  tokenizerPromise = null;
}

/** Repo identifier (exposed for diagnostics + future versioning UI). */
export const VOCOLOCO_TOKENIZER_REPO = OMNIVOICE_TOKENIZER_REPO;
