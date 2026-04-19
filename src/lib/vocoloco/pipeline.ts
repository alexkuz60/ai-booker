/**
 * VocoLoco — end-to-end pipeline orchestrator (faithful port of OmniVoice).
 *
 * Two public entry points:
 *   - `designVoice({ text, params })` — text + optional `instruct/language`
 *   - `cloneVoice({ text, refAudioPcm, refText, params })` — voice cloning
 *
 * Architectural shape (matches upstream `_generate_iterative`):
 *
 *   1. Tokenize the OmniVoice prompt:
 *        style := [<|denoise|>] <|lang_start|>{lang}<|lang_end|>
 *                 <|instruct_start|>{instruct}<|instruct_end|>
 *        text  := <|text_start|>{text}<|text_end|>
 *      Each text-token row is REPEATED across all 8 audio codebooks.
 *
 *   2. (Cloning only) Encoder forward → ref_audio_codes [1, 8, T_ref].
 *      Released BEFORE LLM loads to free 654 MB VRAM.
 *
 *   3. Build the LLM input as 3D `int64[1, 8, L]`:
 *        L = |style| + |text| + (T_ref) + T_target
 *      …then DUPLICATE the batch for CFG: shape becomes `[2, 8, L]`.
 *      Conditional sample = full prompt; unconditional sample = ONLY the
 *      target slice (last T_ref + T_target columns, padded left with mask).
 *
 *   4. Diffusion loop (`numSteps` iterations):
 *        - Single LLM forward over `[2, 8, L]`
 *        - Slice cond/uncond logits over the target columns
 *        - applyDiffusionStep → CFG combine + Gumbel + layer_penalty
 *        - Write predicted tokens back into the target slice of input_ids
 *          for BOTH cond and uncond branches.
 *
 *   5. Trim the leading `T_ref` frames if cloning, then run the decoder on
 *      the final `[1, 8, T_target]` codes → 24 kHz mono Float32 waveform.
 *
 * STAGED RELEASE: encoder → drop → LLM → drop → decoder. Worker termination
 * after final decode is the only reliable VRAM release in browsers.
 */
import { VOCOLOCO_CONFIG } from "./config";
import {
  VOCOLOCO_DECODER,
  VOCOLOCO_ENCODER,
  VOCOLOCO_LLM_DEFAULT_ID,
  findVocoLocoModel,
} from "./modelRegistry";
import {
  createVocoLocoSession,
  releaseVocoLocoSession,
  runVocoLocoSession,
  terminateVocoLocoWorker,
  type TensorInput,
  type VocoLocoBackend,
} from "./workerClient";
import { tokenizeOmniVoiceText } from "./tokenizer";
import { buildOmniVoicePrompt } from "./specialTokens";
import {
  applyDiffusionStep,
  buildUnmaskSchedule,
  DEFAULT_DIFFUSION_PARAMS,
  makeRng,
  type DiffusionParams,
} from "./diffusionSampler";

export interface VocoLocoSynthesisInput {
  text: string;
  /** Optional language hint (e.g. "Russian", "English"). null = language-agnostic. */
  language?: string | null;
  /** Voice-design instruction (e.g. "male, calm, low pitch"). Ignored in cloning. */
  instruct?: string | null;
  llmModelId?: string;
  backend?: VocoLocoBackend;
  /** Target audio length in seconds. Default 4 s. */
  targetSeconds?: number;
  params?: Partial<DiffusionParams>;
  onProgress?: (info: { stage: string; fraction: number; message?: string }) => void;
  /** Terminate the worker after synthesis (full VRAM cleanup). Default: true. */
  terminateOnDone?: boolean;
}

export interface VocoLocoCloningInput extends VocoLocoSynthesisInput {
  /** Mono 24 kHz Float32 PCM samples (use omniVoiceAudioPrep / decodeBlobToMono24kFloat32). */
  refAudioPcm: Float32Array;
  /** Transcription of the reference audio. Improves cloning quality significantly. */
  refText?: string | null;
}

export interface VocoLocoSynthesisResult {
  audio: Float32Array;
  sampleRate: number;
  durationSec: number;
  elapsedMs: number;
  effectiveParams: DiffusionParams;
}

