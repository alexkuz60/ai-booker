/**
 * ChapterRenderer — offline render of an entire chapter (or part) into a single
 * stereo WAV file, with master chain processing. Also provides normalization
 * (peak-scan → gain adjustment to reach -0.5 dB ceiling).
 *
 * Flow:
 *   1. Load all scene stem WAVs (voice, atmo, sfx)
 *   2. Place on timeline with per-scene silence
 *   3. Mix per-stem volume/pan from engine state
 *   4. Apply master chain (EQ → Comp → Limiter → 5-band Filter → MBC → Reverb)
 *   5. Render via OfflineAudioContext → WAV → upload to Storage
 */

import { supabase } from "@/integrations/supabase/client";
import { getAudioEngine } from "./audioEngine";
import type { FilterBandParams, MultibandCompParams } from "./audioEngine";
import type { TimelineClip } from "@/hooks/useTimelineClips";

// ─── Types ──────────────────────────────────────────────────

export interface ChapterRenderProgress {
  phase: "loading" | "rendering" | "encoding" | "uploading" | "normalizing" | "done" | "error";
  percent: number;
  message?: string;
  error?: string;
}

export interface NormalizeResult {
  peakDb: number;
  gainDeltaDb: number;
  /** Number of scenes processed */
  sceneCount: number;
}

export interface ChapterRenderResult {
  storagePath: string;
  durationMs: number;
  peakDb: number;
}

// ─── Audio helpers ──────────────────────────────────────────

const SAMPLE_RATE = 44100;
const TARGET_PEAK_DB = -0.5;

async function fetchAudioBuffer(audioPath: string, sampleRate: number): Promise<AudioBuffer | null> {
  try {
    const { data: urlData } = await supabase.storage
      .from("user-media")
      .createSignedUrl(audioPath, 600);
    if (!urlData?.signedUrl) return null;
    const resp = await fetch(urlData.signedUrl);
    const arrayBuf = await resp.arrayBuffer();
    const ctx = new OfflineAudioContext(2, 1, sampleRate);
    return await ctx.decodeAudioData(arrayBuf);
  } catch {
    return null;
  }
}

/** Measure true peak (linear) across all channels of a buffer */
function measurePeakLinear(buffer: AudioBuffer): number {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  return peak;
}

