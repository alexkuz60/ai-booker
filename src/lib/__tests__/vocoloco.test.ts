import { describe, it, expect } from "vitest";
import {
  VOCOLOCO_CONFIG,
  VOCOLOCO_ALL_MODELS,
  VOCOLOCO_LLM_VARIANTS,
  VOCOLOCO_LLM_DEFAULT_ID,
  VOCOLOCO_ENCODER,
  VOCOLOCO_DECODER,
  VOCOLOCO_IO_CONTRACT,
  findVocoLocoModel,
} from "@/lib/vocoloco";

describe("VocoLoco — Stage A registry & config", () => {
  it("config matches upstream gluschenko/omnivoice-onnx (24 kHz, 8 codebooks, vocab 1025)", () => {
    expect(VOCOLOCO_CONFIG.sampleRate).toBe(24_000);
    expect(VOCOLOCO_CONFIG.nCodebooks).toBe(8);
    expect(VOCOLOCO_CONFIG.vocabSize).toBe(1025);
    expect(VOCOLOCO_CONFIG.maskTokenId).toBe(1024);
    expect(VOCOLOCO_CONFIG.framesPerSecond).toBe(25);
    expect(VOCOLOCO_CONFIG.llmBackbone).toBe("qwen3-0.6b");
  });

  it("all 3 roles are registered (encoder + decoder + 3 LLM quants)", () => {
    expect(VOCOLOCO_ENCODER.role).toBe("encoder");
    expect(VOCOLOCO_DECODER.role).toBe("decoder");
    expect(VOCOLOCO_LLM_VARIANTS).toHaveLength(3);
    expect(VOCOLOCO_LLM_VARIANTS.every((m) => m.role === "llm")).toBe(true);
    expect(VOCOLOCO_ALL_MODELS).toHaveLength(5);
  });

  it("default LLM is the INT8 per-channel variant", () => {
    expect(VOCOLOCO_LLM_DEFAULT_ID).toBe("vocoloco-llm-int8");
    const def = findVocoLocoModel(VOCOLOCO_LLM_DEFAULT_ID);
    expect(def).toBeDefined();
    expect(def?.quant).toBe("qint8");
  });

  it("all model URLs point to gluschenko HuggingFace repos", () => {
    for (const m of VOCOLOCO_ALL_MODELS) {
      expect(m.url).toMatch(/^https:\/\/huggingface\.co\/gluschenko\//);
      expect(m.url.endsWith(".onnx")).toBe(true);
    }
  });

  it("all LLM variants share the same revision (single upstream snapshot)", () => {
    const revs = new Set(VOCOLOCO_LLM_VARIANTS.map((m) => m.revision));
    expect(revs.size).toBe(1);
  });

  it("I/O contract matches inspection findings", () => {
    expect(VOCOLOCO_IO_CONTRACT.llm.inputs).toEqual([
      "input_ids", "audio_mask", "attention_mask", "position_ids",
    ]);
    expect(VOCOLOCO_IO_CONTRACT.llm.outputs).toEqual(["logits"]);
    expect(VOCOLOCO_IO_CONTRACT.decoder.outputs).toEqual(["audio_values"]);
  });

  it("findVocoLocoModel returns undefined for unknown ids", () => {
    expect(findVocoLocoModel("does-not-exist")).toBeUndefined();
  });

  it("model sizes are reasonable (>= 50 MB) for cache budgeting", () => {
    for (const m of VOCOLOCO_ALL_MODELS) {
      expect(m.sizeBytes).toBeGreaterThan(50_000_000);
    }
  });
});
