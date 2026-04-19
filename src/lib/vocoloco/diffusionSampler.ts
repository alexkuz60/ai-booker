/**
 * VocoLoco — diffusion sampler.
 *
 * OmniVoice LLM is NOT autoregressive — it does parallel masked diffusion
 * over `T` audio frames × 8 codebooks. The sampler:
 *   1. starts with `[B=1, 8, T]` filled with mask token (id = 1024)
 *   2. for `numSteps` iterations:
 *      - run LLM forward → logits `[B, 8, T, 1025]`
 *      - apply temperature + top-p to logits at currently-masked positions
 *      - sample tokens, fill into `audio_codes`
 *      - shrink the mask (cosine schedule) — fewer positions stay masked
 *   3. after final step, all codebooks are filled
 *
 * Reference: OmniVoice diffusion loop in upstream Python implementation.
 * We keep all sampling math in float32 on the main thread — the heavy
 * 613 MB LLM forward stays in the worker.
 */
import { VOCOLOCO_CONFIG } from "./config";

export interface DiffusionParams {
  /** Number of denoising steps (typical 16-32). More = better quality, slower. */
  numSteps: number;
  /** Sampling temperature. >1 = more diverse, <1 = more conservative. */
  temperature: number;
  /** Top-p (nucleus) sampling threshold (0..1). Set to 1 to disable. */
  topP: number;
  /** Optional CFG scale for prompt-conditioning strength (1 = no guidance). */
  cfgScale?: number;
  /** Optional time-shift parameter for the mask schedule (>1 keeps more mask early). */
  tShift?: number;
  /** Deterministic RNG seed (optional). */
  seed?: number;
}

export const DEFAULT_DIFFUSION_PARAMS: DiffusionParams = {
  numSteps: VOCOLOCO_CONFIG.defaultDiffusionSteps,
  temperature: 0.95,
  topP: 0.9,
  cfgScale: 1.5,
  tShift: 1.0,
};

/**
 * xorshift32 — tiny deterministic RNG for reproducible diffusion runs.
 * Not cryptographically secure, but plenty for stochastic sampling.
 */
class SeededRng {
  private state: number;
  constructor(seed: number) {
    this.state = seed | 0 || 0xdeadbeef;
  }
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    // map int32 → [0, 1)
    return ((x >>> 0) / 0x100000000);
  }
}

function makeRng(seed?: number): () => number {
  if (typeof seed === "number") {
    const r = new SeededRng(seed);
    return () => r.next();
  }
  return Math.random;
}

/**
 * Cosine mask schedule — fraction of positions to keep masked at step `t`.
 * t in [0, 1] (0 = first step, 1 = last). Returns mask ratio in [0, 1].
 *
 * `tShift > 1` slows the unmasking early (keeps more uncertain longer).
 */
export function maskScheduleCosine(t: number, tShift: number = 1.0): number {
  // standard cosine schedule from MaskGIT-like papers
  const shifted = Math.min(1, t * tShift);
  return Math.cos((Math.PI / 2) * shifted);
}

/**
 * Apply temperature scaling, then top-p truncation, then categorical sample.
 * Returns the sampled token id.
 *
 * @param logits Float32Array of length `vocabSize` for ONE position.
 * @param temperature >0
 * @param topP (0, 1]
 * @param rng () => number in [0, 1)
 */
export function sampleFromLogits(
  logits: Float32Array,
  temperature: number,
  topP: number,
  rng: () => number,
): number {
  const V = logits.length;
  const t = Math.max(temperature, 1e-4);

  // 1. softmax with temperature
  let maxLogit = -Infinity;
  for (let i = 0; i < V; i++) {
    const v = logits[i] / t;
    if (v > maxLogit) maxLogit = v;
  }
  const probs = new Float32Array(V);
  let sum = 0;
  for (let i = 0; i < V; i++) {
    const p = Math.exp(logits[i] / t - maxLogit);
    probs[i] = p;
    sum += p;
  }
  const inv = sum > 0 ? 1 / sum : 0;
  for (let i = 0; i < V; i++) probs[i] *= inv;

  // 2. top-p nucleus filtering (sort indices by prob desc)
  if (topP < 1.0) {
    const indices = Array.from({ length: V }, (_, i) => i);
    indices.sort((a, b) => probs[b] - probs[a]);
    let acc = 0;
    let cutoff = V;
    for (let i = 0; i < V; i++) {
      acc += probs[indices[i]];
      if (acc >= topP) {
        cutoff = i + 1;
        break;
      }
    }
    // zero everything outside the nucleus
    const keep = new Set(indices.slice(0, cutoff));
    let renorm = 0;
    for (let i = 0; i < V; i++) {
      if (!keep.has(i)) probs[i] = 0;
      else renorm += probs[i];
    }
    if (renorm > 0) {
      const k = 1 / renorm;
      for (let i = 0; i < V; i++) probs[i] *= k;
    }
  }

  // 3. categorical sample
  const r = rng();
  let acc = 0;
  for (let i = 0; i < V; i++) {
    acc += probs[i];
    if (r < acc) return i;
  }
  // fallback (numerical edge): return argmax
  let best = 0;
  let bestP = -1;
  for (let i = 0; i < V; i++) if (probs[i] > bestP) { bestP = probs[i]; best = i; }
  return best;
}