function mergeParams(p?: Partial<DiffusionParams>): DiffusionParams {
  return { ...DEFAULT_DIFFUSION_PARAMS, ...(p ?? {}) };
}

function bigInt64FromIntArray(arr: ArrayLike<number>): BigInt64Array {
  const out = new BigInt64Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = BigInt(arr[i] | 0);
  return out;
}

/**
 * Replicate a 1-D row of token ids across `nCodebooks` rows — mirrors
 * upstream `tokens.repeat(num_audio_codebook, 1)`.
 *
 * Returns Int32Array of length `nCodebooks * row.length` in row-major
 * (codebook-major) layout matching our [C, L] convention.
 */
function repeatRowAcrossCodebooks(row: number[], nCodebooks: number): Int32Array {
  const L = row.length;
  const out = new Int32Array(nCodebooks * L);
  for (let cb = 0; cb < nCodebooks; cb++) {
    for (let i = 0; i < L; i++) out[cb * L + i] = row[i] | 0;
  }
  return out;
}

/** Concatenate two [C, L] Int32Array blocks along L. */
function concatColumns(blocks: { data: Int32Array; cols: number }[], nCodebooks: number): Int32Array {
  let totalCols = 0;
  for (const b of blocks) totalCols += b.cols;
  const out = new Int32Array(nCodebooks * totalCols);
  for (let cb = 0; cb < nCodebooks; cb++) {
    let dstOff = cb * totalCols;
    for (const b of blocks) {
      const srcOff = cb * b.cols;
      out.set(b.data.subarray(srcOff, srcOff + b.cols), dstOff);
      dstOff += b.cols;
    }
  }
  return out;
}

/** Pack two [C, L] blocks into a batched [2, C, L] int64 buffer in C order. */
function packBatchInt64(
  cond: Int32Array,
  uncond: Int32Array,
  nCodebooks: number,
  L: number,
): BigInt64Array {
  const out = new BigInt64Array(2 * nCodebooks * L);
  for (let cb = 0; cb < nCodebooks; cb++) {
    const dstC = cb * L;
    const dstU = nCodebooks * L + cb * L;
    const srcC = cb * L;
    const srcU = cb * L;
    for (let i = 0; i < L; i++) {
      out[dstC + i] = BigInt(cond[srcC + i] | 0);
      out[dstU + i] = BigInt(uncond[srcU + i] | 0);
    }
  }
  return out;
}

/**
 * Run the encoder on a fixed-length 1 s reference window and return
 * `[8, T_ref]` audio codes.
 */
async function encodeReference(
  refAudioPcm: Float32Array,
  backend: VocoLocoBackend | undefined,
): Promise<{ codes: Int32Array; framesPerCodebook: number }> {
  const ENCODER_INPUT_SAMPLES = 24_000; // 1 s at 24 kHz — encoder graph is static
  const fixed = new Float32Array(ENCODER_INPUT_SAMPLES);
  if (refAudioPcm.length >= ENCODER_INPUT_SAMPLES) {
    const start = Math.floor((refAudioPcm.length - ENCODER_INPUT_SAMPLES) / 2);
    fixed.set(refAudioPcm.subarray(start, start + ENCODER_INPUT_SAMPLES));
  } else {
    fixed.set(refAudioPcm, 0);
  }

  await createVocoLocoSession(VOCOLOCO_ENCODER.id, { backend });
  try {
    const outputs = await runVocoLocoSession(VOCOLOCO_ENCODER.id, [
      {
        name: "input_values",
        buffer: fixed.buffer,
        dims: [1, 1, ENCODER_INPUT_SAMPLES],
        dtype: "float32",
      },
    ]);
    const codesOut = outputs.find((o) => o.name === "audio_codes");
    if (!codesOut) throw new Error("[VocoLoco] Encoder did not return audio_codes");
    const i64 = new BigInt64Array(codesOut.buffer);
    const codes = new Int32Array(i64.length);
    for (let i = 0; i < i64.length; i++) codes[i] = Number(i64[i]);
    const framesPerCodebook =
      codesOut.dims[2] ?? Math.floor(i64.length / VOCOLOCO_CONFIG.nCodebooks);
    return { codes, framesPerCodebook };
  } finally {
    await releaseVocoLocoSession(VOCOLOCO_ENCODER.id);
  }
}

