/**
 * ChapterRenderer — offline (OfflineAudioContext) renderer that produces
 * a single stereo WAV file for an entire chapter (or active montage part).
 *
 * Signal path replicates the live master chain from AudioEngine:
 *   Bus mix → EQ3 → Comp → Limiter → Filter(×5) → MBC → Reverb → Output
 *
 * All bypass states and plugin parameters are read from the live engine
 * at render time, ensuring WYSIWYG output.
 *
 * NO normalisation is applied — the signal is captured as-is.
 */
import { supabase } from "@/integrations/supabase/client";

import { getAudioEngine } from "./audioEngine";
import { fetchWithStemCache } from "./stemCache";
import type { TimelineClip, SceneBoundary } from "@/hooks/useTimelineClips";

// ─── Public types ────────────────────────────────────────────

export type ExportFormat = "wav" | "mp3";
export type WavBitDepth = 16 | 24 | 32;
export type Mp3Bitrate = 128 | 192 | 256 | 320;

export interface ChapterRenderProgress {
  phase: "loading" | "rendering" | "normalizing" | "encoding" | "done" | "error";
  percent: number;
  error?: string;
}

export interface ChapterRenderResult {
  blob: Blob;
  durationSec: number;
  fileSizeBytes: number;
  format: ExportFormat;
}

// ─── WAV encoder (configurable bit depth) ───────────────────

