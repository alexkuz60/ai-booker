/**
 * SceneRenderer — offline (OfflineAudioContext) renderer that produces
 * 3 stem files per scene: voice.wav, atmosphere.wav, sfx.wav.
 *
 * Loading phase reports per-clip progress; rendering is atomic.
 */

import { supabase } from "@/integrations/supabase/client";
import type { TimelineClip } from "@/hooks/useTimelineClips";
import { getAudioEngine } from "./audioEngine";
import type { ClipPluginConfig, SceneClipConfigs } from "@/hooks/useClipPluginConfigs";
import { DEFAULT_CLIP_PLUGIN_CONFIG } from "@/hooks/useClipPluginConfigs";

export interface RenderProgress {
  phase: "loading" | "rendering" | "encoding" | "uploading" | "done" | "error";
  percent: number;
  error?: string;
}

export interface RenderResult {
  voicePath: string | null;
  atmoPath: string | null;
  sfxPath: string | null;
  voiceDurationMs: number;
  atmoDurationMs: number;
  sfxDurationMs: number;
}

type BusType = "voice" | "atmosphere" | "sfx";

function classifyClip(clip: TimelineClip): BusType {
  if (clip.trackId === "atmosphere-bg") return "atmosphere";
  if (clip.trackId === "atmosphere-sfx") return "sfx";
  return "voice";
}

/* ─── Audio loading ─── */

async function fetchAudioBuffer(
  audioPath: string,
  sampleRate: number,
): Promise<AudioBuffer | null> {
  try {
    const { data: urlData } = await supabase.storage
      .from("user-media")
      .createSignedUrl(audioPath, 600);
    if (!urlData?.signedUrl) return null;

    const resp = await fetch(urlData.signedUrl);
    const arrayBuf = await resp.arrayBuffer();
    const decodeCtx = new OfflineAudioContext(2, 1, sampleRate);
    return await decodeCtx.decodeAudioData(arrayBuf);
  } catch {
    return null;
  }
}

/** Pre-load all clip buffers with per-clip progress */
async function preloadClipBuffers(
  clips: TimelineClip[],
  sampleRate: number,
  onClipLoaded?: (loaded: number, total: number) => void,
): Promise<Map<string, AudioBuffer>> {
  const buffers = new Map<string, AudioBuffer>();
  const loadable = clips.filter(c => c.audioPath);
  let loaded = 0;

  for (const clip of loadable) {
    const buffer = await fetchAudioBuffer(clip.audioPath!, sampleRate);
    if (buffer) buffers.set(clip.id, buffer);
    loaded++;
    onClipLoaded?.(loaded, loadable.length);
  }

  return buffers;
}

/* ─── WAV encoder ─── */

function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

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

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/* ─── Bus scheduling (atomic render) ─── */

function scheduleBus(
  clips: TimelineClip[],
  buffers: Map<string, AudioBuffer>,
  durationSec: number,
  sampleRate: number,
): OfflineAudioContext | null {
  const withAudio = clips.filter(c => buffers.has(c.id));
  if (withAudio.length === 0) return null;

  const ctx = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);
  const engine = getAudioEngine();

  for (const clip of withAudio) {
    const buffer = buffers.get(clip.id)!;

    const mixState = engine.getTrackMixState(clip.id);
    const volume = mixState?.volume ?? 80;
    const pan = mixState?.pan ?? 0;
    const preFxBypassed = mixState?.preFxBypassed ?? true;
    const reverbBypassed = mixState?.reverbBypassed ?? true;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.ratio.value = preFxBypassed ? 1 : 3;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.1;

    const gainNode = ctx.createGain();
    const dbVal = volume <= 0 ? -100 : 20 * Math.log10(volume / 100);
    gainNode.gain.value = Math.pow(10, dbVal / 20);

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    source.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(panner);

    if (!reverbBypassed) {
      const irLength = Math.ceil(sampleRate * 1.5);
      const irBuffer = ctx.createBuffer(2, irLength, sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = irBuffer.getChannelData(ch);
        for (let i = 0; i < irLength; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.3));
        }
      }
      const convolver = ctx.createConvolver();
      convolver.buffer = irBuffer;
      const dryGain = ctx.createGain();
      dryGain.gain.value = 0.85;
      const wetGain = ctx.createGain();
      wetGain.gain.value = 0.15;
      const merger = ctx.createGain();
      panner.connect(dryGain);
      dryGain.connect(merger);
      panner.connect(convolver);
      convolver.connect(wetGain);
      wetGain.connect(merger);
      merger.connect(ctx.destination);
    } else {
      panner.connect(ctx.destination);
    }

    const fadeIn = clip.fadeInSec ?? 0;
    const fadeOut = clip.fadeOutSec ?? 0;
    if (fadeIn > 0) {
      gainNode.gain.setValueAtTime(0, clip.startSec);
      gainNode.gain.linearRampToValueAtTime(gainNode.gain.value, clip.startSec + fadeIn);
    }
    if (fadeOut > 0) {
      const fadeStart = clip.startSec + clip.durationSec - fadeOut;
      gainNode.gain.setValueAtTime(gainNode.gain.value, fadeStart);
      gainNode.gain.linearRampToValueAtTime(0, clip.startSec + clip.durationSec);
    }

    if (clip.loop && clip.clipLenSec) {
      const step = Math.max(1, clip.clipLenSec - (clip.loopCrossfadeSec ?? 0));
      const iterations = Math.ceil(clip.durationSec / step) + 1;
      for (let i = 0; i < iterations; i++) {
        const iterOffset = i * step;
        if (iterOffset >= clip.durationSec) break;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(compressor);
        const remaining = Math.min(clip.clipLenSec, clip.durationSec - iterOffset);
        src.start(clip.startSec + iterOffset, 0, remaining);
      }
    } else {
      source.start(clip.startSec, 0);
    }
  }

  return ctx;
}