/** Pull the target slice of logits out of a `[2, 8, L, V]` block. */
function sliceTargetLogits(
  logits: Float32Array,
  batchIdx: number, // 0 = cond, 1 = uncond
  startCol: number, // first column of the target window
  numFrames: number,
  nCodebooks: number,
  L: number,
  vocabSize: number,
): Float32Array {
  // Layout: [B=2, C=8, L, V] — flat index = ((b*C + c)*L + l)*V + v
  const out = new Float32Array(nCodebooks * numFrames * vocabSize);
  for (let cb = 0; cb < nCodebooks; cb++) {
    for (let t = 0; t < numFrames; t++) {
      const srcStart = ((batchIdx * nCodebooks + cb) * L + (startCol + t)) * vocabSize;
      const dstStart = (cb * numFrames + t) * vocabSize;
      out.set(logits.subarray(srcStart, srcStart + vocabSize), dstStart);
    }
  }
  return out;
}

interface BuildPromptResult {
  /** Cond block: [C, L_cond] — style + text [+ ref] + target(masked) */
  condBlock: Int32Array;
  condCols: number;
  /** Uncond block: [C, L_uncond] — only [ref +] target(masked), padded LEFT to L_max with mask */
  uncondBlock: Int32Array;
  uncondCols: number;
  /** Position (column index) where the GENERATED region starts in cond block. */
  condTargetStart: number;
  /** Same for uncond. */
  uncondTargetStart: number;
  /** Length (columns) of the target window — same for both. */
  targetCols: number;
  /** Reference frames (0 in design mode). */
  refFrames: number;
}

async function buildPromptBlocks(opts: {
  text: string;
  language: string | null;
  instruct: string | null;
  refCodes: Int32Array | null;
  refFrames: number;
  refText: string | null;
  numTargetFrames: number;
  nCodebooks: number;
  maskTokenId: number;
}): Promise<BuildPromptResult> {
  const {
    text, language, instruct, refCodes, refFrames, refText,
    numTargetFrames, nCodebooks, maskTokenId,
  } = opts;

  const prompt = buildOmniVoicePrompt(refText && refCodes ? `${refText} ${text}` : text, {
    language,
    instruct,
    denoise: refCodes !== null,
  });

  const styleIds = await tokenizeOmniVoiceText(prompt.stylePrompt);
  const textIds = await tokenizeOmniVoiceText(prompt.textPrompt);

  const styleBlock = repeatRowAcrossCodebooks(styleIds, nCodebooks);
  const styleCols = styleIds.length;
  const textBlock = repeatRowAcrossCodebooks(textIds, nCodebooks);
  const textCols = textIds.length;

  // Target = all mask tokens.
  const targetCols = numTargetFrames + refFrames;
  const targetBlock = new Int32Array(nCodebooks * targetCols);
  targetBlock.fill(maskTokenId);
  // If we have ref codes, slot them in at the START of the target window.
  if (refCodes && refFrames > 0) {
    for (let cb = 0; cb < nCodebooks; cb++) {
      const dstOff = cb * targetCols;
      const srcOff = cb * refFrames;
      targetBlock.set(refCodes.subarray(srcOff, srcOff + refFrames), dstOff);
    }
  }

  // Cond block = style ‖ text ‖ target
  const condBlock = concatColumns(
    [
      { data: styleBlock, cols: styleCols },
      { data: textBlock, cols: textCols },
      { data: targetBlock, cols: targetCols },
    ],
    nCodebooks,
  );
  const condCols = styleCols + textCols + targetCols;
  const condTargetStart = styleCols + textCols;

  // Uncond block = only the target window (matches upstream taking [..., -u_len:]).
  const uncondBlock = new Int32Array(nCodebooks * targetCols);
  uncondBlock.set(targetBlock);
  const uncondCols = targetCols;
  const uncondTargetStart = 0;

  return {
    condBlock, condCols, uncondBlock, uncondCols,
    condTargetStart, uncondTargetStart, targetCols, refFrames,
  };
}

