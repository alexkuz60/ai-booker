/**
 * Stage B — Qwen3 tokenizer wrapper tests.
 *
 * These tests hit the HuggingFace CDN on first run (downloads ~5 MB of
 * tokenizer.json + vocab + merges). Subsequent runs use the transformers.js
 * IndexedDB cache. CI without network → these tests fail; that's acceptable
 * as they are integration-grade for the BPE contract.
 *
 * Run with: bunx vitest run src/lib/__tests__/vocolocoTokenizer.test.ts --environment=node
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  tokenizeForVocoLoco,
  previewTokens,
  resetVocoLocoTokenizer,
  VOCOLOCO_TOKENIZER_REPO,
} from "@/lib/vocoloco/tokenizer";

const HAS_NETWORK = typeof fetch === "function";

describe("VocoLoco — Stage B tokenizer", () => {
  beforeAll(() => {
    resetVocoLocoTokenizer();
  });

  it("uses Qwen3-0.6B ONNX-community repository", () => {
    expect(VOCOLOCO_TOKENIZER_REPO).toBe("onnx-community/Qwen3-0.6B-ONNX");
  });

  (HAS_NETWORK ? it : it.skip)(
    "tokenizes English text into BigInt64Array",
    async () => {
      const ids = await tokenizeForVocoLoco("Hello, world!");
      expect(ids).toBeInstanceOf(BigInt64Array);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.length).toBeLessThan(20);
      // All ids must be non-negative within Qwen3 vocab range (~151k)
      for (const v of ids) {
        expect(v).toBeGreaterThanOrEqual(0n);
        expect(v).toBeLessThan(200_000n);
      }
    },
    60_000,
  );

  (HAS_NETWORK ? it : it.skip)(
    "tokenizes Russian text",
    async () => {
      const ids = await tokenizeForVocoLoco("Привет, мир!");
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.length).toBeLessThan(30);
    },
    60_000,
  );

  (HAS_NETWORK ? it : it.skip)(
    "produces deterministic output for identical input",
    async () => {
      const a = await tokenizeForVocoLoco("Тест воспроизводимости");
      const b = await tokenizeForVocoLoco("Тест воспроизводимости");
      expect(Array.from(a)).toEqual(Array.from(b));
    },
    60_000,
  );

  (HAS_NETWORK ? it : it.skip)(
    "previewTokens returns string array",
    async () => {
      const tokens = await previewTokens("VocoLoco");
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);
      expect(typeof tokens[0]).toBe("string");
    },
    60_000,
  );

  (HAS_NETWORK ? it : it.skip)(
    "different texts produce different token sequences",
    async () => {
      const a = await tokenizeForVocoLoco("foo");
      const b = await tokenizeForVocoLoco("bar baz qux");
      expect(Array.from(a)).not.toEqual(Array.from(b));
    },
    60_000,
  );
});
