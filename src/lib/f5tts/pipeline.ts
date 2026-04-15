/**
 * f5tts/pipeline.ts — F5-TTS synthesis pipeline.
 *
 * Three-stage ONNX pipeline:
 *  1. Encoder: ref_audio[1,1,N] int16 + text_tokens[1,L] int32 + duration[1] int64
 *     → noise, rope_cos, rope_sin, cat_mel_text, cat_mel_text_drop, ref_signal_len, ...
 *  2. Transformer: iterative NFE loop (16-32 steps)
 *     noise + rope_cos + rope_sin + cat_mel_text + cat_mel_text_drop + time_step → noise
 *  3. Decoder: noise + ref_signal_len → audio[1,1,M] int16
 *
 * All sessions managed through vcInferenceSession (worker-proxied ORT).
 */
import { ensureVcSession, runVcInference, releaseVcSession, type TensorDesc } from "../vcInferenceSession";
import { readF5Model } from "./modelRegistry";
import { tokenize } from "./tokenizer";
import type { F5Reference, F5SynthesisOptions, F5SynthesisResult, F5ModelId } from "./types";
import { F5_SAMPLE_RATE, F5_HOP_LENGTH } from "./types";

// Re-export for convenience
export { readF5Model } from "./modelRegistry";

/**
 * Ensure all 3 F5-TTS ONNX sessions are loaded in the worker.
 * Must be called before synthesize().
 */
export async function ensureF5Sessions(): Promise<void> {
  const modelIds: F5ModelId[] = ["f5tts-encoder", "f5tts-transformer", "f5tts-decoder"];
  for (const id of modelIds) {
    // readF5Model reads from OPFS cache
    const buffer = await readF5Model(id);
    await ensureVcSession(id, {
      modelBuffer: buffer,
      preferredBackend: "webgpu",
    });
  }
}

/**
 * Release all F5-TTS sessions to free VRAM.
 */
export async function releaseF5Sessions(): Promise<void> {
  for (const id of ["f5tts-encoder", "f5tts-transformer", "f5tts-decoder"] as F5ModelId[]) {
    await releaseVcSession(id).catch(() => {});
  }
}

/**
 * Calculate total duration in samples for F5-TTS.
 * Formula: refAudioLen + (refAudioLen / (refText.len + 1)) * genText.len / speed
 */
function calcDurationSamples(
  refSamples: number,
  refTextLen: number,
  genTextLen: number,
  speed: number,
): number {
  const charsPerSample = refSamples / (refTextLen + 1);
  const genSamples = Math.round(charsPerSample * genTextLen / speed);
  return refSamples + genSamples;
}

/**
 * Synthesize speech using F5-TTS.
 *
 * @param reference - Reference voice audio + transcript
 * @param text - Text to synthesize
 * @param options - Synthesis parameters
 */
