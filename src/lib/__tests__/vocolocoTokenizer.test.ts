/**
 * Stage B — OmniVoice tokenizer tests (k2-fsa/OmniVoice).
 *
 * Hits HuggingFace CDN on first run; subsequent runs use IndexedDB cache.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  tokenizeOmniVoiceText,
  resolveSpecialTokenId,
  resetVocoLocoTokenizer,
  VOCOLOCO_TOKENIZER_REPO,
} from "@/lib/vocoloco/tokenizer";
import { OMNIVOICE_SPECIAL_TOKENS, buildOmniVoicePrompt } from "@/lib/vocoloco/specialTokens";

const HAS_NETWORK = typeof fetch === "function";

describe("VocoLoco — Stage B tokenizer (k2-fsa/OmniVoice)", () => {
  beforeAll(() => resetVocoLocoTokenizer());

  it("uses k2-fsa/OmniVoice repository", () => {
    expect(VOCOLOCO_TOKENIZER_REPO).toBe("k2-fsa/OmniVoice");
  });

  it("OMNIVOICE_SPECIAL_TOKENS contains the 7 control tokens", () => {
    expect(OMNIVOICE_SPECIAL_TOKENS.text_start).toBe(151674);
    expect(OMNIVOICE_SPECIAL_TOKENS.text_end).toBe(151675);
    expect(OMNIVOICE_SPECIAL_TOKENS.denoise).toBe(151669);
  });

  it("buildOmniVoicePrompt formats style + text correctly", () => {
    const { stylePrompt, textPrompt } = buildOmniVoicePrompt("hello", {
      language: "English",
      instruct: "calm",
      denoise: true,
    });
    expect(stylePrompt).toBe("<|denoise|><|lang_start|>English<|lang_end|><|instruct_start|>calm<|instruct_end|>");
    expect(textPrompt).toBe("<|text_start|>hello<|text_end|>");
  });

  (HAS_NETWORK ? it : it.skip)(
    "tokenizes wrapped prompt and resolves <|text_start|>",
    async () => {
      const ids = await tokenizeOmniVoiceText("<|text_start|>hello<|text_end|>");
      expect(ids.length).toBeGreaterThan(2);
      expect(ids).toContain(151674);
      expect(ids).toContain(151675);

      const resolved = await resolveSpecialTokenId("text_start");
      expect(resolved).toBe(151674);
    },
    60_000,
  );

  (HAS_NETWORK ? it : it.skip)(
    "tokenizes Russian text",
    async () => {
      const ids = await tokenizeOmniVoiceText("Привет, мир!");
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.length).toBeLessThan(30);
    },
    60_000,
  );
});