/* ─── Main render ─── */

export async function renderScene(
  sceneId: string,
  clips: TimelineClip[],
  durationSec: number,
  userId: string,
  onProgress?: (p: RenderProgress) => void,
): Promise<RenderResult> {
  const sampleRate = 44100;
  const report = (phase: RenderProgress["phase"], percent: number) =>
    onProgress?.({ phase, percent });

  try {
    report("loading", 0);

    // Classify clips by bus
    const voiceClips = clips.filter(c => classifyClip(c) === "voice" && c.hasAudio);
    const atmoClips = clips.filter(c => classifyClip(c) === "atmosphere" && c.hasAudio);
    const sfxClips = clips.filter(c => classifyClip(c) === "sfx" && c.hasAudio);

    const allClips = [...voiceClips, ...atmoClips, ...sfxClips];
    const totalLoadable = allClips.filter(c => c.audioPath).length;

    // Pre-load all buffers with per-clip progress (0–45%)
    const buffers = await preloadClipBuffers(allClips, sampleRate, (loaded, total) => {
      const pct = total > 0 ? Math.round((loaded / total) * 45) : 0;
      report("loading", pct);
    });

    report("rendering", 50);

    // Schedule and render all 3 buses in parallel (atomic)
    const voiceCtx = scheduleBus(voiceClips, buffers, durationSec, sampleRate);
    const atmoCtx = scheduleBus(atmoClips, buffers, durationSec, sampleRate);
    const sfxCtx = scheduleBus(sfxClips, buffers, durationSec, sampleRate);

    const [voiceBuf, atmoBuf, sfxBuf] = await Promise.all([
      voiceCtx?.startRendering() ?? Promise.resolve(null),
      atmoCtx?.startRendering() ?? Promise.resolve(null),
      sfxCtx?.startRendering() ?? Promise.resolve(null),
    ]);

    report("encoding", 65);

    // Encode to WAV
    const stems: { key: BusType; buffer: AudioBuffer | null }[] = [
      { key: "voice", buffer: voiceBuf },
      { key: "atmosphere", buffer: atmoBuf },
      { key: "sfx", buffer: sfxBuf },
    ];

    const results: Record<string, { path: string; durationMs: number } | null> = {
      voice: null,
      atmosphere: null,
      sfx: null,
    };

    report("uploading", 70);

    for (const stem of stems) {
      if (!stem.buffer) continue;

      const wav = encodeWav(stem.buffer);
      const storagePath = `${userId}/renders/${sceneId}/${stem.key}.wav`;

      const { error } = await supabase.storage
        .from("user-media")
        .upload(storagePath, wav, {
          contentType: "audio/wav",
          upsert: true,
        });

      if (error) {
        console.error(`Upload ${stem.key} failed:`, error);
        continue;
      }

      results[stem.key] = {
        path: storagePath,
        durationMs: Math.round((stem.buffer.length / sampleRate) * 1000),
      };
    }

    report("uploading", 90);

    // Upsert scene_renders record
    const { error: dbError } = await supabase.from("scene_renders" as any).upsert(
      {
        scene_id: sceneId,
        user_id: userId,
        voice_path: results.voice?.path ?? null,
        atmo_path: results.atmosphere?.path ?? null,
        sfx_path: results.sfx?.path ?? null,
        voice_duration_ms: results.voice?.durationMs ?? 0,
        atmo_duration_ms: results.atmosphere?.durationMs ?? 0,
        sfx_duration_ms: results.sfx?.durationMs ?? 0,
        status: "ready",
        render_config: {},
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: "scene_id" } as any,
    );

    if (dbError) console.error("scene_renders upsert error:", dbError);

    report("done", 100);

    return {
      voicePath: results.voice?.path ?? null,
      atmoPath: results.atmosphere?.path ?? null,
      sfxPath: results.sfx?.path ?? null,
      voiceDurationMs: results.voice?.durationMs ?? 0,
      atmoDurationMs: results.atmosphere?.durationMs ?? 0,
      sfxDurationMs: results.sfx?.durationMs ?? 0,
    };
  } catch (err: any) {
    report("error", 0);
    throw err;
  }
}
