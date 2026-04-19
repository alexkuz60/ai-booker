/**
 * VocoLoco Stage C — diffusion sampler unit tests.
 *
 * Pipeline orchestrator (pipeline.ts) is NOT covered here — it requires
 * a real ONNX worker + 700 MB of model weights, which is integration-test
 * territory (manual run in VoiceLab UI). Sampler logic IS covered because
 * it's pure deterministic math.
 */
import { describe, expect, it } from "vitest";
import {
  applyDiffusionStep,
  buildMaskSchedule,
  DEFAULT_DIFFUSION_PARAMS,
  makeRng,
  maskScheduleCosine,
  sampleFromLogits,
} from "../vocoloco/diffusionSampler";

describe("VocoLoco diffusion — sampleFromLogits", () => {
  it("argmax with very low temperature picks the highest-logit token", () => {
    const logits = new Float32Array([1, 5, 2, 0.5, 4]);
    const rng = makeRng(42);
    // T=0.01 → effectively argmax
    const out = sampleFromLogits(logits, 0.01, 1.0, rng);
    expect(out).toBe(1);
  });

  it("respects top-p truncation", () => {
    const logits = new Float32Array([10, 9, 0.1, 0.1, 0.1]);
    // top-p = 0.5 should keep only the top 1 (or 2) tokens
    const counts = [0, 0, 0, 0, 0];
    const rng = makeRng(7);
    for (let i = 0; i < 200; i++) {
      counts[sampleFromLogits(new Float32Array(logits), 1.0, 0.5, rng)]++;
    }
    // Tokens 2,3,4 must NEVER be sampled — they're outside the nucleus
    expect(counts[2] + counts[3] + counts[4]).toBe(0);
  });

  it("seeded RNG produces deterministic output", () => {
    const logits = new Float32Array([1, 2, 3, 2, 1]);
    const a = sampleFromLogits(logits, 1.0, 1.0, makeRng(123));
    const b = sampleFromLogits(logits, 1.0, 1.0, makeRng(123));
    expect(a).toBe(b);
  });
});

describe("VocoLoco diffusion — mask schedule", () => {
  it("starts at 1 and ends at 0", () => {
    expect(maskScheduleCosine(0)).toBeCloseTo(1, 5);
    expect(maskScheduleCosine(1)).toBeCloseTo(0, 5);
  });

  it("buildMaskSchedule monotonically decreases", () => {
    const schedule = buildMaskSchedule(800, 16);
    expect(schedule[0]).toBe(800);
    expect(schedule[schedule.length - 1]).toBe(0);
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i]).toBeLessThanOrEqual(schedule[i - 1]);
    }
  });

  it("tShift > 1 keeps more positions masked early", () => {
    const slow = buildMaskSchedule(1000, 10, 2.0);
    const fast = buildMaskSchedule(1000, 10, 1.0);
    // At step 3, slow should still mask MORE positions than fast
    expect(slow[3]).toBeGreaterThanOrEqual(fast[3]);
  });
});

describe("VocoLoco diffusion — applyDiffusionStep", () => {
  it("only fills masked positions, never overwrites known ones", () => {
    const nCb = 2;
    const T = 4;
    const V = 5;
    const MASK = 4;
    const codes = new Int32Array(nCb * T);
    codes.fill(MASK);
    codes[0] = 1; // mark position (cb=0, t=0) as already known
    codes[3] = 2; // mark (cb=0, t=3)

    // Make logits trivially favor token 0 everywhere
    const logits = new Float32Array(nCb * T * V);
    for (let i = 0; i < logits.length; i += V) logits[i] = 100;

    applyDiffusionStep({
      logits,
      audioCodes: codes,
      nCodebooks: nCb,
      numFrames: T,
      vocabSize: V,
      maskTokenId: MASK,
      targetMaskedAfterStep: 0, // unmask everything possible
      temperature: 0.5,
      topP: 1.0,
      rng: makeRng(1),
    });

    expect(codes[0]).toBe(1); // unchanged
    expect(codes[3]).toBe(2); // unchanged
    // Other masked positions filled with token 0 (highest logit)
    for (let i = 0; i < codes.length; i++) {
      if (i !== 0 && i !== 3) expect(codes[i]).toBe(0);
    }
  });

  it("partial unmask keeps targetMasked positions still masked", () => {
    const nCb = 1;
    const T = 10;
    const V = 3;
    const MASK = 2;
    const codes = new Int32Array(T);
    codes.fill(MASK);

    const logits = new Float32Array(T * V);
    // Different logit confidences per position
    for (let t = 0; t < T; t++) {
      logits[t * V + 0] = t; // increasing confidence per t for token 0
    }

    applyDiffusionStep({
      logits,
      audioCodes: codes,
      nCodebooks: nCb,
      numFrames: T,
      vocabSize: V,
      maskTokenId: MASK,
      targetMaskedAfterStep: 4, // keep 4 still masked
      temperature: 0.5,
      topP: 1.0,
      rng: makeRng(99),
    });

    let masked = 0;
    for (let i = 0; i < T; i++) if (codes[i] === MASK) masked++;
    expect(masked).toBe(4);
  });
});

describe("VocoLoco diffusion — defaults", () => {
  it("DEFAULT_DIFFUSION_PARAMS has sane values", () => {
    expect(DEFAULT_DIFFUSION_PARAMS.numSteps).toBeGreaterThanOrEqual(16);
    expect(DEFAULT_DIFFUSION_PARAMS.temperature).toBeGreaterThan(0);
    expect(DEFAULT_DIFFUSION_PARAMS.topP).toBeGreaterThan(0);
    expect(DEFAULT_DIFFUSION_PARAMS.topP).toBeLessThanOrEqual(1);
  });
});
