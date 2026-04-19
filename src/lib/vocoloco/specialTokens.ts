/**
 * VocoLoco — OmniVoice special token IDs (k2-fsa/OmniVoice tokenizer).
 *
 * The k2-fsa/OmniVoice repo extends the Qwen3 tokenizer with 7 control tokens
 * used to wrap the conditioning prompt. Their numeric IDs are STABLE across
 * the model release — verified on 2026-04-19 against
 * `https://huggingface.co/k2-fsa/OmniVoice/resolve/main/tokenizer.json`.
 *
 * If a future model version reshuffles them, our tokenizer.ts loads them
 * from `tokenizer.tokens_trie` at runtime (see `resolveSpecialTokenId`),
 * so these constants are only used as fast-path / sanity-check values.
 */
export const OMNIVOICE_SPECIAL_TOKENS = {
  denoise: 151669,
  lang_start: 151670,
  lang_end: 151671,
  instruct_start: 151672,
  instruct_end: 151673,
  text_start: 151674,
  text_end: 151675,
} as const;

export type SpecialTokenName = keyof typeof OMNIVOICE_SPECIAL_TOKENS;

/**
 * Build the style+text prompt string in the exact format OmniVoice was
 * trained on. Matches `_prepare_inference_inputs` from upstream:
 *
 *   [<|denoise|>]<|lang_start|>{lang}<|lang_end|>
 *   <|instruct_start|>{instruct}<|instruct_end|>
 *   <|text_start|>{text}<|text_end|>
 *
 * @param text   Target text (any of 600+ supported languages).
 * @param opts   Optional language / instruct / denoise switches.
 */
export function buildOmniVoicePrompt(
  text: string,
  opts: {
    language?: string | null;
    instruct?: string | null;
    /** Set true for cloning mode (denoise prompt prepended). */
    denoise?: boolean;
  } = {},
): { stylePrompt: string; textPrompt: string } {
  const { language, instruct, denoise } = opts;
  const lang = language && language.trim() ? language.trim() : "None";
  const instr = instruct && instruct.trim() ? instruct.trim() : "None";

  let style = "";
  if (denoise) style += "<|denoise|>";
  style += `<|lang_start|>${lang}<|lang_end|>`;
  style += `<|instruct_start|>${instr}<|instruct_end|>`;

  const textPrompt = `<|text_start|>${text}<|text_end|>`;

  return { stylePrompt: style, textPrompt };
}
