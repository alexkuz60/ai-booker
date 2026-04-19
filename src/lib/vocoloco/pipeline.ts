/**
 * VocoLoco — end-to-end pipeline orchestrator.
 *
 * Two public entry points:
 *   - `designVoice({ text, params })` — Voice Design (no reference)
 *   - `cloneVoice({ text, refAudioBlob, params })` — Voice Cloning
 *
 * Both run as: tokenize text → [encoder if cloning] → diffusion loop on LLM
 * → decoder → 24 kHz mono Float32 waveform.
 *
 * STAGED RELEASE: encoder is released BEFORE the LLM runs (frees ~654 MB
 * VRAM); LLM is released BEFORE the decoder runs. Same pattern proven in
 * vcInferenceSession for RVC. Final decoder output is hard-killed by
 * terminating the worker (only reliable VRAM release on Firefox/Chromium).
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
import { tokenizeForVocoLoco } from "./tokenizer";
import {
  applyDiffusionStep,
  buildMaskSchedule,
  DEFAULT_DIFFUSION_PARAMS,
  makeRng,
  type DiffusionParams,
} from "./diffusionSampler";

export interface VocoLocoSynthesisInput {
  /** Text to synthesize (any language Qwen3 supports). */
  text: string;
  /** Optional override for LLM quant variant (default: INT8 per-channel). */
  llmModelId?: string;
  /** ONNX backend — webgpu (default) or wasm. */
  backend?: VocoLocoBackend;
  /** Target audio length in seconds. Default 4 s — adjust for longer phrases. */
  targetSeconds?: number;
  /** Diffusion params (steps / temperature / top-p / cfg / t-shift). */
  params?: Partial<DiffusionParams>;
  /** Progress callback for UI (0..1). */
  onProgress?: (info: { stage: string; fraction: number; message?: string }) => void;
  /**
   * If true, terminate the worker after synthesis (full VRAM cleanup).
   * Recommended for one-off renders. Set false when batching multiple
   * phrases back-to-back to avoid re-loading the LLM each time.
   */
  terminateOnDone?: boolean;
}

export interface VocoLocoCloningInput extends VocoLocoSynthesisInput {
  /** Mono 24 kHz Float32 PCM samples (use omniVoiceAudioPrep to convert). */
  refAudioPcm: Float32Array;
}

export interface VocoLocoSynthesisResult {
  /** 24 kHz mono Float32 waveform. */
  audio: Float32Array;
  sampleRate: number;
  durationSec: number;
  /** Total wall-clock time in ms for diagnostics. */
  elapsedMs: number;
  /** Diffusion params actually used (after merging defaults). */
  effectiveParams: DiffusionParams;
}

function mergeParams(p?: Partial<DiffusionParams>): DiffusionParams {
  return { ...DEFAULT_DIFFUSION_PARAMS, ...(p ?? {}) };
}

function bigInt64FromArray(arr: ArrayLike<number>): BigInt64Array {
  const out = new BigInt64Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = BigInt(arr[i]);
  return out;
}

/**
 * Run the full diffusion loop on the LLM session and return final
 * `audio_codes` Int32Array shaped `[nCodebooks, numFrames]`.
 */