/** Run the diffusion loop and return final `[8, T_target]` codes (ref-trimmed). */
async function runDiffusionLoop(opts: {
  llmModelId: string;
  prompt: BuildPromptResult;
  numTargetFrames: number;
  nCodebooks: number;
  vocabSize: number;
  maskTokenId: number;
  params: DiffusionParams;
  onProgress?: VocoLocoSynthesisInput["onProgress"];
}): Promise<Int32Array> {
  const {
    llmModelId, prompt, numTargetFrames, nCodebooks, vocabSize, maskTokenId,
    params, onProgress,
  } = opts;

  // Pad cond/uncond to the SAME column length (max of both) so we can
  // pack them into a single [2, 8, L_max] tensor.
  const Lmax = Math.max(prompt.condCols, prompt.uncondCols);
  const condPadded = new Int32Array(nCodebooks * Lmax);
  condPadded.fill(maskTokenId);
  const uncondPadded = new Int32Array(nCodebooks * Lmax);
  uncondPadded.fill(maskTokenId);
  // We pad on the RIGHT for the cond branch (target window already at end);
  // for uncond branch the slice is already at the start — we right-pad too.
  for (let cb = 0; cb < nCodebooks; cb++) {
    condPadded.set(prompt.condBlock.subarray(cb * prompt.condCols, (cb + 1) * prompt.condCols), cb * Lmax);
    uncondPadded.set(prompt.uncondBlock.subarray(cb * prompt.uncondCols, (cb + 1) * prompt.uncondCols), cb * Lmax);
  }

    // Audio mask: 1 where positions are AUDIO tokens (target window).
    // The exported ONNX (gluschenko) takes int64 here even though the
    // upstream PyTorch graph used torch.bool — the bool→int64 cast is
    // folded into the export, and ORT-Web rejects bool input at runtime.
    const audioMaskInt64 = new BigInt64Array(2 * Lmax);
    for (let i = 0; i < prompt.targetCols; i++) {
      audioMaskInt64[prompt.condTargetStart + i] = 1n;
      audioMaskInt64[Lmax + prompt.uncondTargetStart + i] = 1n;
    }

  // Attention mask: 4D [B=2, 1, L, L] bool. Allow attention within each
  // sample's REAL (non-padded) length; pad-rows attend only to themselves
  // (diagonal only) — same trick upstream uses for batch padding.
  const attnLen = Lmax * Lmax;
  const attentionMask = new Uint8Array(2 * attnLen);
  // cond branch real length = condCols (padded right to Lmax)
  for (let q = 0; q < prompt.condCols; q++)
    for (let k = 0; k < prompt.condCols; k++) attentionMask[q * Lmax + k] = 1;
  for (let q = prompt.condCols; q < Lmax; q++) attentionMask[q * Lmax + q] = 1;
  // uncond branch real length = uncondCols
  for (let q = 0; q < prompt.uncondCols; q++)
    for (let k = 0; k < prompt.uncondCols; k++) attentionMask[attnLen + q * Lmax + k] = 1;
  for (let q = prompt.uncondCols; q < Lmax; q++) attentionMask[attnLen + q * Lmax + q] = 1;

  // Standalone target-window state we drive separately, then mirror back
  // into both cond/uncond input_ids each step.
  const tokens = new Int32Array(nCodebooks * numTargetFrames);
  tokens.fill(maskTokenId);

  const totalMaskable = nCodebooks * numTargetFrames;
  const schedule = buildUnmaskSchedule(totalMaskable, params.numSteps, params.tShift);
  const rng = makeRng(params.seed);

  for (let step = 0; step < params.numSteps; step++) {
    // Pack [2, 8, L_max] int64 input_ids snapshot.
    const packedIds = packBatchInt64(condPadded, uncondPadded, nCodebooks, Lmax);

    const feeds: TensorInput[] = [
      {
        name: "input_ids",
        buffer: packedIds.buffer as ArrayBuffer,
        dims: [2, nCodebooks, Lmax],
        dtype: "int64",
      },
      {
        name: "audio_mask",
        buffer: audioMaskInt64.buffer as ArrayBuffer,
        dims: [2, Lmax],
        dtype: "int64",
      },
      {
        name: "attention_mask",
        // ORT-Web bool tensor: 1 byte per element.
        buffer: new Uint8Array(attentionMask).buffer,
        dims: [2, 1, Lmax, Lmax],
        dtype: "bool",
      },
      {
        name: "position_ids",
        buffer: bigInt64FromIntArray(
          (() => {
            const arr = new Array(2 * Lmax);
            for (let b = 0; b < 2; b++) for (let i = 0; i < Lmax; i++) arr[b * Lmax + i] = i;
            return arr;
          })(),
        ).buffer as ArrayBuffer,
        dims: [2, Lmax],
        dtype: "int64",
      },
    ];

    const outputs = await runVocoLocoSession(llmModelId, feeds);
    const logitsOut = outputs.find((o) => o.name === "logits");
    if (!logitsOut) throw new Error("[VocoLoco] LLM did not return logits");
    const logits = new Float32Array(logitsOut.buffer);
    // Expected dims: [2, 8, L_max, V]. We just trust the contract test.

    // Slice cond+uncond logits over the target window (only the actual
    // target columns — schedule operates on the unpadded slice).
    const condLogits = sliceTargetLogits(
      logits, 0, prompt.condTargetStart, prompt.targetCols,
      nCodebooks, Lmax, VOCOLOCO_CONFIG.vocabSize,
    );
    const uncondLogits = sliceTargetLogits(
      logits, 1, prompt.uncondTargetStart, prompt.targetCols,
      nCodebooks, Lmax, VOCOLOCO_CONFIG.vocabSize,
    );

    // We only run the diffusion step over the GENERATED frames (skip ref prefix).
    // Build a `tokens`-shaped [8, numTargetFrames] view from the codes; the
    // ref prefix in target window is already filled (not mask), so the
    // sampler naturally ignores it — but we slice to keep things explicit.
    const trailingCondLogits = new Float32Array(nCodebooks * numTargetFrames * VOCOLOCO_CONFIG.vocabSize);
    const trailingUncondLogits = new Float32Array(nCodebooks * numTargetFrames * VOCOLOCO_CONFIG.vocabSize);
    for (let cb = 0; cb < nCodebooks; cb++) {
      for (let t = 0; t < numTargetFrames; t++) {
        const srcOff = (cb * prompt.targetCols + (prompt.refFrames + t)) * VOCOLOCO_CONFIG.vocabSize;
        const dstOff = (cb * numTargetFrames + t) * VOCOLOCO_CONFIG.vocabSize;
        trailingCondLogits.set(
          condLogits.subarray(srcOff, srcOff + VOCOLOCO_CONFIG.vocabSize),
          dstOff,
        );
        trailingUncondLogits.set(
          uncondLogits.subarray(srcOff, srcOff + VOCOLOCO_CONFIG.vocabSize),
          dstOff,
        );
      }
    }

    applyDiffusionStep({
      condLogits: trailingCondLogits,
      uncondLogits: trailingUncondLogits,
      audioCodes: tokens,
      nCodebooks,
      numFrames: numTargetFrames,
      vocabSize,
      maskTokenId,
      unmaskCount: schedule[step],
      guidanceScale: params.guidanceScale,
      layerPenaltyFactor: params.layerPenaltyFactor,
      positionTemperature: params.positionTemperature,
      classTemperature: params.classTemperature,
      rng,
    });

    // Mirror updated tokens back into BOTH cond and uncond input blocks
    // (target window only, after the ref prefix).
    for (let cb = 0; cb < nCodebooks; cb++) {
      for (let t = 0; t < numTargetFrames; t++) {
        const v = tokens[cb * numTargetFrames + t];
        const condIdx = cb * Lmax + prompt.condTargetStart + prompt.refFrames + t;
        const uncondIdx = cb * Lmax + prompt.uncondTargetStart + prompt.refFrames + t;
        condPadded[condIdx] = v;
        uncondPadded[uncondIdx] = v;
      }
    }

    onProgress?.({
      stage: "diffusion",
      fraction: (step + 1) / params.numSteps,
      message: `Step ${step + 1}/${params.numSteps}`,
    });
  }

  return tokens;
}

