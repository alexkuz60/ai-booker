/**
 * VocoLoco — diffusion sampler (mask-predict + CFG + layer penalty).
 *
 * OmniVoice is NOT autoregressive — it does parallel masked diffusion over
 * `T_target` audio frames × 8 codebooks. Faithful port of the upstream
 * `_generate_iterative` and `_predict_tokens_with_scoring` from
 * github.com/k2-fsa/OmniVoice/omnivoice/models/omnivoice.py.
 *
 * Per step:
 *   1. LLM forward TWICE — once with full conditional input (style+text+
 *      [ref]+target), once with ONLY the target slice (uncond). The two
 *      logit slices are combined via Classifier-Free Guidance:
 *          log_p = log_softmax( c + cfg * (c - u) )
 *   2. Mask-out token id 1024 (audio_mask_id) — model never picks it
 *   3. Predicted token = argmax(log_p) (or Gumbel-temperature sample when
 *      class_temperature > 0)
 *   4. Confidence = max(log_p) - layer_penalty_factor * codebook_index
 *      (encourages bottom codebooks to be filled FIRST)
 *   5. Apply Gumbel position_temperature to confidence
 *   6. Pick top-k highest-confidence positions globally and write their
 *      predicted tokens into `audio_codes`. `k` = number of tokens this
 *      step's schedule allows to unmask.
 *
 * The schedule is built from a (t_shift-warped) cosine timeline, but we
 * unmask EXACT integer counts per step (not ratios) — same as upstream.
 *
 * All math runs on the main thread in Float32 — small arrays, fast loops.
 */
import { VOCOLOCO_CONFIG } from "./config";

export interface DiffusionParams {
  /** Number of denoising steps (typical 16–32). More = better quality, slower. */
  numSteps: number;
  /** CFG scale (>0). 0 disables CFG. Upstream default: 2.0. */
  guidanceScale: number;
  /** Time-shift for the schedule. <1 emphasises low-SNR steps. Upstream default: 0.1. */
  tShift: number;
  /** Penalty per codebook layer when scoring positions (encourages early layers first). Upstream default: 5.0. */
  layerPenaltyFactor: number;
  /** Gumbel temperature for position selection. Upstream default: 5.0. */
  positionTemperature: number;
  /** Gumbel temperature for token sampling. 0 = greedy argmax. Upstream default: 0.0. */
  classTemperature: number;
  /** Deterministic RNG seed (optional). */
  seed?: number;
}

export const DEFAULT_DIFFUSION_PARAMS: DiffusionParams = {
  numSteps: VOCOLOCO_CONFIG.defaultDiffusionSteps,
  guidanceScale: 2.0,
  tShift: 0.1,
  layerPenaltyFactor: 5.0,
  positionTemperature: 5.0,
  classTemperature: 0.0,
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
    return ((x >>> 0) / 0x100000000);
  }
}

export function makeRng(seed?: number): () => number {
  if (typeof seed === "number") {
    const r = new SeededRng(seed);
    return () => r.next();
  }
  return Math.random;
}

/**
 * Build the per-step schedule of how many tokens to UNMASK at each step.
 * Total tokens = T_target * nCodebooks. The cosine-shaped timeline is
 * shifted by `tShift` (smaller value = unmask less early on, more late).
 * Last step always drains everything that's left.
 *
 * Mirrors upstream `_get_time_steps` + the per-item loop:
 *   timesteps = linspace(0, 1, num_step+1)
 *   timesteps = t_shift * timesteps / (1 + (t_shift-1) * timesteps)
 *   k_step = ceil(total * (timesteps[i+1] - timesteps[i]))
 */
export function buildUnmaskSchedule(
  totalTokens: number,
  numSteps: number,
  tShift: number,
): number[] {
  const ts = new Float64Array(numSteps + 1);
  for (let i = 0; i <= numSteps; i++) {
    const t = i / numSteps;
    ts[i] = (tShift * t) / (1 + (tShift - 1) * t);
  }
  const out: number[] = [];
  let remaining = totalTokens;
  for (let step = 0; step < numSteps; step++) {
    const want =
      step === numSteps - 1
        ? remaining
        : Math.min(Math.ceil(totalTokens * (ts[step + 1] - ts[step])), remaining);
    const k = Math.max(0, want);
    out.push(k);
    remaining -= k;
  }
  return out;
}

/**
 * log_softmax over the last axis of a Float32Array slice.
 * Returns a NEW Float32Array of the same length.
 */