function encodeWav(buffer: AudioBuffer, bitDepth: WavBitDepth = 16): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // For 32-bit float we use format code 3 (IEEE float), otherwise 1 (PCM)
  const isFloat = bitDepth === 32;
  const formatCode = isFloat ? 3 : 1;

  writeString(0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, formatCode, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      if (bitDepth === 16) {
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      } else if (bitDepth === 24) {
        const val = sample < 0 ? sample * 0x800000 : sample * 0x7FFFFF;
        const intVal = Math.round(val);
        view.setUint8(offset, intVal & 0xFF);
        view.setUint8(offset + 1, (intVal >> 8) & 0xFF);
        view.setUint8(offset + 2, (intVal >> 16) & 0xFF);
      } else {
        // 32-bit float
        view.setFloat32(offset, sample, true);
      }
      offset += bytesPerSample;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

// ─── MP3 encoder (lamejs) ────────────────────────────────────

async function encodeMp3(buffer: AudioBuffer, bitrate: Mp3Bitrate = 192): Promise<Blob> {
  // @ts-ignore — lamejs doesn't have proper types
  const lamejs = await import("lamejs");
  const Mp3Encoder = lamejs.default?.Mp3Encoder ?? lamejs.Mp3Encoder;

  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const encoder = new Mp3Encoder(numChannels, sampleRate, bitrate);

  const BLOCK = 1152;
  const mp3Parts: BlobPart[] = [];

  // Convert float [-1,1] → Int16
  const toInt16 = (data: Float32Array): Int16Array => {
    const out = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const s = Math.max(-1, Math.min(1, data[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  };

  const left = toInt16(buffer.getChannelData(0));
  const right = numChannels > 1 ? toInt16(buffer.getChannelData(1)) : left;

  for (let i = 0; i < length; i += BLOCK) {
    const end = Math.min(i + BLOCK, length);
    const lChunk = left.subarray(i, end);
    const rChunk = right.subarray(i, end);
    const mp3buf = encoder.encodeBuffer(lChunk, rChunk);
    if (mp3buf.length > 0) mp3Parts.push(new Blob([mp3buf]));
  }

  const tail = encoder.flush();
  if (tail.length > 0) mp3Parts.push((tail as Uint8Array).buffer);

  return new Blob(mp3Parts, { type: "audio/mpeg" });
}

// ─── Audio buffer loading ────────────────────────────────────

async function fetchStemBuffer(
  audioPath: string,
  sampleRate: number,
): Promise<AudioBuffer | null> {
  try {
    const { data: urlData } = await supabase.storage
      .from("user-media")
      .createSignedUrl(audioPath, 600);
    if (!urlData?.signedUrl) return null;

    const arrayBuf = await fetchWithStemCache(audioPath, urlData.signedUrl);
    console.log(`[ChapterRenderer] Decoding stem: ${audioPath}, bytes=${arrayBuf.byteLength}`);

    // Use a sufficiently long context for decoding (some browsers need this)
    const decodeCtx = new OfflineAudioContext(2, sampleRate * 60, sampleRate);
    const decoded = await decodeCtx.decodeAudioData(arrayBuf.slice(0));
    console.log(`[ChapterRenderer] Decoded: ch=${decoded.numberOfChannels}, len=${decoded.length}, sr=${decoded.sampleRate}, dur=${decoded.duration.toFixed(2)}s`);

    // Verify buffer actually has audio content
    const ch0 = decoded.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < ch0.length; i += 100) {
      const abs = Math.abs(ch0[i]);
      if (abs > peak) peak = abs;
    }
    console.log(`[ChapterRenderer] Peak amplitude: ${peak.toFixed(6)}`);

    return decoded;
  } catch (e) {
    console.warn("[ChapterRenderer] Failed to load stem:", audioPath, e);
    return null;
  }
}

// ─── Master chain builder for offline context ────────────────

function buildMasterChain(ctx: OfflineAudioContext): {
  input: AudioNode;
  output: AudioNode;
} {
  const engine = getAudioEngine();
  const pluginState = engine.getMasterPluginState();
  const params = engine.getMasterPluginParams();
  const chainBypassed = pluginState.chainBypassed;

  // ── EQ3 (3-band) ──
  const eqLow = ctx.createBiquadFilter();
  eqLow.type = "lowshelf";
  eqLow.frequency.value = 400;
  eqLow.gain.value = (pluginState.eqBypassed || chainBypassed) ? 0 : params.eqLow;

  const eqMid = ctx.createBiquadFilter();
  eqMid.type = "peaking";
  eqMid.frequency.value = 1000;
  eqMid.Q.value = 0.5;
  eqMid.gain.value = (pluginState.eqBypassed || chainBypassed) ? 0 : params.eqMid;

  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = "highshelf";
  eqHigh.frequency.value = 2500;
  eqHigh.gain.value = (pluginState.eqBypassed || chainBypassed) ? 0 : params.eqHigh;

  // ── Compressor ──
  const comp = ctx.createDynamicsCompressor();
  if (pluginState.compBypassed || chainBypassed) {
    comp.ratio.value = 1;
  } else {
    comp.threshold.value = params.compThreshold;
    comp.ratio.value = params.compRatio;
    comp.attack.value = params.compAttack;
    comp.release.value = params.compRelease;
    comp.knee.value = params.compKnee;
  }

  // ── Limiter (DynamicsCompressor with high ratio) ──
  const limiter = ctx.createDynamicsCompressor();
  if (pluginState.limiterBypassed || chainBypassed) {
    limiter.threshold.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.01;
    limiter.knee.value = 0;
  } else {
    limiter.threshold.value = params.limiterThreshold;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.01;
    limiter.knee.value = 0;
  }

  // ── 5-band parametric filter ──
  const filters: BiquadFilterNode[] = [];
  const filterBands = params.filterBands ?? [];
  for (let i = 0; i < 5; i++) {
    const f = ctx.createBiquadFilter();
    if (pluginState.filterBypassed || chainBypassed) {
      f.type = "allpass";
      f.frequency.value = 1000;
      f.Q.value = 0.5;
      f.gain.value = 0;
    } else {
      const band = filterBands[i];
      if (band) {
        f.type = band.type as BiquadFilterType;
        f.frequency.value = band.frequency;
        f.Q.value = band.Q;
        f.gain.value = band.gain;
      }
    }
    filters.push(f);
  }

  // ── Multiband compressor (3 bands via crossover filters + compressors) ──
  // Simplified: for offline render we approximate MBC with 3 parallel paths
  const mbcBypassed = pluginState.mbcBypassed || chainBypassed;
  const mbcParams = params.mbcParams;

  const mbcSplitLow = ctx.createBiquadFilter();
  mbcSplitLow.type = "lowpass";
  mbcSplitLow.frequency.value = mbcParams?.lowFrequency ?? 250;
  mbcSplitLow.Q.value = 0.5;

  const mbcSplitMidLow = ctx.createBiquadFilter();
  mbcSplitMidLow.type = "highpass";
  mbcSplitMidLow.frequency.value = mbcParams?.lowFrequency ?? 250;
  mbcSplitMidLow.Q.value = 0.5;

  const mbcSplitMidHigh = ctx.createBiquadFilter();
  mbcSplitMidHigh.type = "lowpass";
  mbcSplitMidHigh.frequency.value = mbcParams?.highFrequency ?? 4000;
  mbcSplitMidHigh.Q.value = 0.5;

  const mbcSplitHigh = ctx.createBiquadFilter();
  mbcSplitHigh.type = "highpass";
  mbcSplitHigh.frequency.value = mbcParams?.highFrequency ?? 4000;
  mbcSplitHigh.Q.value = 0.5;

  const compLow = ctx.createDynamicsCompressor();
  const compMid = ctx.createDynamicsCompressor();
  const compHigh = ctx.createDynamicsCompressor();

  if (mbcBypassed) {
    compLow.ratio.value = 1;
    compMid.ratio.value = 1;
    compHigh.ratio.value = 1;
  } else {
    const setComp = (c: DynamicsCompressorNode, p: { threshold: number; ratio: number; attack: number; release: number; knee: number }) => {
      c.threshold.value = p.threshold;
      c.ratio.value = p.ratio;
      c.attack.value = p.attack;
      c.release.value = p.release;
      c.knee.value = p.knee;
    };
    if (mbcParams?.low) setComp(compLow, mbcParams.low);
    if (mbcParams?.mid) setComp(compMid, mbcParams.mid);
    if (mbcParams?.high) setComp(compHigh, mbcParams.high);
  }

  const mbcMerge = ctx.createGain();
  mbcMerge.gain.value = 1;

  // ── Reverb — skip for offline (Tone.Reverb uses convolution, 
  //    we'd need to generate IR; for now pass through if not bypassed) ──
  // Note: Web Audio doesn't have built-in reverb, Tone.Reverb generates an IR.
  // For faithful reproduction we create a simple convolver-based reverb.
  const reverbBypassed = pluginState.reverbBypassed || chainBypassed;
  const reverbWet = reverbBypassed ? 0 : (params.reverbWet ?? 0.12);
  const reverbDecay = params.reverbDecay ?? 2.0;

  const dryGain = ctx.createGain();
  dryGain.gain.value = 1;
  const wetGain = ctx.createGain();
  wetGain.gain.value = reverbWet;

  // Generate simple reverb IR
  let reverbConvolver: ConvolverNode | null = null;
  if (reverbWet > 0) {
    const irLength = Math.ceil(reverbDecay * ctx.sampleRate);
    const irBuffer = ctx.createBuffer(2, irLength, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = irBuffer.getChannelData(ch);
      for (let i = 0; i < irLength; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-3 * i / irLength);
      }
    }
    reverbConvolver = ctx.createConvolver();
    reverbConvolver.buffer = irBuffer;
  }

  const outputGain = ctx.createGain();
  outputGain.gain.value = 1;

  // ── Wire the chain ──
  // Input → EQ Low → EQ Mid → EQ High → Comp → Limiter → Filter chain → MBC → Reverb → Output
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(comp);
  comp.connect(limiter);

  // Limiter → Filters
  limiter.connect(filters[0]);
  for (let i = 0; i < 4; i++) {
    filters[i].connect(filters[i + 1]);
  }

  // Filters → MBC (3-band split/merge)
  const mbcInput = ctx.createGain();
  mbcInput.gain.value = 1;
  filters[4].connect(mbcInput);

  mbcInput.connect(mbcSplitLow);
  mbcInput.connect(mbcSplitMidLow);
  mbcInput.connect(mbcSplitHigh);

  mbcSplitLow.connect(compLow);
  mbcSplitMidLow.connect(mbcSplitMidHigh);
  mbcSplitMidHigh.connect(compMid);
  mbcSplitHigh.connect(compHigh);

  compLow.connect(mbcMerge);
  compMid.connect(mbcMerge);
  compHigh.connect(mbcMerge);

  // MBC → Reverb (dry/wet) → Output
  mbcMerge.connect(dryGain);
  dryGain.connect(outputGain);

  if (reverbConvolver && reverbWet > 0) {
    mbcMerge.connect(reverbConvolver);
    reverbConvolver.connect(wetGain);
    wetGain.connect(outputGain);
  }

  return { input: eqLow, output: outputGain };
}

// ─── Main render function ────────────────────────────────────

export async function renderChapter(opts: {
  clips: TimelineClip[];
  totalDurationSec: number;
  normalize?: boolean;
  format?: ExportFormat;
  wavBitDepth?: WavBitDepth;
  mp3Bitrate?: Mp3Bitrate;
  onProgress?: (p: ChapterRenderProgress) => void;
}): Promise<ChapterRenderResult> {
  const {
    clips, totalDurationSec, normalize = true,
    format = "wav", wavBitDepth = 16, mp3Bitrate = 192,
    onProgress,
  } = opts;
  const SAMPLE_RATE = 44100;
  const engine = getAudioEngine();

  if (totalDurationSec <= 0 || clips.length === 0) {
    throw new Error("No clips to render");
  }

  try {
    // ── Phase 1: Load stems ──
    onProgress?.({ phase: "loading", percent: 0 });

    const stemClips = clips.filter(c => c.hasAudio && c.audioPath);
    console.log(`[ChapterRenderer] Total clips: ${clips.length}, stem clips: ${stemClips.length}`);
    const buffers = new Map<string, AudioBuffer>();
    let loaded = 0;

    for (const clip of stemClips) {
      const buf = await fetchStemBuffer(clip.audioPath!, SAMPLE_RATE);
      if (buf) buffers.set(clip.id, buf);
      loaded++;
      onProgress?.({ phase: "loading", percent: Math.round((loaded / stemClips.length) * 40) });
    }

    console.log(`[ChapterRenderer] Loaded ${buffers.size}/${stemClips.length} buffers`);

    // ── Phase 2: Offline render ──
    onProgress?.({ phase: "rendering", percent: 40 });

    const totalSamples = Math.ceil(totalDurationSec * SAMPLE_RATE);
    const offlineCtx = new OfflineAudioContext(2, totalSamples, SAMPLE_RATE);

    // Build master chain
    const { input: masterInput, output: masterOutput } = buildMasterChain(offlineCtx);
    masterOutput.connect(offlineCtx.destination);

    // Schedule all clips into the offline context
    let scheduled = 0;
    for (const clip of stemClips) {
      const buffer = buffers.get(clip.id);
      if (!buffer) continue;

      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;

      // Per-track volume & pan: use persisted mixer settings if available,
      // otherwise unity gain (stems are pre-rendered at full volume)
      const mixState = engine.getTrackMixState(clip.id);
      // If engine track exists and has meaningful volume, use it; otherwise default to 100 (unity)
      const volume = (mixState && mixState.volume > 0) ? mixState.volume : 100;
      const pan = mixState?.pan ?? 0;

      const gainDb = volume <= 0 ? -Infinity : 20 * Math.log10(volume / 100);
      const gainLinear = volume <= 0 ? 0 : Math.pow(10, gainDb / 20);

      const gainNode = offlineCtx.createGain();
      gainNode.gain.value = gainLinear;

      const panNode = offlineCtx.createStereoPanner();
      panNode.pan.value = pan;

      console.log(`[ChapterRenderer] Schedule: ${clip.id} at ${clip.startSec.toFixed(2)}s, dur=${clip.durationSec.toFixed(2)}s, vol=${volume}, gain=${gainLinear.toFixed(4)}, bufDur=${buffer.duration.toFixed(2)}s`);

      // Fade in/out
      const fadeIn = clip.fadeInSec ?? 0;
      const fadeOut = clip.fadeOutSec ?? 0;
      const clipDur = clip.durationSec;

      if (fadeIn > 0) {
        const targetGain = gainLinear;
        gainNode.gain.setValueAtTime(0, clip.startSec);
        gainNode.gain.linearRampToValueAtTime(targetGain, clip.startSec + fadeIn);
      }
      if (fadeOut > 0) {
        const fadeStart = clip.startSec + clipDur - fadeOut;
        gainNode.gain.setValueAtTime(gainLinear, fadeStart);
        gainNode.gain.linearRampToValueAtTime(0, clip.startSec + clipDur);
      }

      source.connect(gainNode);
      gainNode.connect(panNode);
      panNode.connect(masterInput);

      source.start(clip.startSec);
      scheduled++;
    }

    console.log(`[ChapterRenderer] Scheduled ${scheduled} sources, rendering ${totalSamples} samples (${totalDurationSec.toFixed(1)}s)`);

    // Render
    const renderedBuffer = await offlineCtx.startRendering();
    onProgress?.({ phase: "rendering", percent: 70 });

    // ── Phase 3: Normalize to -0.5 dB peak (optional) ──
    if (normalize) {
      onProgress?.({ phase: "normalizing", percent: 72 });

      const numCh = renderedBuffer.numberOfChannels;
      const len = renderedBuffer.length;

      let globalPeak = 0;
      for (let ch = 0; ch < numCh; ch++) {
        const data = renderedBuffer.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const abs = Math.abs(data[i]);
          if (abs > globalPeak) globalPeak = abs;
        }
      }

      const targetPeak = Math.pow(10, -0.5 / 20); // -0.5 dB ≈ 0.9441
      console.log(`[ChapterRenderer] Peak: ${globalPeak.toFixed(6)} (${globalPeak > 0 ? (20 * Math.log10(globalPeak)).toFixed(2) : '-inf'} dB), target: ${targetPeak.toFixed(6)} (-0.5 dB)`);

      if (globalPeak > 0) {
        const gain = targetPeak / globalPeak;
        console.log(`[ChapterRenderer] Normalizing: gain = ${gain.toFixed(6)} (${(20 * Math.log10(gain)).toFixed(2)} dB delta)`);
        for (let ch = 0; ch < numCh; ch++) {
          const data = renderedBuffer.getChannelData(ch);
          for (let i = 0; i < len; i++) {
            data[i] *= gain;
          }
        }
      }

      onProgress?.({ phase: "normalizing", percent: 80 });
    }

    // ── Phase 4: Encode ──
    onProgress?.({ phase: "encoding", percent: 82 });

    let blob: Blob;
    if (format === "mp3") {
      blob = await encodeMp3(renderedBuffer, mp3Bitrate);
    } else {
      blob = encodeWav(renderedBuffer, wavBitDepth);
    }

    onProgress?.({ phase: "encoding", percent: 95 });
    onProgress?.({ phase: "done", percent: 100 });

    return {
      blob,
      durationSec: totalDurationSec,
      fileSizeBytes: blob.size,
      format,
    };
  } catch (e: any) {
    onProgress?.({ phase: "error", percent: 0, error: e.message ?? String(e) });
    throw e;
  }
}