/**
 * One step of the diffusion loop — given current `audio_codes` and mask,
 * decide which masked positions to fill this step.
 *
 * @param logits Float32Array layout `[8, T, vocabSize]` flattened in C order
 * @param audioCodes Int32Array `[8, T]` — current state (mask token = 1024)
 * @param positionScores Float32Array `[8, T]` — confidence (max prob) for each position; used to pick "easiest" positions to unmask first
 * @param targetMasked Number of positions that should REMAIN masked after this step
 * @param sampler (codebookIdx, frameIdx) → tokenId — pluggable for tests
 * @returns updated audio_codes (mutates in-place + returns reference)
 */
export function applyDiffusionStep(opts: {
  logits: Float32Array;
  audioCodes: Int32Array;
  nCodebooks: number;
  numFrames: number;
  vocabSize: number;
  maskTokenId: number;
  targetMaskedAfterStep: number;
  temperature: number;
  topP: number;
  rng: () => number;
}): { audioCodes: Int32Array; remainingMasked: number } {
  const {
    logits, audioCodes, nCodebooks, numFrames, vocabSize, maskTokenId,
    targetMaskedAfterStep, temperature, topP, rng,
  } = opts;

  // For each currently masked position, sample a candidate + record confidence
  type Candidate = { cb: number; t: number; tokenId: number; confidence: number };
  const candidates: Candidate[] = [];

  for (let cb = 0; cb < nCodebooks; cb++) {
    for (let t = 0; t < numFrames; t++) {
      const idx = cb * numFrames + t;
      if (audioCodes[idx] !== maskTokenId) continue;

      const offset = (cb * numFrames + t) * vocabSize;
      const slice = logits.subarray(offset, offset + vocabSize);

      const tokenId = sampleFromLogits(slice, temperature, topP, rng);

      // Confidence = softmax prob of sampled token (recompute, cheap)
      let maxL = -Infinity;
      for (let i = 0; i < vocabSize; i++) if (slice[i] > maxL) maxL = slice[i];
      let denom = 0;
      for (let i = 0; i < vocabSize; i++) denom += Math.exp(slice[i] - maxL);
      const conf = Math.exp(slice[tokenId] - maxL) / Math.max(denom, 1e-9);

      candidates.push({ cb, t, tokenId, confidence: conf });
    }
  }

  // Sort by confidence desc — fill the most confident positions first
  candidates.sort((a, b) => b.confidence - a.confidence);

  const totalMasked = candidates.length;
  const toUnmask = Math.max(0, totalMasked - targetMaskedAfterStep);

  for (let i = 0; i < toUnmask; i++) {
    const c = candidates[i];
    audioCodes[c.cb * numFrames + c.t] = c.tokenId;
  }

  return { audioCodes, remainingMasked: totalMasked - toUnmask };
}

/**
 * Compute the target number of masked positions remaining at each step.
 * Returns an array of length `numSteps + 1` where index 0 = full mask
 * and last index = 0 masked.
 */
export function buildMaskSchedule(
  totalPositions: number,
  numSteps: number,
  tShift: number = 1.0,
): number[] {
  const schedule: number[] = [];
  for (let step = 0; step <= numSteps; step++) {
    const t = step / numSteps;
    const ratio = maskScheduleCosine(t, tShift);
    schedule.push(Math.round(totalPositions * ratio));
  }
  // Force last step to fully unmask
  schedule[schedule.length - 1] = 0;
  return schedule;
}

export { makeRng };