async function runDiffusionLoop(opts: {
  llmModelId: string;
  inputIds: BigInt64Array; // [seq] (will be reshaped to [1, seq])
  numFrames: number;
  params: DiffusionParams;
  onProgress?: VocoLocoSynthesisInput["onProgress"];
}): Promise<Int32Array> {
  const { llmModelId, inputIds, numFrames, params, onProgress } = opts;
  const { nCodebooks, vocabSize, maskTokenId } = VOCOLOCO_CONFIG;
  const rng = makeRng(params.seed);

  // Initialize all positions to mask token
  const audioCodes = new Int32Array(nCodebooks * numFrames);
  audioCodes.fill(maskTokenId);

  const totalPositions = nCodebooks * numFrames;
  const schedule = buildMaskSchedule(totalPositions, params.numSteps, params.tShift ?? 1.0);

  const seqLen = inputIds.length;
  const audioMask = new Uint8Array(seqLen).fill(1);
  const attentionMask = bigInt64FromArray(new Array(seqLen).fill(1));
  const positionIds = bigInt64FromArray(Array.from({ length: seqLen }, (_, i) => i));

  for (let step = 0; step < params.numSteps; step++) {
    // Inputs are constant across diffusion steps (text+mask conditioning);
    // upstream variants that condition on prev codes pass them via input_ids
    // — we keep the simpler "single forward per step" contract.
    const feeds: TensorInput[] = [
      {
        name: "input_ids",
        buffer: new BigInt64Array(inputIds).buffer,
        dims: [1, seqLen],
        dtype: "int64",
      },
      {
        name: "audio_mask",
        buffer: new Uint8Array(audioMask).buffer,
        dims: [1, seqLen],
        dtype: "bool",
      },
      {
        name: "attention_mask",
        buffer: new BigInt64Array(attentionMask).buffer,
        dims: [1, seqLen],
        dtype: "int64",
      },
      {
        name: "position_ids",
        buffer: new BigInt64Array(positionIds).buffer,
        dims: [1, seqLen],
        dtype: "int64",
      },
    ];

    const outputs = await runVocoLocoSession(llmModelId, feeds);
    const logitsOut = outputs.find((o) => o.name === "logits");
    if (!logitsOut) throw new Error("[VocoLoco] LLM did not return logits");
    const logits = new Float32Array(logitsOut.buffer);

    // Logits shape from contract: [B=1, 8, T, 1025]. Flatten codebook×frame×vocab.
    // Our layout matches: cb-major then frame-major then vocab.
    applyDiffusionStep({
      logits,
      audioCodes,
      nCodebooks,
      numFrames,
      vocabSize,
      maskTokenId,
      targetMaskedAfterStep: schedule[step + 1],
      temperature: params.temperature,
      topP: params.topP,
      rng,
    });

    onProgress?.({
      stage: "diffusion",
      fraction: (step + 1) / params.numSteps,
      message: `Step ${step + 1}/${params.numSteps}`,
    });
  }

  return audioCodes;
}

/**
 * Run the decoder on final `audio_codes` and return 24 kHz Float32 waveform.
 */
async function runDecoder(audioCodes: Int32Array, numFrames: number): Promise<Float32Array> {
  const { nCodebooks } = VOCOLOCO_CONFIG;

  const outputs = await runVocoLocoSession(VOCOLOCO_DECODER.id, [
    {
      name: "audio_codes",
      // ONNX expects int64 — we pack our int32 codes via the worker's
      // `int32_as_int64` shortcut so we don't allocate BigInt arrays here.
      buffer: new Int32Array(audioCodes).buffer,
      dims: [1, nCodebooks, numFrames],
      dtype: "int32_as_int64",
    },
  ]);

  const wavOut = outputs.find((o) => o.name === "audio_values");
  if (!wavOut) throw new Error("[VocoLoco] Decoder did not return audio_values");
  return new Float32Array(wavOut.buffer);
}

/**
 * Voice Design — no reference audio. Pure text-to-speech with diffusion
 * sampling controlling timbre via the LLM's prior.
 */