export async function synthesizeF5(
  reference: F5Reference,
  text: string,
  options?: F5SynthesisOptions,
): Promise<F5SynthesisResult> {
  const nfeSteps = options?.nfeSteps ?? 16;
  const speed = options?.speed ?? 1.0;
  const onStep = options?.onStep;
  const t0 = performance.now();

  // Tokenize: concat ref_text + " " + gen_text
  const fullText = reference.text + " " + text;
  const tokens = tokenize(fullText);

  // Calculate duration
  const durationSamples = calcDurationSamples(
    reference.samples,
    reference.text.length,
    text.length,
    speed,
  );
  const durationBigInt = new BigInt64Array([BigInt(durationSamples)]);

  // ── Stage 1: Encoder ──
  const tEnc0 = performance.now();
  const encoderInputs: Record<string, TensorDesc> = {
    audio: {
      data: new Int16Array(reference.audio),
      dims: [1, 1, reference.samples],
      dtype: "int32", // int16 sent as int32
    },
    text: {
      data: tokens,
      dims: [1, tokens.length],
      dtype: "int32",
    },
    duration: {
      data: durationBigInt,
      dims: [1],
      dtype: "int64",
    },
  };

  const encResult = await runVcInference("f5tts-encoder", encoderInputs);
  const encoderMs = Math.round(performance.now() - tEnc0);

  // Extract encoder outputs
  // Expected: noise, rope_cos, rope_sin, cat_mel_text, cat_mel_text_drop, ref_signal_len, ...
  const encOutputNames = Object.keys(encResult);
  console.info(`[f5tts] Encoder outputs: [${encOutputNames.join(", ")}] (${encoderMs}ms)`);

  // ── Stage 2: Transformer (iterative NFE loop) ──
  const tTrans0 = performance.now();
  let noise = encResult["noise"] ?? encResult[encOutputNames[0]];
  const noiseDims = noise.dims;

  // Build time step schedule: linspace(0, 1, nfeSteps+1)[1:]
  // Each step: t = i / nfeSteps
  for (let step = 0; step < nfeSteps; step++) {
    const t = (step + 1) / nfeSteps;
    const timeStep = new Float32Array([t]);

    // Build transformer inputs — noise + all encoder intermediates + time_step
    const transInputs: Record<string, TensorDesc> = {
      noise: { data: noise.data, dims: noise.dims, dtype: "float32" },
      time_step: { data: timeStep, dims: [1], dtype: "float32" },
    };

    // Forward all encoder outputs except noise
    for (const name of encOutputNames) {
      if (name === "noise") continue;
      transInputs[name] = {
        data: encResult[name].data,
        dims: encResult[name].dims,
        dtype: encResult[name].dtype ?? "float32",
      };
    }

    const stepResult = await runVcInference("f5tts-transformer", transInputs);

    // Update noise for next iteration
    const resultNames = Object.keys(stepResult);
    noise = stepResult["noise"] ?? stepResult[resultNames[0]];

    onStep?.(step + 1, nfeSteps);
  }
  const transformerMs = Math.round(performance.now() - tTrans0);
  console.info(`[f5tts] Transformer: ${nfeSteps} NFE steps (${transformerMs}ms, ${(transformerMs / nfeSteps).toFixed(0)}ms/step)`);

  // ── Stage 3: Decoder ──
  const tDec0 = performance.now();
  const ref_signal_len = encResult["ref_signal_len"] ?? encResult[encOutputNames.find(n => n.includes("ref") || n.includes("signal")) ?? ""];

  const decoderInputs: Record<string, TensorDesc> = {
    noise: { data: noise.data, dims: noise.dims, dtype: "float32" },
  };
  // Add ref_signal_len if available
  if (ref_signal_len) {
    decoderInputs["ref_signal_len"] = {
      data: ref_signal_len.data,
      dims: ref_signal_len.dims,
      dtype: ref_signal_len.dtype ?? "int64",
    };
  }

  const decResult = await runVcInference("f5tts-decoder", decoderInputs);
  const decoderMs = Math.round(performance.now() - tDec0);

  // Extract output audio
  const decOutputNames = Object.keys(decResult);
  const outputTensor = decResult["audio"] ?? decResult[decOutputNames[0]];
  console.info(`[f5tts] Decoder output: shape=[${outputTensor.dims}] dtype=${outputTensor.dtype} (${decoderMs}ms)`);

  // Convert to Int16Array if needed
  let audio: Int16Array;
  if (outputTensor.data instanceof Int16Array) {
    audio = outputTensor.data;
  } else if (outputTensor.data instanceof Float32Array) {
    // Float32 → Int16
    audio = new Int16Array(outputTensor.data.length);
    for (let i = 0; i < outputTensor.data.length; i++) {
      const s = Math.max(-1, Math.min(1, outputTensor.data[i]));
      audio[i] = s < 0 ? s * 32768 : s * 32767;
    }
  } else {
    audio = new Int16Array(outputTensor.data as ArrayLike<number>);
  }

  const totalMs = Math.round(performance.now() - t0);
  const durationSec = audio.length / F5_SAMPLE_RATE;

  console.info(
    `[f5tts] Synthesis complete: ${durationSec.toFixed(2)}s audio, ` +
    `${totalMs}ms total (enc ${encoderMs}ms, trans ${transformerMs}ms, dec ${decoderMs}ms)`
  );

  return {
    audio,
    durationSec,
    timing: { encoderMs, transformerMs, decoderMs, totalMs },
    nfeSteps,
  };
}

/**
 * Convert Int16 PCM to WAV Blob at given sample rate.
 */
export function f5AudioToWav(audio: Int16Array, sampleRate = F5_SAMPLE_RATE): Blob {
  const numSamples = audio.length;
  const byteRate = sampleRate * 2; // 16-bit mono
  const blockAlign = 2;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // RIFF header
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);

  // PCM data
  const int16View = new Int16Array(buffer, 44);
  int16View.set(audio);

  return new Blob([buffer], { type: "audio/wav" });
}