function logSoftmax(slice: Float32Array): Float32Array {
  const V = slice.length;
  let max = -Infinity;
  for (let i = 0; i < V; i++) if (slice[i] > max) max = slice[i];
  let sumExp = 0;
  for (let i = 0; i < V; i++) sumExp += Math.exp(slice[i] - max);
  const logZ = max + Math.log(sumExp);
  const out = new Float32Array(V);
  for (let i = 0; i < V; i++) out[i] = slice[i] - logZ;
  return out;
}

/** Gumbel(0,1) noise — `−log(−log(U))` with U ~ Uniform(0,1). */
function gumbelNoise(rng: () => number): number {
  // clamp to avoid log(0)
  const u = Math.max(rng(), 1e-12);
  return -Math.log(-Math.log(u));
}

export interface ApplyDiffusionStepInput {
  /** Conditional logits slice for the target region: layout `[8, T_target, V]` flat. */
  condLogits: Float32Array;
  /** Unconditional logits slice: same layout. */
  uncondLogits: Float32Array;
  /** Current audio_codes for the target: `[8, T_target]` flat (cb-major). */
  audioCodes: Int32Array;
  nCodebooks: number;
  numFrames: number;
  vocabSize: number;
  maskTokenId: number;
  /** How many positions to UNMASK in this step. */
  unmaskCount: number;
  guidanceScale: number;
  layerPenaltyFactor: number;
  positionTemperature: number;
  classTemperature: number;
  rng: () => number;
}

/**
 * Apply ONE diffusion step in-place. Returns the modified `audioCodes`.
 */
export function applyDiffusionStep(input: ApplyDiffusionStepInput): Int32Array {
  const {
    condLogits,
    uncondLogits,
    audioCodes,
    nCodebooks,
    numFrames,
    vocabSize,
    maskTokenId,
    unmaskCount,
    guidanceScale,
    layerPenaltyFactor,
    positionTemperature,
    classTemperature,
    rng,
  } = input;

  if (unmaskCount <= 0) return audioCodes;

  // For each masked position: compute predicted token + scoring confidence.
  type Cand = { idx: number; cb: number; tokenId: number; score: number };
  const cands: Cand[] = [];

  for (let cb = 0; cb < nCodebooks; cb++) {
    for (let t = 0; t < numFrames; t++) {
      const flatIdx = cb * numFrames + t;
      if (audioCodes[flatIdx] !== maskTokenId) continue;

      const offset = (cb * numFrames + t) * vocabSize;
      const cSlice = condLogits.subarray(offset, offset + vocabSize);
      const uSlice = uncondLogits.subarray(offset, offset + vocabSize);

      // Build CFG-combined log_probs.
      let logProbs: Float32Array;
      if (guidanceScale !== 0) {
        const cLog = logSoftmax(cSlice);
        const uLog = logSoftmax(uSlice);
        const combined = new Float32Array(vocabSize);
        for (let v = 0; v < vocabSize; v++) {
          combined[v] = cLog[v] + guidanceScale * (cLog[v] - uLog[v]);
        }
        logProbs = logSoftmax(combined);
      } else {
        logProbs = logSoftmax(cSlice);
      }

      // Suppress mask token — model must never re-emit it.
      logProbs[maskTokenId] = -Infinity;

      // Pick predicted token: argmax, or Gumbel sample if class_temperature > 0.
      let predToken = 0;
      let predLogProb = -Infinity;
      if (classTemperature > 0.0) {
        // Gumbel-max trick: argmax(log_p + temp * G) where G ~ Gumbel
        let bestScore = -Infinity;
        for (let v = 0; v < vocabSize; v++) {
          const lp = logProbs[v];
          if (!isFinite(lp)) continue;
          const noisy = lp + classTemperature * gumbelNoise(rng);
          if (noisy > bestScore) {
            bestScore = noisy;
            predToken = v;
          }
        }
        predLogProb = logProbs[predToken];
      } else {
        for (let v = 0; v < vocabSize; v++) {
          const lp = logProbs[v];
          if (lp > predLogProb) {
            predLogProb = lp;
            predToken = v;
          }
        }
      }

      // Confidence score with layer penalty + position Gumbel.
      let score = predLogProb - cb * layerPenaltyFactor;
      if (positionTemperature > 0.0) score += positionTemperature * gumbelNoise(rng);

      cands.push({ idx: flatIdx, cb, tokenId: predToken, score });
    }
  }

  if (cands.length === 0) return audioCodes;

  // Pick top-k by score (descending).
  cands.sort((a, b) => b.score - a.score);
  const k = Math.min(unmaskCount, cands.length);
  for (let i = 0; i < k; i++) {
    audioCodes[cands[i].idx] = cands[i].tokenId;
  }
  return audioCodes;
}