/** Run the decoder on `[8, T_target]` codes and return 24 kHz Float32 PCM. */
async function runDecoder(audioCodes: Int32Array, numFrames: number): Promise<Float32Array> {
  const { nCodebooks } = VOCOLOCO_CONFIG;
  const outputs = await runVocoLocoSession(VOCOLOCO_DECODER.id, [
    {
      name: "audio_codes",
      buffer: audioCodes.buffer.slice(0) as ArrayBuffer,
      dims: [1, nCodebooks, numFrames],
      dtype: "int32_as_int64",
    },
  ]);
  const wavOut = outputs.find((o) => o.name === "audio_values");
  if (!wavOut) throw new Error("[VocoLoco] Decoder did not return audio_values");
  return new Float32Array(wavOut.buffer);
}

async function runOmniVoice(
  input: VocoLocoSynthesisInput & { refAudioPcm?: Float32Array; refText?: string | null },
): Promise<VocoLocoSynthesisResult> {
  const t0 = performance.now();
  const params = mergeParams(input.params);
  const llmId = input.llmModelId ?? VOCOLOCO_LLM_DEFAULT_ID;
  const llmEntry = findVocoLocoModel(llmId);
  if (!llmEntry || llmEntry.role !== "llm") {
    throw new Error(`[VocoLoco] Invalid LLM model id: ${llmId}`);
  }

  const targetSec = input.targetSeconds ?? 4.0;
  const numTargetFrames = Math.max(8, Math.round(targetSec * VOCOLOCO_CONFIG.framesPerSecond));
  const { nCodebooks, vocabSize, maskTokenId } = VOCOLOCO_CONFIG;

  // Stage 1 — encoder (cloning only)
  let refCodes: Int32Array | null = null;
  let refFrames = 0;
  if (input.refAudioPcm) {
    input.onProgress?.({ stage: "load-encoder", fraction: 0, message: "Loading encoder" });
    const enc = await encodeReference(input.refAudioPcm, input.backend);
    refCodes = enc.codes;
    refFrames = enc.framesPerCodebook;
    input.onProgress?.({ stage: "encode-ref", fraction: 0.1, message: `Reference encoded (${refFrames} frames)` });
  }

  // Stage 2 — build prompt blocks
  input.onProgress?.({ stage: "tokenize", fraction: 0.15, message: "Tokenizing prompt" });
  const prompt = await buildPromptBlocks({
    text: input.text,
    language: input.language ?? null,
    instruct: input.instruct ?? null,
    refCodes,
    refFrames,
    refText: input.refText ?? null,
    numTargetFrames,
    nCodebooks,
    maskTokenId,
  });

  // Stage 3 — load LLM and run diffusion
  input.onProgress?.({ stage: "load-llm", fraction: 0.2, message: "Loading LLM session" });
  await createVocoLocoSession(llmId, { backend: input.backend });

  let tokens: Int32Array;
  try {
    tokens = await runDiffusionLoop({
      llmModelId: llmId,
      prompt,
      numTargetFrames,
      nCodebooks,
      vocabSize,
      maskTokenId,
      params,
      onProgress: input.onProgress,
    });
  } finally {
    await releaseVocoLocoSession(llmId);
  }

  // Stage 4 — decoder
  input.onProgress?.({ stage: "load-decoder", fraction: 0.95, message: "Loading decoder" });
  await createVocoLocoSession(VOCOLOCO_DECODER.id, { backend: input.backend });

  let audio: Float32Array;
  try {
    audio = await runDecoder(tokens, numTargetFrames);
  } finally {
    await releaseVocoLocoSession(VOCOLOCO_DECODER.id);
  }

  if (input.terminateOnDone !== false) terminateVocoLocoWorker();

  const elapsed = performance.now() - t0;
  input.onProgress?.({ stage: "done", fraction: 1, message: `${elapsed.toFixed(0)} ms` });

  return {
    audio,
    sampleRate: VOCOLOCO_CONFIG.sampleRate,
    durationSec: audio.length / VOCOLOCO_CONFIG.sampleRate,
    elapsedMs: elapsed,
    effectiveParams: params,
  };
}

export async function designVoice(input: VocoLocoSynthesisInput): Promise<VocoLocoSynthesisResult> {
  return runOmniVoice(input);
}

export async function cloneVoice(input: VocoLocoCloningInput): Promise<VocoLocoSynthesisResult> {
  if (!input.refAudioPcm || input.refAudioPcm.length === 0) {
    throw new Error("[VocoLoco] cloneVoice requires non-empty refAudioPcm");
  }
  return runOmniVoice(input);
}