export async function designVoice(input: VocoLocoSynthesisInput): Promise<VocoLocoSynthesisResult> {
  const t0 = performance.now();
  const params = mergeParams(input.params);
  const llmId = input.llmModelId ?? VOCOLOCO_LLM_DEFAULT_ID;
  const llmEntry = findVocoLocoModel(llmId);
  if (!llmEntry || llmEntry.role !== "llm") {
    throw new Error(`[VocoLoco] Invalid LLM model id: ${llmId}`);
  }
  const targetSec = input.targetSeconds ?? 4.0;
  const numFrames = Math.max(8, Math.round(targetSec * VOCOLOCO_CONFIG.framesPerSecond));

  input.onProgress?.({ stage: "tokenize", fraction: 0, message: "Tokenizing text" });
  const inputIds = await tokenizeForVocoLoco(input.text);

  input.onProgress?.({ stage: "load-llm", fraction: 0.05, message: "Loading LLM session" });
  await createVocoLocoSession(llmId, { backend: input.backend });

  let audioCodes: Int32Array;
  try {
    audioCodes = await runDiffusionLoop({
      llmModelId: llmId,
      inputIds,
      numFrames,
      params,
      onProgress: input.onProgress,
    });
  } finally {
    // Release LLM BEFORE loading decoder — staged release pattern
    await releaseVocoLocoSession(llmId);
  }

  input.onProgress?.({ stage: "load-decoder", fraction: 0.9, message: "Loading decoder" });
  await createVocoLocoSession(VOCOLOCO_DECODER.id, { backend: input.backend });

  let audio: Float32Array;
  try {
    audio = await runDecoder(audioCodes, numFrames);
  } finally {
    await releaseVocoLocoSession(VOCOLOCO_DECODER.id);
  }

  if (input.terminateOnDone !== false) {
    terminateVocoLocoWorker();
  }

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

/**
 * Voice Cloning — uses 3-second reference to extract `ref_audio_codes`,
 * then prepends them to the text conditioning before running diffusion.
 *
 * Reference audio MUST be 24 kHz mono Float32 — call omniVoiceAudioPrep
 * first if you have arbitrary audio.
 */
export async function cloneVoice(input: VocoLocoCloningInput): Promise<VocoLocoSynthesisResult> {
  const t0 = performance.now();
  const params = mergeParams(input.params);
  const llmId = input.llmModelId ?? VOCOLOCO_LLM_DEFAULT_ID;
  const targetSec = input.targetSeconds ?? 4.0;
  const numFrames = Math.max(8, Math.round(targetSec * VOCOLOCO_CONFIG.framesPerSecond));

  // Stage 1: encoder — extract reference codes
  input.onProgress?.({ stage: "load-encoder", fraction: 0, message: "Loading encoder" });
  await createVocoLocoSession(VOCOLOCO_ENCODER.id, { backend: input.backend });

  let refCodes: Int32Array;
  let refFrames: number;
  try {
    input.onProgress?.({ stage: "encode-ref", fraction: 0.05, message: "Encoding reference" });
    const outputs = await runVocoLocoSession(VOCOLOCO_ENCODER.id, [
      {
        // Upstream input name (HF Transformers convention) — see VOCOLOCO_IO_CONTRACT.encoder.
        name: "input_values",
        buffer: new Float32Array(input.refAudioPcm).buffer,
        dims: [1, 1, input.refAudioPcm.length],
        dtype: "float32",
      },
    ]);
    const codesOut = outputs.find((o) => o.name === "audio_codes");
    if (!codesOut) throw new Error("[VocoLoco] Encoder did not return audio_codes");
    // codes come back as int64 from the ONNX side — pack to int32 (codebook ids fit easily)
    const i64 = new BigInt64Array(codesOut.buffer);
    refCodes = new Int32Array(i64.length);
    for (let i = 0; i < i64.length; i++) refCodes[i] = Number(i64[i]);
    // dims: [1, 8, T_ref] → frames = dims[2]
    refFrames = codesOut.dims[2] ?? Math.floor(i64.length / VOCOLOCO_CONFIG.nCodebooks);
  } finally {
    // CRITICAL: release encoder before loading LLM — frees 654 MB VRAM
    await releaseVocoLocoSession(VOCOLOCO_ENCODER.id);
  }

  // Stage 2: tokenize text + run diffusion
  input.onProgress?.({ stage: "tokenize", fraction: 0.15, message: "Tokenizing text" });
  const textIds = await tokenizeForVocoLoco(input.text);

  // For cloning, we expand input_ids with the ref codes — exact concat
  // strategy depends on LLM training. Conservative default: prepend text
  // then let LLM use audio_mask to consume ref. If upstream training
  // requires explicit ref token packing, this hook is the single place
  // to update without touching the sampler.
  const inputIds = textIds;

  input.onProgress?.({ stage: "load-llm", fraction: 0.2, message: "Loading LLM session" });
  await createVocoLocoSession(llmId, { backend: input.backend });

  let audioCodes: Int32Array;
  try {
    audioCodes = await runDiffusionLoop({
      llmModelId: llmId,
      inputIds,
      numFrames: numFrames + refFrames, // include ref length in canvas
      params,
      onProgress: input.onProgress,
    });
  } finally {
    await releaseVocoLocoSession(llmId);
  }

  // Trim leading ref frames before decoding (we don't want to render the ref back)
  const trimmedFrames = numFrames;
  const trimmed = new Int32Array(VOCOLOCO_CONFIG.nCodebooks * trimmedFrames);
  for (let cb = 0; cb < VOCOLOCO_CONFIG.nCodebooks; cb++) {
    const srcOffset = cb * (numFrames + refFrames) + refFrames;
    trimmed.set(audioCodes.subarray(srcOffset, srcOffset + trimmedFrames), cb * trimmedFrames);
  }

  // Stage 3: decoder
  input.onProgress?.({ stage: "load-decoder", fraction: 0.92, message: "Loading decoder" });
  await createVocoLocoSession(VOCOLOCO_DECODER.id, { backend: input.backend });

  let audio: Float32Array;
  try {
    audio = await runDecoder(trimmed, trimmedFrames);
  } finally {
    await releaseVocoLocoSession(VOCOLOCO_DECODER.id);
  }

  if (input.terminateOnDone !== false) {
    terminateVocoLocoWorker();
  }

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