function linearToDb(v: number): number {
  return v > 0 ? 20 * Math.log10(v) : -Infinity;
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/** Encode an AudioBuffer to 16-bit PCM WAV Blob */
function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const totalSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

// ─── Master chain builder for OfflineAudioContext ───────────

interface MasterChainNodes {
  input: AudioNode;   // connect sources here
  output: AudioNode;  // connect this to ctx.destination
}

function buildMasterChain(ctx: OfflineAudioContext): MasterChainNodes {
  const engine = getAudioEngine();
  const pluginState = engine.getMasterPluginState();
  const params = engine.getMasterPluginParams();
  const chainBypassed = pluginState.chainBypassed;

  // All nodes in chain order: input → EQ → Comp → Limiter → Filters(5) → MBC(3-band) → Reverb → output

  // ── EQ (3-band: lowshelf + peaking + highshelf) ──
  const eqLow = ctx.createBiquadFilter();
  eqLow.type = "lowshelf"; eqLow.frequency.value = 320;
  const eqMid = ctx.createBiquadFilter();
  eqMid.type = "peaking"; eqMid.frequency.value = 1000; eqMid.Q.value = 0.5;
  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = "highshelf"; eqHigh.frequency.value = 3200;

  if (!pluginState.eqBypassed && !chainBypassed) {
    eqLow.gain.value = params.eqLow;
    eqMid.gain.value = params.eqMid;
    eqHigh.gain.value = params.eqHigh;
  } else {
    eqLow.gain.value = 0; eqMid.gain.value = 0; eqHigh.gain.value = 0;
  }

  // ── Compressor ──
  const comp = ctx.createDynamicsCompressor();
  if (!pluginState.compBypassed && !chainBypassed) {
    comp.threshold.value = params.compThreshold;
    comp.ratio.value = params.compRatio;
    comp.attack.value = params.compAttack;
    comp.release.value = params.compRelease;
    comp.knee.value = params.compKnee;
  } else {
    comp.ratio.value = 1;
  }

  // ── Limiter (high-ratio compressor) ──
  const limiter = ctx.createDynamicsCompressor();
  if (!pluginState.limiterBypassed && !chainBypassed) {
    limiter.threshold.value = params.limiterThreshold;
    limiter.ratio.value = 20;
    limiter.knee.value = 0;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.01;
  } else {
    limiter.threshold.value = 0;
    limiter.ratio.value = 1;
  }

  // ── 5-band parametric filter ──
  const filters: BiquadFilterNode[] = [];
  const filterBands = params.filterBands as FilterBandParams[];
  for (let i = 0; i < 5; i++) {
    const f = ctx.createBiquadFilter();
    if (!pluginState.filterBypassed && !chainBypassed) {
      const band = filterBands[i];
      f.type = band.type;
      f.frequency.value = band.frequency;
      f.Q.value = band.Q;
      f.gain.value = band.gain;
    } else {
      f.type = "allpass"; f.frequency.value = 1000; f.Q.value = 0.5; f.gain.value = 0;
    }
    filters.push(f);
  }

  // ── MBC (3-band: low/band/highpass splits → compressors → merge) ──
  // Simplified: series of 3 compressors with crossover filters
  const mbcParams = params.mbcParams as MultibandCompParams;
  const mbcActive = !pluginState.mbcBypassed && !chainBypassed;

  // Low band: lowpass → comp
  const mbcLowFilter = ctx.createBiquadFilter();
  mbcLowFilter.type = "lowpass";
  mbcLowFilter.frequency.value = mbcParams.lowFrequency;
  mbcLowFilter.Q.value = 0.707;
  const mbcLowComp = ctx.createDynamicsCompressor();

  // Mid band: bandpass → comp
  const mbcMidFilter = ctx.createBiquadFilter();
  mbcMidFilter.type = "bandpass";
  mbcMidFilter.frequency.value = Math.sqrt(mbcParams.lowFrequency * mbcParams.highFrequency);
  mbcMidFilter.Q.value = 1;
  const mbcMidComp = ctx.createDynamicsCompressor();

  // High band: highpass → comp
  const mbcHighFilter = ctx.createBiquadFilter();
  mbcHighFilter.type = "highpass";
  mbcHighFilter.frequency.value = mbcParams.highFrequency;
  mbcHighFilter.Q.value = 0.707;
  const mbcHighComp = ctx.createDynamicsCompressor();

  if (mbcActive) {
    mbcLowComp.threshold.value = mbcParams.low.threshold;
    mbcLowComp.ratio.value = mbcParams.low.ratio;
    mbcLowComp.attack.value = mbcParams.low.attack;
    mbcLowComp.release.value = mbcParams.low.release;
    mbcLowComp.knee.value = mbcParams.low.knee;

    mbcMidComp.threshold.value = mbcParams.mid.threshold;
    mbcMidComp.ratio.value = mbcParams.mid.ratio;
    mbcMidComp.attack.value = mbcParams.mid.attack;
    mbcMidComp.release.value = mbcParams.mid.release;
    mbcMidComp.knee.value = mbcParams.mid.knee;

    mbcHighComp.threshold.value = mbcParams.high.threshold;
    mbcHighComp.ratio.value = mbcParams.high.ratio;
    mbcHighComp.attack.value = mbcParams.high.attack;
    mbcHighComp.release.value = mbcParams.high.release;
    mbcHighComp.knee.value = mbcParams.high.knee;
  } else {
    mbcLowComp.ratio.value = 1;
    mbcMidComp.ratio.value = 1;
    mbcHighComp.ratio.value = 1;
  }

  const mbcMerge = ctx.createGain();
  mbcMerge.gain.value = 1;

  // ── Reverb (synthetic IR) ──
  let reverbOutput: AudioNode;
  if (!pluginState.reverbBypassed && !chainBypassed) {
    const irLength = Math.ceil(SAMPLE_RATE * params.reverbDecay);
    const irBuffer = ctx.createBuffer(2, irLength, SAMPLE_RATE);
    for (let ch = 0; ch < 2; ch++) {
      const data = irBuffer.getChannelData(ch);
      for (let i = 0; i < irLength; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (SAMPLE_RATE * (params.reverbDecay / 5)));
      }
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = irBuffer;
    const dryGain = ctx.createGain();
    dryGain.gain.value = 1 - params.reverbWet;
    const wetGain = ctx.createGain();
    wetGain.gain.value = params.reverbWet;
    const merge = ctx.createGain();

    mbcMerge.connect(dryGain);
    mbcMerge.connect(convolver);
    convolver.connect(wetGain);
    dryGain.connect(merge);
    wetGain.connect(merge);
    reverbOutput = merge;
  } else {
    reverbOutput = mbcMerge;
  }

  // ── Wire the chain ──
  // input → eqLow → eqMid → eqHigh → comp → limiter → filter0→…→filter4 → [mbc split → merge] → reverb → output
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(comp);
  comp.connect(limiter);
  limiter.connect(filters[0]);
  for (let i = 0; i < 4; i++) filters[i].connect(filters[i + 1]);

  // MBC: split from last filter into 3 bands, merge
  filters[4].connect(mbcLowFilter);
  filters[4].connect(mbcMidFilter);
  filters[4].connect(mbcHighFilter);
  mbcLowFilter.connect(mbcLowComp);
  mbcMidFilter.connect(mbcMidComp);
  mbcHighFilter.connect(mbcHighComp);
  mbcLowComp.connect(mbcMerge);
  mbcMidComp.connect(mbcMerge);
  mbcHighComp.connect(mbcMerge);

  return { input: eqLow, output: reverbOutput };
}

// ─── Schedule clips into offline context ────────────────────

interface StemBufferEntry {
  clip: TimelineClip;
  buffer: AudioBuffer;
}

function scheduleClipsToMasterChain(
  ctx: OfflineAudioContext,
  entries: StemBufferEntry[],
  masterInput: AudioNode,
  normGainDb: number = 0,
) {
  const engine = getAudioEngine();

  for (const { clip, buffer } of entries) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Per-stem volume + pan from engine state
    const mixState = engine.getTrackMixState(clip.id);
    const volume = mixState?.volume ?? 80;
    const pan = mixState?.pan ?? 0;
    const dbVal = volume <= 0 ? -100 : 20 * Math.log10(volume / 100);

    const gainNode = ctx.createGain();
    gainNode.gain.value = Math.pow(10, (dbVal + normGainDb) / 20);

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    source.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(masterInput);

    source.start(clip.startSec, 0);
  }
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Normalize: scan all rendered scene stems for peak, calculate gain delta to -0.5 dB.
 * Returns the delta (which can then be applied during renderChapter).
 */
export async function normalizeChapter(
  clips: TimelineClip[],
  totalDurationSec: number,
  onProgress?: (p: ChapterRenderProgress) => void,
): Promise<NormalizeResult> {
  const report = (phase: ChapterRenderProgress["phase"], percent: number, message?: string) =>
    onProgress?.({ phase, percent, message });

  report("loading", 0, "Loading stems…");

  // Load all clip buffers
  const audioClips = clips.filter(c => c.audioPath && c.hasAudio);
  const entries: StemBufferEntry[] = [];
  let loaded = 0;

  for (const clip of audioClips) {
    const buffer = await fetchAudioBuffer(clip.audioPath!, SAMPLE_RATE);
    if (buffer) entries.push({ clip, buffer });
    loaded++;
    report("loading", Math.round((loaded / audioClips.length) * 40));
  }

  if (entries.length === 0) {
    return { peakDb: -Infinity, gainDeltaDb: 0, sceneCount: 0 };
  }

  report("rendering", 45, "Rendering offline for peak analysis…");

  // Build offline context with master chain
  const durationSamples = Math.ceil(totalDurationSec * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, durationSamples, SAMPLE_RATE);
  const chain = buildMasterChain(ctx);
  chain.output.connect(ctx.destination);

  // Schedule all clips through master chain (no norm gain yet)
  scheduleClipsToMasterChain(ctx, entries, chain.input, 0);

  report("rendering", 50);

  const rendered = await ctx.startRendering();

  report("normalizing", 80, "Analyzing peaks…");

  const peakLinear = measurePeakLinear(rendered);
  const peakDb = linearToDb(peakLinear);
  const gainDeltaDb = peakDb > -120 ? TARGET_PEAK_DB - peakDb : 0;

  const sceneIds = new Set(clips.map(c => c.sceneId).filter(Boolean));

  report("done", 100, `Peak: ${peakDb.toFixed(1)} dB → Gain: ${gainDeltaDb >= 0 ? "+" : ""}${gainDeltaDb.toFixed(1)} dB`);

  return { peakDb, gainDeltaDb, sceneCount: sceneIds.size };
}

/**
 * Render entire chapter (or active part) into a single WAV file with master chain.
 * Uploads to Storage and returns the path.
 */
export async function renderChapter(
  clips: TimelineClip[],
  totalDurationSec: number,
  userId: string,
  chapterId: string,
  partNumber: number | null,
  normGainDb: number = 0,
  onProgress?: (p: ChapterRenderProgress) => void,
): Promise<ChapterRenderResult> {
  const report = (phase: ChapterRenderProgress["phase"], percent: number, message?: string) =>
    onProgress?.({ phase, percent, message });

  try {
    report("loading", 0, "Loading stems…");

    const audioClips = clips.filter(c => c.audioPath && c.hasAudio);
    const entries: StemBufferEntry[] = [];
    let loaded = 0;

    for (const clip of audioClips) {
      const buffer = await fetchAudioBuffer(clip.audioPath!, SAMPLE_RATE);
      if (buffer) entries.push({ clip, buffer });
      loaded++;
      report("loading", Math.round((loaded / audioClips.length) * 35));
    }

    if (entries.length === 0) {
      throw new Error("No audio clips to render");
    }

    report("rendering", 40, "Offline rendering…");

    const durationSamples = Math.ceil(totalDurationSec * SAMPLE_RATE);
    const ctx = new OfflineAudioContext(2, durationSamples, SAMPLE_RATE);
    const chain = buildMasterChain(ctx);
    chain.output.connect(ctx.destination);

    scheduleClipsToMasterChain(ctx, entries, chain.input, normGainDb);

    const rendered = await ctx.startRendering();

    report("encoding", 70, "Encoding WAV…");

    const wav = encodeWav(rendered);
    const peakLinear = measurePeakLinear(rendered);
    const peakDb = linearToDb(peakLinear);

    report("uploading", 80, "Uploading…");

    const partSuffix = partNumber != null ? `_part${partNumber}` : "";
    const storagePath = `${userId}/chapter-renders/${chapterId}${partSuffix}.wav`;

    const { error } = await supabase.storage
      .from("user-media")
      .upload(storagePath, wav, { contentType: "audio/wav", upsert: true });

    if (error) throw new Error(`Upload failed: ${error.message}`);

    const durationMs = Math.round((rendered.length / SAMPLE_RATE) * 1000);

    report("done", 100, `Done! ${(durationMs / 1000).toFixed(1)}s, peak ${peakDb.toFixed(1)} dB`);

    return { storagePath, durationMs, peakDb };
  } catch (err: any) {
    report("error", 0, err.message);
    throw err;
  }
}
