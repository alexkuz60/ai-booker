/**
 * VocoLoco Stage C — diffusion sampler unit tests (post-rewrite under
 * the official OmniVoice contract: dual-pass CFG, layer penalty, Gumbel
 * sampling, integer-count unmask schedule).
 *
 * Pipeline orchestrator (pipeline.ts) is NOT covered here — it requires
 * a real ONNX worker + 700 MB of model weights.
 */
import { describe, expect, it } from "vitest";
import {
  applyDiffusionStep,
  buildUnmaskSchedule,
  DEFAULT_DIFFUSION_PARAMS,
  makeRng,
} from "../vocoloco/diffusionSampler";

describe("VocoLoco diffusion — buildUnmaskSchedule", () => {
  it("sums to exactly the total number of tokens", () => {
    const total = 800;
    const schedule = buildUnmaskSchedule(total, 16, 0.1);
    const sum = schedule.reduce((a, b) => a + b, 0);
    expect(sum).toBe(total);
  });

  it("never produces a negative count", () => {
    const schedule = buildUnmaskSchedule(1000, 24, 0.1);
    for (const k of schedule) expect(k).toBeGreaterThanOrEqual(0);
  });

  it("last step drains whatever remains", () => {
    const schedule = buildUnmaskSchedule(123, 8, 0.1);
    const sum = schedule.reduce((a, b) => a + b, 0);
    expect(sum).toBe(123);
  });

  it("tShift changes the per-step distribution", () => {
    const a = buildUnmaskSchedule(1000, 10, 0.1);
    const b = buildUnmaskSchedule(1000, 10, 1.0);
    // Both must total 1000 but differ at intermediate steps
    expect(a.reduce((x, y) => x + y, 0)).toBe(1000);
    expect(b.reduce((x, y) => x + y, 0)).toBe(1000);
    expect(a[2]).not.toBe(b[2]);
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
    codes[0] = 1; // (cb=0, t=0) already known
    codes[3] = 2; // (cb=0, t=3) already known

    // Logits trivially favour token 0 in every position.
    const cond = new Float32Array(nCb * T * V);
    for (let i = 0; i < cond.length; i += V) cond[i] = 100;
    const uncond = new Float32Array(cond); // identical → CFG no-op

    applyDiffusionStep({
      condLogits: cond,
      uncondLogits: uncond,
      audioCodes: codes,
      nCodebooks: nCb,
      numFrames: T,
      vocabSize: V,
      maskTokenId: MASK,
      unmaskCount: 100, // way more than masked positions
      guidanceScale: 0,
      layerPenaltyFactor: 0,
      positionTemperature: 0,
      classTemperature: 0,
      rng: makeRng(1),
    });

    expect(codes[0]).toBe(1);
    expect(codes[3]).toBe(2);
    for (let i = 0; i < codes.length; i++) {
      if (i !== 0 && i !== 3) expect(codes[i]).toBe(0);
    }
  });

  it("partial unmask leaves exactly (masked - unmaskCount) positions still masked", () => {
    const nCb = 1;
    const T = 10;
    const V = 3;
    const MASK = 2;
    const codes = new Int32Array(T);
    codes.fill(MASK);

    const cond = new Float32Array(T * V);
    for (let t = 0; t < T; t++) cond[t * V + 0] = t; // increasing confidence per t
    const uncond = new Float32Array(cond);

    applyDiffusionStep({
      condLogits: cond,
      uncondLogits: uncond,
      audioCodes: codes,
      nCodebooks: nCb,
      numFrames: T,
      vocabSize: V,
      maskTokenId: MASK,
      unmaskCount: 6, // unmask 6, leave 4 masked
      guidanceScale: 0,
      layerPenaltyFactor: 0,
      positionTemperature: 0,
      classTemperature: 0,
      rng: makeRng(99),
    });

    let masked = 0;
    for (let i = 0; i < T; i++) if (codes[i] === MASK) masked++;
    expect(masked).toBe(4);
  });

  it("never re-emits the mask token id even when it has the highest cond logit", () => {
    const nCb = 1;
    const T = 1;
    const V = 4;
    const MASK = 3;
    const codes = new Int32Array([MASK]);

    const cond = new Float32Array(V);
    cond[MASK] = 1000; // mask token has the highest logit by far
    cond[1] = 1; // second-best
    const uncond = new Float32Array(cond);

    applyDiffusionStep({
      condLogits: cond,
      uncondLogits: uncond,
      audioCodes: codes,
      nCodebooks: nCb,
      numFrames: T,
      vocabSize: V,
      maskTokenId: MASK,
      unmaskCount: 1,
      guidanceScale: 0,
      layerPenaltyFactor: 0,
      positionTemperature: 0,
      classTemperature: 0,
      rng: makeRng(7),
    });

    expect(codes[0]).not.toBe(MASK);
    expect(codes[0]).toBe(1);
  });
});

describe("VocoLoco diffusion — defaults", () => {
  it("DEFAULT_DIFFUSION_PARAMS has sane values", () => {
    expect(DEFAULT_DIFFUSION_PARAMS.numSteps).toBeGreaterThanOrEqual(16);
    expect(DEFAULT_DIFFUSION_PARAMS.guidanceScale).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_DIFFUSION_PARAMS.tShift).toBeGreaterThan(0);
    expect(DEFAULT_DIFFUSION_PARAMS.layerPenaltyFactor).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_DIFFUSION_PARAMS.positionTemperature).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_DIFFUSION_PARAMS.classTemperature).toBeGreaterThanOrEqual(0);
  });
});
