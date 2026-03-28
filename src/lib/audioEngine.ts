/**
 * AudioEngine — singleton multi-track audio engine built on Tone.js.
 *
 * Architecture (per voice channel):
 *   Player → PreFX (bypass) → Channel (vol/pan) → Reverb (bypass) → TrackMeter → Bus
 *
 * Buses:
 *   VoiceBus ─┐
 *   AtmoBus  ─┼→ MasterBus → PostFX (bypass) → MasterMeter → Destination
 *   SfxBus   ─┘
 *
 * Transport is the single source of truth for playback position.
 */

import * as Tone from "tone";
import { fetchWithStemCache } from "@/lib/stemCache";

// ─── Types ──────────────────────────────────────────────────

export type FilterType = "lowpass" | "highpass" | "bandpass" | "lowshelf" | "highshelf" | "notch" | "allpass" | "peaking";
export type FilterRolloff = -12 | -24 | -48 | -96;

export interface FilterBandParams {
  frequency: number;
  type: FilterType;
  Q: number;
  gain: number;
  rolloff: FilterRolloff;
}

export interface MultibandCompBandParams {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
}

export interface MultibandCompParams {
  low: MultibandCompBandParams;
  mid: MultibandCompBandParams;
  high: MultibandCompBandParams;
  lowFrequency: number;   // crossover low→mid
  highFrequency: number;  // crossover mid→high
}

export const DEFAULT_MULTIBAND_COMP: MultibandCompParams = {
  low:  { threshold: -24, ratio: 4, attack: 0.01, release: 0.2, knee: 10 },
  mid:  { threshold: -18, ratio: 3, attack: 0.005, release: 0.15, knee: 8 },
  high: { threshold: -12, ratio: 2, attack: 0.003, release: 0.1, knee: 6 },
  lowFrequency: 250,
  highFrequency: 3500,
};

export const DEFAULT_FILTER_BANDS: FilterBandParams[] = [
  { frequency: 30, type: "highpass", Q: 0.707, gain: 0, rolloff: -12 },
  { frequency: 200, type: "lowshelf", Q: 0.707, gain: 0, rolloff: -12 },
  { frequency: 1000, type: "peaking", Q: 1, gain: 0, rolloff: -12 },
  { frequency: 8000, type: "highshelf", Q: 0.707, gain: 0, rolloff: -12 },
  { frequency: 18000, type: "lowpass", Q: 0.707, gain: 0, rolloff: -12 },
];

export interface TrackConfig {
  id: string;
  url: string;
  startSec: number;
  durationSec: number;
  overlay?: boolean;
  volume?: number;
  pan?: number;
  /** Bus routing: voice (default), atmosphere, sfx */
  bus?: "voice" | "atmosphere" | "sfx";
  /** Fade-in duration in seconds (applied via Tone.Player) */
  fadeInSec?: number;
  /** Fade-out duration in seconds (applied via Tone.Player) */
  fadeOutSec?: number;
  /** If true, the clip loops to fill durationSec. Original clip length in _clipLenSec. */
  loop?: boolean;
  /** Original single-iteration clip length (seconds). Required when loop=true. */
  clipLenSec?: number;
  /** Crossfade overlap between loop iterations (seconds). Default 1. */
  loopCrossfadeSec?: number;
  /** Human-readable label for progress display */
  label?: string;
  /** Stable cache key (e.g. storage audioPath). If set, Cache API is used. */
  cacheKey?: string;
  /** Segment type from storyboard — used for auto-FX (e.g. 'telephone') */
  segmentType?: string;
}

export interface LoadProgress {
  /** Total number of tracks to load */
  total: number;
  /** Number of tracks processed so far */
  done: number;
  /** Successfully loaded tracks */
  loaded: number;
  /** Failed tracks */
  failed: number;
  /** ID of the track currently loading */
  currentId: string;
  /** Label of the currently loading track */
  currentLabel: string;
}

export interface LoadTracksResult {
  total: number;
  loaded: number;
  dropped: number;
}

export type EngineState = "stopped" | "playing" | "paused";

export interface TrackMeterData {
  level: number;       // dB, mono pre-pan
  levelL: number;      // dB, post-pan left
  levelR: number;      // dB, post-pan right
}

export interface MasterMeterData {
  levelL: number;
  levelR: number;
  peakL: number;
  peakR: number;
}

export interface ChannelEqState {
  low: number;   // dB, -12..12
  mid: number;
  high: number;
  bypassed: boolean;
}

export interface ChannelCompState {
  threshold: number;
  ratio: number;
  knee: number;
  attack: number;
  release: number;
  bypassed: boolean;
}

export interface ChannelLimiterState {
  threshold: number;  // dB, -30..0
  bypassed: boolean;
}

export interface TrackMixState {
  volume: number;       // 0-100
  pan: number;          // -1..1
  reverbWet: number;    // 0-1
  reverbBypassed: boolean;
  preFxBypassed: boolean;
  muted: boolean;
  solo: boolean;
  eq: ChannelEqState;
  comp: ChannelCompState;
  limiter: ChannelLimiterState;
}

export interface EngineSnapshot {
  state: EngineState;
  positionSec: number;
  totalDuration: number;
  volume: number;
}

type StateListener = (snapshot: EngineSnapshot) => void;

// ─── Utility ────────────────────────────────────────────────

/** Convert 0-100 linear volume to dB (-Infinity…0) using Tone.js native */
function volumeToDB(v: number): number {
  if (v <= 0) return -Infinity;
  return Tone.gainToDb(v / 100);
}

// ─── EngineTrack ────────────────────────────────────────────

class EngineTrack {
  readonly id: string;
  readonly startSec: number;
  readonly durationSec: number;
  readonly overlay: boolean;
  readonly busType: "voice" | "atmosphere" | "sfx";

  player: Tone.Player;
  channel: Tone.Channel;

  // PRE chain: EQ3 → Compressor
  private eqNode: Tone.EQ3;
  private _eqBypassed = true;
  private _eqLow = 0;
  private _eqMid = 0;
  private _eqHigh = 0;

  private preFxNode: Tone.Compressor;
  private _preFxBypassed = true;
  private _compThreshold = -24;
  private _compRatio = 3;
  private _compKnee = 10;
  private _compAttack = 0.01;
  private _compRelease = 0.1;

  // POST chain: Limiter (after channel, before reverb)
  private limiterNode: Tone.Limiter;
  private _limiterBypassed = true;
  private _limiterThreshold = -3;

  // POST chain: Panner3D (after limiter, before convolver)
  private panner3dNode: Tone.Panner3D;
  private _panner3dBypassed = true;
  private _panner3dX = 0;
  private _panner3dY = 0;
  private _panner3dZ = 0;
  private _panner3dDistanceModel: DistanceModelType = "inverse";
  private _panner3dRefDistance = 1;
  private _panner3dMaxDistance = 10000;
  private _panner3dRolloffFactor = 1;
  private _panner3dConeInnerAngle = 360;
  private _panner3dConeOuterAngle = 360;
  private _panner3dConeOuterGain = 0;

  // POST chain: Convolver (after panner3d, before reverb)
  private convolverNode: Tone.Convolver;
  private _convolverBypassed = true;
  private _convolverDryWet = 0.3;
  private _convolverDryGain: Tone.Gain;
  private _convolverWetGain: Tone.Gain;
  private _convolverMerge: Tone.Gain;

  // Per-channel reverb
  private reverbNode: Tone.Reverb;
  private _reverbBypassed = true;
  private _reverbWet = 0.15;

  // Metering: mono (pre-pan) and stereo split (post-pan)
  private meterMono: Tone.Meter;
  private splitter: Tone.Split;
  private meterL: Tone.Meter;
  private meterR: Tone.Meter;

  // Telephone FX chain (inserted between player and eqNode when segmentType==='telephone')
  private _telephone = false;
  private _phoneFilter: Tone.Filter | null = null;
  private _phoneCrusher: Tone.WaveShaper | null = null;
  private _phoneDistortion: Tone.Distortion | null = null;
  private _phoneComp: Tone.Compressor | null = null;
  private _phoneNoise: Tone.Noise | null = null;
  private _phoneNoiseFilter: Tone.Filter | null = null;
  private _phoneNoiseGain: Tone.Gain | null = null;
  private _phoneHum: Tone.Oscillator | null = null;
  private _phoneHumGain: Tone.Gain | null = null;

  private _muted = false;
  private _solo = false;
  private _volume = 80;
  private _pan = 0;
  private _fadeInSec: number;
  private _fadeOutSec: number;

  private scheduledId: number | null = null;

  // ── Loop support ──
  private _loop: boolean;
  private _clipLenSec: number;
  private _loopCrossfadeSec: number;
  /** Secondary player for crossfade between loop iterations */
  private playerB: Tone.Player | null = null;
  private loopScheduledIds: number[] = [];

  constructor(config: TrackConfig, bus: Tone.Channel, preloadedBuffer?: Tone.ToneAudioBuffer) {
    this.id = config.id;
    this.startSec = config.startSec;
    this.durationSec = config.durationSec;
    this.overlay = config.overlay ?? false;
    this.busType = config.bus ?? "voice";
    this._volume = config.volume ?? 80;
    this._pan = config.pan ?? 0;
    this._fadeInSec = config.fadeInSec ?? 0;
    this._fadeOutSec = config.fadeOutSec ?? 0;
    this._loop = config.loop ?? false;
    this._clipLenSec = config.clipLenSec ?? config.durationSec;
    this._loopCrossfadeSec = config.loopCrossfadeSec ?? 0;
    this._telephone = config.segmentType === "telephone";
    if (this._telephone) {
      console.log(`[AudioEngine] 📞 Telephone FX chain activated for track ${config.id} (label: ${config.label})`);
    }

    // PRE: EQ3 (bypassed)
    this.eqNode = new Tone.EQ3({ low: 0, mid: 0, high: 0 });

    // PRE: Compressor (bypassed)
    this.preFxNode = new Tone.Compressor({
      threshold: this._compThreshold,
      ratio: this._compRatio,
      knee: this._compKnee,
      attack: this._compAttack,
      release: this._compRelease,
    });

    // Channel: volume + pan
    this.channel = new Tone.Channel({
      volume: volumeToDB(this._volume),
      pan: this._pan,
    });

    // POST: Limiter (bypassed — set threshold to 0 when bypassed)
    this.limiterNode = new Tone.Limiter(0);

    // POST: Panner3D (bypassed by default — at origin = transparent)
    this.panner3dNode = new Tone.Panner3D({
      positionX: 0, positionY: 0, positionZ: 0,
      distanceModel: "inverse",
      refDistance: 1,
      maxDistance: 10000,
      rolloffFactor: 1,
      coneInnerAngle: 360,
      coneOuterAngle: 360,
      coneOuterGain: 0,
    });

    // POST: Convolver with manual dry/wet routing
    this.convolverNode = new Tone.Convolver();
    this._convolverDryGain = new Tone.Gain(1);
    this._convolverWetGain = new Tone.Gain(0);
    this._convolverMerge = new Tone.Gain(1);

    // Reverb: small room, bypassed
    this.reverbNode = new Tone.Reverb({
      decay: 1.5,
      wet: 0,
    });

    // Meters
    this.meterMono = new Tone.Meter({ smoothing: 0.8 });
    this.splitter = new Tone.Split();
    this.meterL = new Tone.Meter({ smoothing: 0.8 });
    this.meterR = new Tone.Meter({ smoothing: 0.8 });

    // Chain: Player → EQ3 → Comp → Channel → Limiter → Panner3D → [ConvolverDry/Wet] → Reverb → Bus
    //                                  └→ MeterMono
    //        Reverb → Splitter → MeterL/R
    if (preloadedBuffer) {
      this.player = new Tone.Player({
        fadeIn: 0,
        fadeOut: this._fadeOutSec,
      });
      this.player.buffer = preloadedBuffer;
    } else {
      this.player = new Tone.Player({
        url: config.url,
        fadeIn: 0,
        fadeOut: this._fadeOutSec,
      });
    }

    // Wire signal chain (with optional telephone insert before EQ)
    if (this._telephone) {
      this._phoneFilter = new Tone.Filter({ type: "bandpass", frequency: 1900, Q: 0.8 });
      // WaveShaper-based bit crusher (no AudioWorklet dependency)
      const bits = 4;
      const steps = Math.pow(2, bits);
      const curveLen = 8192;
      const curve = new Float32Array(curveLen);
      for (let i = 0; i < curveLen; i++) {
        const x = (i * 2) / curveLen - 1;
        curve[i] = Math.round(x * steps) / steps;
      }
      this._phoneCrusher = new Tone.WaveShaper(curve, curveLen);
      this._phoneDistortion = new Tone.Distortion({ distortion: 0.2, wet: 0.5 });
      this._phoneComp = new Tone.Compressor({ threshold: -30, ratio: 12, attack: 0.003, release: 0.25 });
      // Chain: Player → BandpassFilter → WaveShaper(crush) → Distortion → PhoneComp → EQ
      this.player.connect(this._phoneFilter);
      this._phoneFilter.connect(this._phoneCrusher);
      this._phoneCrusher.connect(this._phoneDistortion);
      this._phoneDistortion.connect(this._phoneComp);
      this._phoneComp.connect(this.eqNode);
      console.log(`[AudioEngine] 📞 Telephone chain wired: Filter→Crusher→Distortion→Comp→EQ`);

      // Pink noise (line static)
      this._phoneNoiseFilter = new Tone.Filter({ type: "bandpass", frequency: 1000, Q: 0.5 });
      this._phoneNoiseGain = new Tone.Gain(0.015);
      this._phoneNoise = new Tone.Noise("pink");
      this._phoneNoise.connect(this._phoneNoiseFilter);
      this._phoneNoiseFilter.connect(this._phoneNoiseGain);
      this._phoneNoiseGain.connect(this._phoneFilter); // route noise through same bandpass

      // 50Hz hum (power line)
      this._phoneHumGain = new Tone.Gain(0.005);
      this._phoneHum = new Tone.Oscillator(50, "sine");
      this._phoneHum.connect(this._phoneHumGain);
      this._phoneHumGain.connect(this._phoneFilter);
    } else {
      this.player.connect(this.eqNode);
    }
    this.eqNode.connect(this.preFxNode);
    this.preFxNode.connect(this.channel);
    this.channel.connect(this.meterMono);
    this.channel.connect(this.limiterNode);
    this.limiterNode.connect(this.panner3dNode);
    // Panner3D → convolver dry/wet split → merge → reverb
    this.panner3dNode.connect(this._convolverDryGain);
    this.panner3dNode.connect(this.convolverNode);
    this.convolverNode.connect(this._convolverWetGain);
    this._convolverDryGain.connect(this._convolverMerge);
    this._convolverWetGain.connect(this._convolverMerge);
    this._convolverMerge.connect(this.reverbNode);
    this.reverbNode.connect(bus);
    // Stereo metering tap
    this.reverbNode.connect(this.splitter);
    this.splitter.connect(this.meterL, 0);
    this.splitter.connect(this.meterR, 1);

    // Create secondary player for crossfade looping
    if (this._loop && this._loopCrossfadeSec > 0) {
      if (preloadedBuffer) {
        this.playerB = new Tone.Player({
          fadeIn: this._loopCrossfadeSec,
          fadeOut: this._loopCrossfadeSec,
        });
        this.playerB.buffer = preloadedBuffer;
      } else {
        this.playerB = new Tone.Player({
          url: config.url,
          fadeIn: this._loopCrossfadeSec,
          fadeOut: this._loopCrossfadeSec,
        });
      }
      this.playerB.connect(this._telephone && this._phoneFilter ? this._phoneFilter : this.eqNode);
    }

    // Apply bypass states
    this.applyEqBypass();
    this.applyPreFxBypass();
    this.applyLimiterBypass();
    this.applyPanner3dBypass();
    this.applyConvolverBypass();
    this.applyReverbBypass();
  }

  // ── Scheduling ──

  schedule(): void {
    this.unschedule();

    if (this._loop) {
      this.scheduleLoop(this.startSec, 0);
    } else {
      this.scheduledId = Tone.getTransport().schedule((time) => {
        if (this.player.loaded) {
          this.player.fadeIn = this._fadeInSec;
          // Start telephone noise/hum generators along with the player
          if (this._telephone) {
            this._phoneNoise?.start(time);
            this._phoneHum?.start(time);
          }
          // Don't limit voice clip duration — let audio play to its natural end.
          // The actual audio may be longer than the estimated durationSec.
          // Only apply duration limit for atmosphere/sfx clips that have explicit fades.
          const hasFadeOut = this._fadeOutSec > 0;
          if (hasFadeOut) {
            this.player.start(time, 0, this.durationSec);
            if (this._telephone) {
              this._phoneNoise?.stop(time + this.durationSec);
              this._phoneHum?.stop(time + this.durationSec);
            }
          } else {
            this.player.start(time, 0);
          }
        }
      }, this.startSec);
    }
  }

  /** Schedule looping iterations with crossfade overlap */
  private scheduleLoop(transportStart: number, audioOffset: number): void {
    this.clearLoopIds();
    const xfade = this._loopCrossfadeSec;
    const step = Math.max(1, this._clipLenSec - xfade);
    const totalFill = this.durationSec - audioOffset;
    const iterations = Math.ceil(totalFill / step) + 1;
    const players = [this.player, this.playerB ?? this.player];

    for (let i = 0; i < iterations; i++) {
      const iterOffset = i * step;
      if (iterOffset >= totalFill) break;

      const p = players[i % 2];
      const schedTime = transportStart + iterOffset;
      const remaining = Math.min(this._clipLenSec, totalFill - iterOffset);
      const isFirst = i === 0;
      const isLast = iterOffset + step >= totalFill;

      const id = Tone.getTransport().schedule((time) => {
        if (p.loaded) {
          p.fadeIn = isFirst ? this._fadeInSec : xfade;
          p.fadeOut = isLast ? this._fadeOutSec : xfade;
          // On first iteration with audioOffset, start from offset
          const startOffset = isFirst ? audioOffset : 0;
          const dur = isFirst ? Math.min(remaining, this._clipLenSec - audioOffset) : remaining;
          p.start(time, startOffset, dur);
        }
      }, schedTime);

      this.loopScheduledIds.push(id);
    }
  }

  private clearLoopIds(): void {
    for (const id of this.loopScheduledIds) {
      Tone.getTransport().clear(id);
    }
    this.loopScheduledIds = [];
  }

  scheduleWithOffset(transportTime: number, offset: number): void {
    this.unschedule();

    if (this._loop) {
      // Calculate which iteration we're in and the offset within that iteration
      const xfade = this._loopCrossfadeSec;
      const step = Math.max(1, this._clipLenSec - xfade);
      const iterIdx = Math.floor(offset / step);
      const iterAudioOffset = offset - iterIdx * step;
      this.scheduleLoop(transportTime, offset);
      return;
    }

    const hasFadeOut = this._fadeOutSec > 0;
    this.scheduledId = Tone.getTransport().schedule((time) => {
      if (this.player.loaded) {
        this.player.fadeIn = 0;
        if (hasFadeOut) {
          const remaining = Math.max(0, this.durationSec - offset);
          this.player.start(time, offset, remaining);
        } else {
          this.player.start(time, offset);
        }
      }
    }, transportTime);
  }

  unschedule(): void {
    if (this.scheduledId !== null) {
      Tone.getTransport().clear(this.scheduledId);
      this.scheduledId = null;
    }
    this.clearLoopIds();
    try { this.player.stop(); } catch { /* not started */ }
    try { this.playerB?.stop(); } catch { /* not started */ }
  }

  // ── Volume / Pan ──

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(100, v));
    this.channel.volume.value = this._muted ? -Infinity : volumeToDB(this._volume);
  }

  setPan(p: number): void {
    this._pan = Math.max(-1, Math.min(1, p));
    this.channel.pan.value = this._pan;
  }

  // ── Mute / Solo ──

  setMuted(m: boolean): void {
    this._muted = m;
    this.channel.volume.value = m ? -Infinity : volumeToDB(this._volume);
  }

  setSolo(s: boolean): void {
    this._solo = s;
  }

  get muted() { return this._muted; }
  get solo() { return this._solo; }
  get volumeValue() { return this._volume; }
  get panValue() { return this._pan; }

  // ── Channel EQ (PRE) ──

  setEqLow(v: number): void { this._eqLow = v; if (!this._eqBypassed) this.eqNode.low.value = v; }
  setEqMid(v: number): void { this._eqMid = v; if (!this._eqBypassed) this.eqNode.mid.value = v; }
  setEqHigh(v: number): void { this._eqHigh = v; if (!this._eqBypassed) this.eqNode.high.value = v; }
  setEqBypassed(b: boolean): void { this._eqBypassed = b; this.applyEqBypass(); }
  private applyEqBypass(): void {
    if (this._eqBypassed) {
      this.eqNode.low.value = 0; this.eqNode.mid.value = 0; this.eqNode.high.value = 0;
    } else {
      this.eqNode.low.value = this._eqLow; this.eqNode.mid.value = this._eqMid; this.eqNode.high.value = this._eqHigh;
    }
  }
  get eqBypassed() { return this._eqBypassed; }
  get eqState(): ChannelEqState { return { low: this._eqLow, mid: this._eqMid, high: this._eqHigh, bypassed: this._eqBypassed }; }

  // ── Channel Compressor (PRE) ──

  setPreFxBypassed(b: boolean): void {
    this._preFxBypassed = b;
    this.applyPreFxBypass();
  }

  private applyPreFxBypass(): void {
    if (this._preFxBypassed) {
      this.preFxNode.ratio.value = 1;
    } else {
      this.preFxNode.ratio.value = this._compRatio;
    }
  }

  setCompThreshold(v: number): void { this._compThreshold = v; this.preFxNode.threshold.value = v; }
  setCompRatio(v: number): void { this._compRatio = v; if (!this._preFxBypassed) this.preFxNode.ratio.value = v; }
  setCompKnee(v: number): void { this._compKnee = v; this.preFxNode.knee.value = v; }
  setCompAttack(v: number): void { this._compAttack = v; this.preFxNode.attack.value = v; }
  setCompRelease(v: number): void { this._compRelease = v; this.preFxNode.release.value = v; }

  get preFxBypassed() { return this._preFxBypassed; }
  get compState(): ChannelCompState {
    return { threshold: this._compThreshold, ratio: this._compRatio, knee: this._compKnee, attack: this._compAttack, release: this._compRelease, bypassed: this._preFxBypassed };
  }

  // ── Channel Limiter (POST) ──

  setLimiterThreshold(v: number): void { this._limiterThreshold = v; if (!this._limiterBypassed) this.limiterNode.threshold.value = v; }
  setLimiterBypassed(b: boolean): void { this._limiterBypassed = b; this.applyLimiterBypass(); }
  private applyLimiterBypass(): void {
    this.limiterNode.threshold.value = this._limiterBypassed ? 0 : this._limiterThreshold;
  }
  get limiterBypassed() { return this._limiterBypassed; }
  get limiterState(): ChannelLimiterState { return { threshold: this._limiterThreshold, bypassed: this._limiterBypassed }; }

  // ── Panner3D ──

  setPanner3dBypassed(b: boolean): void {
    this._panner3dBypassed = b;
    this.applyPanner3dBypass();
  }

  private applyPanner3dBypass(): void {
    if (this._panner3dBypassed) {
      this.panner3dNode.positionX.value = 0;
      this.panner3dNode.positionY.value = 0;
      this.panner3dNode.positionZ.value = 0;
    } else {
      this.panner3dNode.positionX.value = this._panner3dX;
      this.panner3dNode.positionY.value = this._panner3dY;
      this.panner3dNode.positionZ.value = this._panner3dZ;
    }
  }

  setPanner3dPosition(x: number, y: number, z: number): void {
    this._panner3dX = x; this._panner3dY = y; this._panner3dZ = z;
    if (!this._panner3dBypassed) {
      this.panner3dNode.positionX.value = x;
      this.panner3dNode.positionY.value = y;
      this.panner3dNode.positionZ.value = z;
    }
  }

  setPanner3dParams(p: { distanceModel?: DistanceModelType; refDistance?: number; maxDistance?: number; rolloffFactor?: number; coneInnerAngle?: number; coneOuterAngle?: number; coneOuterGain?: number }): void {
    if (p.distanceModel !== undefined) { this._panner3dDistanceModel = p.distanceModel; this.panner3dNode.distanceModel = p.distanceModel; }
    if (p.refDistance !== undefined) { this._panner3dRefDistance = p.refDistance; this.panner3dNode.refDistance = p.refDistance; }
    if (p.maxDistance !== undefined) { this._panner3dMaxDistance = p.maxDistance; this.panner3dNode.maxDistance = p.maxDistance; }
    if (p.rolloffFactor !== undefined) { this._panner3dRolloffFactor = p.rolloffFactor; this.panner3dNode.rolloffFactor = p.rolloffFactor; }
    if (p.coneInnerAngle !== undefined) { this._panner3dConeInnerAngle = p.coneInnerAngle; this.panner3dNode.coneInnerAngle = p.coneInnerAngle; }
    if (p.coneOuterAngle !== undefined) { this._panner3dConeOuterAngle = p.coneOuterAngle; this.panner3dNode.coneOuterAngle = p.coneOuterAngle; }
    if (p.coneOuterGain !== undefined) { this._panner3dConeOuterGain = p.coneOuterGain; this.panner3dNode.coneOuterGain = p.coneOuterGain; }
  }

  get panner3dBypassed() { return this._panner3dBypassed; }

  // ── Convolver ──

  setConvolverBypassed(b: boolean): void {
    this._convolverBypassed = b;
    this.applyConvolverBypass();
  }

  private applyConvolverBypass(): void {
    if (this._convolverBypassed) {
      this._convolverDryGain.gain.value = 1;
      this._convolverWetGain.gain.value = 0;
    } else {
      this._convolverDryGain.gain.value = 1 - this._convolverDryWet;
      this._convolverWetGain.gain.value = this._convolverDryWet;
    }
  }

  setConvolverDryWet(w: number): void {
    this._convolverDryWet = Math.max(0, Math.min(1, w));
    if (!this._convolverBypassed) {
      this._convolverDryGain.gain.value = 1 - this._convolverDryWet;
      this._convolverWetGain.gain.value = this._convolverDryWet;
    }
  }

  async loadConvolverIR(url: string): Promise<void> {
    try {
      await this.convolverNode.load(url);
    } catch (e) {
      console.error("[EngineTrack] Failed to load convolver IR:", e);
    }
  }

  get convolverBypassed() { return this._convolverBypassed; }

  // ── Reverb ──

  setReverbWet(w: number): void {
    this._reverbWet = Math.max(0, Math.min(1, w));
    if (!this._reverbBypassed) {
      this.reverbNode.wet.value = this._reverbWet;
    }
  }

  setReverbBypassed(b: boolean): void {
    this._reverbBypassed = b;
    this.applyReverbBypass();
  }

  private applyReverbBypass(): void {
    this.reverbNode.wet.value = this._reverbBypassed ? 0 : this._reverbWet;
  }

  get reverbWet() { return this._reverbWet; }
  get reverbBypassed() { return this._reverbBypassed; }

  // ── Fade in/out ──

  setFadeIn(sec: number): void {
    this._fadeInSec = Math.max(0, sec);
    this.player.fadeIn = this._fadeInSec;
  }

  setFadeOut(sec: number): void {
    this._fadeOutSec = Math.max(0, sec);
    this.player.fadeOut = this._fadeOutSec;
  }

  get fadeInSec() { return this._fadeInSec; }
  get fadeOutSec() { return this._fadeOutSec; }

  // ── Metering ──

  getMeterData(): TrackMeterData {
    const monoVal = this.meterMono.getValue();
    const lVal = this.meterL.getValue();
    const rVal = this.meterR.getValue();
    return {
      level: typeof monoVal === "number" ? monoVal : -Infinity,
      levelL: typeof lVal === "number" ? lVal : -Infinity,
      levelR: typeof rVal === "number" ? rVal : -Infinity,
    };
  }

  // ── Mix state snapshot ──

  getMixState(): TrackMixState {
    return {
      volume: this._volume,
      pan: this._pan,
      reverbWet: this._reverbWet,
      reverbBypassed: this._reverbBypassed,
      preFxBypassed: this._preFxBypassed,
      muted: this._muted,
      solo: this._solo,
      eq: this.eqState,
      comp: this.compState,
      limiter: this.limiterState,
    };
  }

  get loaded(): boolean { return this.player.loaded && (!this.playerB || this.playerB.loaded); }

  dispose(): void {
    this.unschedule();
    this.player.dispose();
    this.playerB?.dispose();
    // Dispose telephone chain
    this._phoneNoise?.stop(); this._phoneNoise?.dispose();
    this._phoneHum?.stop(); this._phoneHum?.dispose();
    this._phoneFilter?.dispose();
    this._phoneCrusher?.dispose();
    this._phoneDistortion?.dispose();
    this._phoneComp?.dispose();
    this._phoneNoiseFilter?.dispose();
    this._phoneNoiseGain?.dispose();
    this._phoneHumGain?.dispose();
    this.eqNode.dispose();
    this.preFxNode.dispose();
    this.channel.dispose();
    this.limiterNode.dispose();
    this.panner3dNode.dispose();
    this.convolverNode.dispose();
    this._convolverDryGain.dispose();
    this._convolverWetGain.dispose();
    this._convolverMerge.dispose();
    this.reverbNode.dispose();
    this.meterMono.dispose();
    this.splitter.dispose();
    this.meterL.dispose();
    this.meterR.dispose();
  }
}

// ─── AudioEngine (Singleton) ────────────────────────────────

let _engineInstanceId = 0;

class AudioEngine {
  private static instance: AudioEngine | null = null;
  /** Monotonically increasing ID to detect engine resets */
  readonly instanceId: number;

  // Buses
  private voiceBus: Tone.Channel;
  private atmoBus: Tone.Channel;
  private sfxBus: Tone.Channel;
  private masterBus: Tone.Channel;

  // Master insert chain: EQ → Filters(5) → MultibandComp → Compressor → Limiter → Reverb (post)
  private masterEQ: Tone.EQ3;
  private masterFilters: Tone.Filter[] = [];
  private masterMBC: Tone.MultibandCompressor;
  private masterComp: Tone.Compressor;
  private masterLimiter: Tone.Limiter;
  private masterReverb: Tone.Reverb;

  // Bypass states for master chain
  private _masterEqBypassed = true;
  private _masterFilterBypassed = true;
  private _masterMBCBypassed = true;
  private _masterCompBypassed = true;
  private _masterLimiterBypassed = true;
  private _masterReverbBypassed = true;
  private _masterChainBypassed = false;

  // Master metering (stereo split)
  private masterSplitter: Tone.Split;
  private masterMeterL: Tone.Meter;
  private masterMeterR: Tone.Meter;
  // Peak metering (DCMeter for instantaneous/true-peak)
  private masterDCMeterL: Tone.DCMeter;
  private masterDCMeterR: Tone.DCMeter;
  // FFT analyzer for spectrum visualization
  private masterFFT: Tone.FFT;
  // Peak hold values (decayed in getMasterMeter)
  private _peakHoldL = -Infinity;
  private _peakHoldR = -Infinity;
  private _peakHoldTimeL = 0;
  private _peakHoldTimeR = 0;

  private tracks = new Map<string, EngineTrack>();
  /** Duration derived from loaded audio tracks only */
  private _totalDuration = 0;
  /** Timeline duration hint (includes silent/unrendered blocks) */
  private _timelineDurationHint = 0;
  private _volume = 80;
  private _state: EngineState = "stopped";
  private listeners = new Set<StateListener>();
  private pluginListeners = new Set<() => void>();
  private rafId = 0;
  private transport = Tone.getTransport();

  // Loop region
  private _loopStart: number | null = null;
  private _loopEnd: number | null = null;

  private constructor() {
    this.instanceId = ++_engineInstanceId;
    this.masterBus = new Tone.Channel({ volume: volumeToDB(this._volume) });

    // Master insert chain nodes
    this.masterEQ = new Tone.EQ3({ low: 0, mid: 0, high: 0 });
    // 5-band parametric filter
    for (let i = 0; i < 5; i++) {
      const def = this._filterBands[i];
      this.masterFilters.push(new Tone.Filter({
        frequency: def.frequency,
        type: def.type,
        Q: def.Q,
        gain: def.gain,
        rolloff: def.rolloff,
      }));
    }
    this.masterMBC = new Tone.MultibandCompressor({
      low: { threshold: this._mbcParams.low.threshold, ratio: this._mbcParams.low.ratio, attack: this._mbcParams.low.attack, release: this._mbcParams.low.release, knee: this._mbcParams.low.knee },
      mid: { threshold: this._mbcParams.mid.threshold, ratio: this._mbcParams.mid.ratio, attack: this._mbcParams.mid.attack, release: this._mbcParams.mid.release, knee: this._mbcParams.mid.knee },
      high: { threshold: this._mbcParams.high.threshold, ratio: this._mbcParams.high.ratio, attack: this._mbcParams.high.attack, release: this._mbcParams.high.release, knee: this._mbcParams.high.knee },
      lowFrequency: this._mbcParams.lowFrequency,
      highFrequency: this._mbcParams.highFrequency,
    });
    this.masterComp = new Tone.Compressor({ threshold: -18, ratio: 4, attack: 0.005, release: 0.15 });
    this.masterLimiter = new Tone.Limiter(-1);
    this.masterReverb = new Tone.Reverb({ decay: 2.0, wet: 0.12 });

    this.masterSplitter = new Tone.Split();
    this.masterMeterL = new Tone.Meter({ smoothing: 0.8 });
    this.masterMeterR = new Tone.Meter({ smoothing: 0.8 });
    this.masterDCMeterL = new Tone.DCMeter();
    this.masterDCMeterR = new Tone.DCMeter();
    // FFT analyzer (128 bins for smooth spectrum display)
    this.masterFFT = new Tone.FFT(128);

    // Chain: MasterBus → EQ → Comp → Limiter → Filter1→…→Filter5 → MBC → Reverb → Splitter → Meters + Destination
    this.masterBus.connect(this.masterEQ);
    this.masterEQ.connect(this.masterComp);
    this.masterComp.connect(this.masterLimiter);
    this.masterLimiter.connect(this.masterFilters[0]);
    for (let i = 0; i < 4; i++) {
      this.masterFilters[i].connect(this.masterFilters[i + 1]);
    }
    this.masterFilters[4].connect(this.masterMBC);
    this.masterMBC.connect(this.masterReverb);
    this.masterReverb.connect(this.masterSplitter);
    this.masterSplitter.connect(this.masterMeterL, 0);
    this.masterSplitter.connect(this.masterMeterR, 1);
    this.masterSplitter.connect(this.masterDCMeterL, 0);
    this.masterSplitter.connect(this.masterDCMeterR, 1);
    // Connect FFT analyzer to splitter (same tap point as meters)
    this.masterSplitter.connect(this.masterFFT);
    this.masterReverb.toDestination();

    // Sub-buses → MasterBus
    this.voiceBus = new Tone.Channel({ volume: 0 }).connect(this.masterBus);
    this.atmoBus = new Tone.Channel({ volume: 0 }).connect(this.masterBus);
    this.sfxBus = new Tone.Channel({ volume: 0 }).connect(this.masterBus);

    // Apply initial bypass states (all bypassed by default)
    this.applyMasterEqBypass();
    this.applyMasterFilterBypass();
    this.applyMasterMBCBypass();
    this.applyMasterCompBypass();
    this.applyMasterLimiterBypass();
    this.applyMasterReverbBypass();

    this.transport.loop = false;
  }

  static getInstance(): AudioEngine {
    // Survive Vite HMR: store on window so module re-evaluation reuses the same instance
    const w = window as unknown as { __audioEngine?: AudioEngine };
    if (w.__audioEngine) {
      AudioEngine.instance = w.__audioEngine;
      return w.__audioEngine;
    }
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
      w.__audioEngine = AudioEngine.instance;
    }
    return AudioEngine.instance;
  }

  private getBus(type: "voice" | "atmosphere" | "sfx"): Tone.Channel {
    switch (type) {
      case "atmosphere": return this.atmoBus;
      case "sfx": return this.sfxBus;
      default: return this.voiceBus;
    }
  }

  private getEffectiveTotalDuration(): number {
    return Math.max(this._totalDuration, this._timelineDurationHint);
  }

  /**
   * External timeline can hint full duration including silent/unrendered clips.
   * Prevents premature auto-stop when transport enters an empty block.
   */
  setTimelineDuration(totalSec: number): void {
    this._timelineDurationHint = Math.max(0, Number.isFinite(totalSec) ? totalSec : 0);
    this.notify();
  }

  // ─── Loop region ──────────────────────────────────────────

  /** Set a loop region using native Tone.js transport loop. */
  setLoopRegion(startSec: number, endSec: number): void {
    this._loopStart = Math.max(0, startSec);
    this._loopEnd = Math.max(this._loopStart + 0.1, endSec);
    this.transport.loopStart = this._loopStart;
    this.transport.loopEnd = this._loopEnd;
    this.transport.loop = true;
  }

  clearLoopRegion(): void {
    this._loopStart = null;
    this._loopEnd = null;
    this.transport.loop = false;
  }

  get loopStart(): number | null { return this._loopStart; }
  get loopEnd(): number | null { return this._loopEnd; }

  // ─── Track management ──────────────────────────────────

  async loadTracks(configs: TrackConfig[], onProgress?: (p: LoadProgress) => void): Promise<LoadTracksResult> {
    // Preserve actual transport position across reloads triggered by timeline edits.
    const savedPosition = this.transport.seconds;
    const previousState = this._state;
    this.stop();
    for (const t of this.tracks.values()) t.dispose();
    this.tracks.clear();

    if (configs.length === 0) {
      this._totalDuration = 0;
      this.notify();
      return { total: 0, loaded: 0, dropped: 0 };
    }

    // Ensure AudioContext is running before loading audio buffers
    if (Tone.getContext().state !== "running") {
      try {
        await Tone.start();
        console.log("[AudioEngine] AudioContext started, state:", Tone.getContext().state);
      } catch (e) {
        console.warn("[AudioEngine] Could not start AudioContext:", e);
      }
    }

    let dropped = 0;
    let loadedCount = 0;

    // Load large stem files sequentially to avoid decoder/network starvation.
    for (let ci = 0; ci < configs.length; ci++) {
      const cfg = configs[ci];
      onProgress?.({
        total: configs.length,
        done: ci,
        loaded: loadedCount,
        failed: dropped,
        currentId: cfg.id,
        currentLabel: cfg.label ?? cfg.id,
      });

      const startedAt = performance.now();
      let buffer: Tone.ToneAudioBuffer | null = null;

      try {
        // Fetch audio data (cache-first if cacheKey provided)
        const arrayBuf = cfg.cacheKey
          ? await fetchWithStemCache(cfg.cacheKey, cfg.url)
          : await fetch(cfg.url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); });

        // Decode into ToneAudioBuffer
        const audioCtx = Tone.getContext().rawContext as AudioContext;
        const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
        buffer = new Tone.ToneAudioBuffer(decoded);

        const elapsedMs = Math.round(performance.now() - startedAt);
        console.log(`[AudioEngine] Track ${cfg.id} fetched+decoded in ${elapsedMs}ms${cfg.cacheKey ? " (cache-aware)" : ""}`);
      } catch (err) {
        console.error(`[AudioEngine] Track ${cfg.id} fetch/decode error:`, err);
      }

      if (!buffer) {
        console.warn(`[AudioEngine] Dropping failed track: ${cfg.id}`);
        dropped++;
      } else {
        const bus = this.getBus(cfg.bus ?? "voice");
        const track = new EngineTrack(cfg, bus, buffer);
        this.tracks.set(cfg.id, track);
        loadedCount++;
      }

      onProgress?.({
        total: configs.length,
        done: ci + 1,
        loaded: loadedCount,
        failed: dropped,
        currentId: cfg.id,
        currentLabel: cfg.label ?? cfg.id,
      });
    }

    if (this.tracks.size === 0) {
      this._totalDuration = 0;
      this.notify();
      const ctxState = Tone.getContext().state;
      throw new Error(`AudioEngine: no tracks loaded (${dropped} dropped, ctx=${ctxState})`);
    }

    this._totalDuration = Math.max(
      ...Array.from(this.tracks.values()).map((t) => t.startSec + t.durationSec)
    );

    this.transport.cancel();
    for (const t of this.tracks.values()) t.schedule();

    // Restore transport position that was saved before stop()
    if (savedPosition > 0) {
      this.transport.seconds = Math.min(savedPosition, this.getEffectiveTotalDuration());
      this._state = previousState === "playing" ? "paused" : previousState;
    }

    this.notify();
    return { total: configs.length, loaded: loadedCount, dropped };
  }

  /**
   * Load additional tracks into an already-loaded engine (e.g. retry failed stems).
   * Does NOT clear existing tracks — only adds new ones.
   */
  async loadAdditionalTracks(configs: TrackConfig[], onProgress?: (p: LoadProgress) => void): Promise<LoadTracksResult> {
    if (configs.length === 0) return { total: 0, loaded: 0, dropped: 0 };

    const wasPlaying = this._state === "playing";
    if (wasPlaying) this.pause();

    if (Tone.getContext().state !== "running") {
      try { await Tone.start(); } catch (_) { /* noop */ }
    }

    let dropped = 0;
    let loadedCount = 0;

    for (let ci = 0; ci < configs.length; ci++) {
      const cfg = configs[ci];
      onProgress?.({ total: configs.length, done: ci, loaded: loadedCount, failed: dropped, currentId: cfg.id, currentLabel: cfg.label ?? cfg.id });

      const startedAt = performance.now();
      let buffer: Tone.ToneAudioBuffer | null = null;

      try {
        const arrayBuf = cfg.cacheKey
          ? await fetchWithStemCache(cfg.cacheKey, cfg.url)
          : await fetch(cfg.url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); });
        const audioCtx = Tone.getContext().rawContext as AudioContext;
        const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
        buffer = new Tone.ToneAudioBuffer(decoded);
        console.log(`[AudioEngine] Additional track ${cfg.id} loaded in ${Math.round(performance.now() - startedAt)}ms`);
      } catch (err) {
        console.error(`[AudioEngine] Additional track ${cfg.id} fetch/decode error:`, err);
      }

      if (!buffer) {
        dropped++;
      } else {
        const bus = this.getBus(cfg.bus ?? "voice");
        const track = new EngineTrack(cfg, bus, buffer);
        this.tracks.set(cfg.id, track);
        loadedCount++;
        track.schedule();
      }

      onProgress?.({ total: configs.length, done: ci + 1, loaded: loadedCount, failed: dropped, currentId: cfg.id, currentLabel: cfg.label ?? cfg.id });
    }

    this._totalDuration = this.tracks.size > 0
      ? Math.max(...Array.from(this.tracks.values()).map(t => t.startSec + t.durationSec))
      : 0;

    this.notify();
    return { total: configs.length, loaded: loadedCount, dropped };
  }

  async addTrack(config: TrackConfig): Promise<void> {
    const bus = this.getBus(config.bus ?? "voice");
    const track = new EngineTrack(config, bus);
    this.tracks.set(config.id, track);

    const end = config.startSec + config.durationSec;
    if (end > this._totalDuration) this._totalDuration = end;

    // Wait for buffer to load using Tone.loaded() instead of manual polling
    await Promise.race([
      Tone.loaded(),
      new Promise<void>((resolve) => setTimeout(resolve, 30_000)),
    ]);

    track.schedule();
    this.notify();
  }

  removeTrack(id: string): void {
    const track = this.tracks.get(id);
    if (track) {
      track.dispose();
      this.tracks.delete(id);
      this._totalDuration = this.tracks.size > 0
        ? Math.max(...Array.from(this.tracks.values()).map(t => t.startSec + t.durationSec))
        : 0;
      this.notify();
    }
  }

  // ─── Transport controls ────────────────────────────────

  async play(): Promise<void> {
    await Tone.start();
    if (this._state === "playing") return;

    // Apply solo logic
    this.applySoloLogic();

    if (this._state === "stopped") {
      this.transport.position = 0;
      for (const t of this.tracks.values()) t.schedule();
      this.transport.start();
    } else if (this._state === "paused") {
      // Re-schedule tracks from current position since pause stops all players
      const pos = this.transport.seconds;
      const immediateStarts: { track: EngineTrack; offset: number }[] = [];
      for (const t of this.tracks.values()) {
        t.unschedule();
        const trackEnd = t.startSec + t.durationSec;
        if (pos < trackEnd) {
          if (pos > t.startSec) {
            immediateStarts.push({ track: t, offset: pos - t.startSec });
          } else {
            t.schedule();
          }
        }
      }

      this.transport.start();
      // Start overlapping clips immediately with correct offset and duration limit
      for (const { track, offset } of immediateStarts) {
        if (track.player.loaded) {
          track.player.fadeIn = 0; // No fade on resume
          if (track.fadeOutSec > 0) {
            const remaining = Math.max(0, track.durationSec - offset);
            track.player.start(Tone.now(), offset, remaining);
          } else {
            track.player.start(Tone.now(), offset);
          }
        }
      }
    }

    this._state = "playing";
    this.startPositionLoop();
    this.notify();
  }

  pause(): void {
    if (this._state !== "playing") return;
    this.transport.pause();
    // Immediately stop all players so audio doesn't ring out
    for (const t of this.tracks.values()) {
      try { t.player.stop(); } catch { /* not started */ }
    }
    this._state = "paused";
    this.stopPositionLoop();
    this.notify();
  }

  stop(): void {
    this.transport.stop();
    this.transport.position = 0;
    for (const t of this.tracks.values()) {
      try { t.player.stop(); } catch { /* not started */ }
    }
    this._state = "stopped";
    this.stopPositionLoop();
    this.notify();
  }

  seek(toSec: number): void {
    const clamped = Math.max(0, Math.min(toSec, this.getEffectiveTotalDuration()));
    const wasPlaying = this._state === "playing";

    this.transport.stop();
    for (const t of this.tracks.values()) {
      try { t.player.stop(); } catch { /* not started */ }
    }

    this.transport.seconds = clamped;

    // Collect tracks that overlap the seek position (need immediate start)
    const immediateStarts: { track: EngineTrack; offset: number }[] = [];

    for (const t of this.tracks.values()) {
      t.unschedule();
      const trackEnd = t.startSec + t.durationSec;
      if (clamped < trackEnd) {
        if (clamped > t.startSec) {
          // This clip is already "in progress" at the seek point —
          // schedule future clips normally but start overlapping ones immediately
          const offset = clamped - t.startSec;
          immediateStarts.push({ track: t, offset });
        } else {
          // Clip starts in the future — normal schedule
          t.schedule();
        }
      }
    }

    if (wasPlaying) {
      this.transport.start();
      // Start overlapping clips immediately with correct offset and duration limit
      for (const { track, offset } of immediateStarts) {
        if (track.player.loaded) {
          track.player.fadeIn = 0; // No fade on seek resume
          if (track.fadeOutSec > 0) {
            const remaining = Math.max(0, track.durationSec - offset);
            track.player.start(Tone.now(), offset, remaining);
          } else {
            track.player.start(Tone.now(), offset);
          }
        }
      }
      this._state = "playing";
      this.startPositionLoop();
    } else {
      // Paused — schedule overlapping clips so they start on next play()
      for (const { track, offset } of immediateStarts) {
        track.scheduleWithOffset(clamped, offset);
      }
      this._state = "paused";
      this.stopPositionLoop();
    }

    this.notify();
  }

  // ─── Solo logic ────────────────────────────────────────

  private applySoloLogic(): void {
    const hasSolo = Array.from(this.tracks.values()).some(t => t.solo);
    if (!hasSolo) return;
    for (const t of this.tracks.values()) {
      if (!t.solo && !t.muted) {
        t.setMuted(true);
        // Mark as auto-muted (we track this via solo state)
      }
    }
  }

  // ─── Master volume ────────────────────────────────────

  setMasterVolume(v: number): void {
    this._volume = Math.max(0, Math.min(100, v));
    this.masterBus.volume.value = volumeToDB(this._volume);
    try { localStorage.setItem("timeline-volume", String(this._volume)); } catch { /* ignore */ }
    this.notify();
  }

  // ─── Per-track mix controls ────────────────────────────

  setTrackVolume(trackId: string, v: number): void {
    this.tracks.get(trackId)?.setVolume(v);
  }

  setTrackPan(trackId: string, p: number): void {
    this.tracks.get(trackId)?.setPan(p);
  }

  setTrackMuted(trackId: string, m: boolean): void {
    this.tracks.get(trackId)?.setMuted(m);
  }

  setTrackSolo(trackId: string, s: boolean): void {
    this.tracks.get(trackId)?.setSolo(s);
  }

  setTrackReverbWet(trackId: string, w: number): void {
    this.tracks.get(trackId)?.setReverbWet(w);
  }

  setTrackReverbBypassed(trackId: string, b: boolean): void {
    this.tracks.get(trackId)?.setReverbBypassed(b);
  }

  setTrackPreFxBypassed(trackId: string, b: boolean): void {
    this.tracks.get(trackId)?.setPreFxBypassed(b);
  }

  // ─── Per-track channel EQ (PRE) ────────────────────────
  setTrackEqLow(trackId: string, v: number): void { this.tracks.get(trackId)?.setEqLow(v); }
  setTrackEqMid(trackId: string, v: number): void { this.tracks.get(trackId)?.setEqMid(v); }
  setTrackEqHigh(trackId: string, v: number): void { this.tracks.get(trackId)?.setEqHigh(v); }
  setTrackEqBypassed(trackId: string, b: boolean): void { this.tracks.get(trackId)?.setEqBypassed(b); }

  // ─── Per-track channel compressor params ───────────────
  setTrackCompThreshold(trackId: string, v: number): void { this.tracks.get(trackId)?.setCompThreshold(v); }
  setTrackCompRatio(trackId: string, v: number): void { this.tracks.get(trackId)?.setCompRatio(v); }
  setTrackCompKnee(trackId: string, v: number): void { this.tracks.get(trackId)?.setCompKnee(v); }
  setTrackCompAttack(trackId: string, v: number): void { this.tracks.get(trackId)?.setCompAttack(v); }
  setTrackCompRelease(trackId: string, v: number): void { this.tracks.get(trackId)?.setCompRelease(v); }

  // ─── Per-track channel limiter (POST) ──────────────────
  setTrackLimiterThreshold(trackId: string, v: number): void { this.tracks.get(trackId)?.setLimiterThreshold(v); }
  setTrackLimiterBypassed(trackId: string, b: boolean): void { this.tracks.get(trackId)?.setLimiterBypassed(b); }

  // ─── Per-track Panner3D (POST) ─────────────────────────
  setTrackPanner3dBypassed(trackId: string, b: boolean): void { this.tracks.get(trackId)?.setPanner3dBypassed(b); }
  setTrackPanner3dPosition(trackId: string, x: number, y: number, z: number): void { this.tracks.get(trackId)?.setPanner3dPosition(x, y, z); }
  setTrackPanner3dParams(trackId: string, p: { distanceModel?: DistanceModelType; refDistance?: number; maxDistance?: number; rolloffFactor?: number; coneInnerAngle?: number; coneOuterAngle?: number; coneOuterGain?: number }): void { this.tracks.get(trackId)?.setPanner3dParams(p); }

  // ─── Per-track Convolver (POST) ────────────────────────
  setTrackConvolverBypassed(trackId: string, b: boolean): void { this.tracks.get(trackId)?.setConvolverBypassed(b); }
  setTrackConvolverDryWet(trackId: string, w: number): void { this.tracks.get(trackId)?.setConvolverDryWet(w); }
  async loadTrackConvolverIR(trackId: string, url: string): Promise<void> { await this.tracks.get(trackId)?.loadConvolverIR(url); }

  setTrackFadeIn(trackId: string, sec: number): void {
    this.tracks.get(trackId)?.setFadeIn(sec);
  }

  setTrackFadeOut(trackId: string, sec: number): void {
    this.tracks.get(trackId)?.setFadeOut(sec);
  }

  getTrackFades(trackId: string): { fadeInSec: number; fadeOutSec: number } | null {
    const t = this.tracks.get(trackId);
    if (!t) return null;
    return { fadeInSec: t.fadeInSec, fadeOutSec: t.fadeOutSec };
  }

  // ─── Clip preview (solo audition through full FX chain) ───

  private _previewTrackId: string | null = null;
  private _previewWasSolo = false;
  private _previewPrevMutes: Map<string, boolean> = new Map();

  /**
   * Preview a single clip through its full signal chain (incl. convolver).
   * Mutes all other tracks, seeks to clip start, plays, and restores on stop.
   */
  async previewClip(trackId: string): Promise<void> {
    const track = this.tracks.get(trackId);
    if (!track) return;

    await Tone.start();

    // If already previewing this clip, stop
    if (this._previewTrackId === trackId && this._state === "playing") {
      this.stopPreview();
      return;
    }

    // If already previewing another clip, clean up first
    if (this._previewTrackId) {
      this.stopPreview();
    }

    // Save mute states of all other tracks
    this._previewPrevMutes.clear();
    this._previewWasSolo = track.solo;
    for (const [id, t] of this.tracks) {
      this._previewPrevMutes.set(id, t.muted);
      if (id !== trackId) {
        t.setMuted(true);
      } else {
        t.setMuted(false);
      }
    }
    this._previewTrackId = trackId;

    // Seek to clip start and play
    this.seek(track.startSec);
    await this.play();
  }

  /** Stop preview and restore mute states. */
  stopPreview(): void {
    if (!this._previewTrackId) return;

    this.stop();

    // Restore mute states
    for (const [id, wasMuted] of this._previewPrevMutes) {
      this.tracks.get(id)?.setMuted(wasMuted);
    }
    this._previewPrevMutes.clear();
    this._previewTrackId = null;
  }

  /** Whether a clip is being previewed. */
  get previewingTrackId(): string | null {
    return this._previewTrackId;
  }

  // ─── Metering ─────────────────────────────────────────

  getTrackMeter(trackId: string): TrackMeterData | null {
    return this.tracks.get(trackId)?.getMeterData() ?? null;
  }

  getMasterMeter(): MasterMeterData {
    const lVal = this.masterMeterL.getValue();
    const rVal = this.masterMeterR.getValue();
    const levelL = typeof lVal === "number" ? lVal : -Infinity;
    const levelR = typeof rVal === "number" ? rVal : -Infinity;

    // DCMeter gives amplitude 0..1 — convert to dB
    const dcL = this.masterDCMeterL.getValue();
    const dcR = this.masterDCMeterR.getValue();
    const peakDbL = dcL > 0 ? 20 * Math.log10(dcL) : -Infinity;
    const peakDbR = dcR > 0 ? 20 * Math.log10(dcR) : -Infinity;

    // Peak hold: capture new peaks, decay after 1.5s
    const now = performance.now();
    const HOLD_MS = 1500;
    const FALL_RATE = 30; // dB/sec

    if (peakDbL >= this._peakHoldL) {
      this._peakHoldL = peakDbL;
      this._peakHoldTimeL = now;
    } else if (now - this._peakHoldTimeL > HOLD_MS) {
      this._peakHoldL -= FALL_RATE * (1 / 60);
    }

    if (peakDbR >= this._peakHoldR) {
      this._peakHoldR = peakDbR;
      this._peakHoldTimeR = now;
    } else if (now - this._peakHoldTimeR > HOLD_MS) {
      this._peakHoldR -= FALL_RATE * (1 / 60);
    }

    return {
      levelL,
      levelR,
      peakL: this._peakHoldL,
      peakR: this._peakHoldR,
    };
  }

  /** Get FFT spectrum data as Float32Array (dB values, typically -100 to 0) */
  getFFTData(): Float32Array {
    const data = this.masterFFT.getValue();
    return new Float32Array(data);
  }

  /** Resize FFT (must be power of 2). Reconnects to the same point in the chain. */
  setFFTSize(size: number): void {
    if (this.masterFFT.size === size) return;
    // Disconnect old node without disposing the upstream
    try { this.masterSplitter.disconnect(this.masterFFT); } catch { /* may already be disconnected */ }
    this.masterFFT.dispose();
    this.masterFFT = new Tone.FFT(size);
    this.masterSplitter.connect(this.masterFFT);
  }

  getFFTSize(): number {
    return this.masterFFT.size;
  }

  getTrackMixState(trackId: string): TrackMixState | null {
    return this.tracks.get(trackId)?.getMixState() ?? null;
  }

  getAllTrackIds(): string[] {
    return Array.from(this.tracks.keys());
  }

  // ─── Master Plugin Controls ─────────────────────────────

  private applyMasterEqBypass(): void {
    if (this._masterEqBypassed || this._masterChainBypassed) {
      this.masterEQ.low.value = 0;
      this.masterEQ.mid.value = 0;
      this.masterEQ.high.value = 0;
    } else {
      // Restore saved values (stored as defaults for now)
      this.masterEQ.low.value = this._eqLow;
      this.masterEQ.mid.value = this._eqMid;
      this.masterEQ.high.value = this._eqHigh;
    }
  }

  private applyMasterFilterBypass(): void {
    const bypassed = this._masterFilterBypassed || this._masterChainBypassed;
    for (let i = 0; i < 5; i++) {
      const f = this.masterFilters[i];
      const band = this._filterBands[i];
      if (bypassed) {
        // Bypass: make filter transparent (allpass at Q=0.5 effectively passes through)
        f.type = "allpass";
        f.frequency.value = 1000;
        f.Q.value = 0.5;
        f.gain.value = 0;
      } else {
        f.type = band.type;
        f.frequency.value = band.frequency;
        f.Q.value = band.Q;
        f.gain.value = band.gain;
        f.rolloff = band.rolloff;
      }
    }
  }

  private applyMasterMBCBypass(): void {
    const bypassed = this._masterMBCBypassed || this._masterChainBypassed;
    if (bypassed) {
      this.masterMBC.low.ratio.value = 1;
      this.masterMBC.mid.ratio.value = 1;
      this.masterMBC.high.ratio.value = 1;
    } else {
      const p = this._mbcParams;
      this.masterMBC.low.threshold.value = p.low.threshold;
      this.masterMBC.low.ratio.value = p.low.ratio;
      this.masterMBC.low.attack.value = p.low.attack;
      this.masterMBC.low.release.value = p.low.release;
      this.masterMBC.low.knee.value = p.low.knee;
      this.masterMBC.mid.threshold.value = p.mid.threshold;
      this.masterMBC.mid.ratio.value = p.mid.ratio;
      this.masterMBC.mid.attack.value = p.mid.attack;
      this.masterMBC.mid.release.value = p.mid.release;
      this.masterMBC.mid.knee.value = p.mid.knee;
      this.masterMBC.high.threshold.value = p.high.threshold;
      this.masterMBC.high.ratio.value = p.high.ratio;
      this.masterMBC.high.attack.value = p.high.attack;
      this.masterMBC.high.release.value = p.high.release;
      this.masterMBC.high.knee.value = p.high.knee;
      this.masterMBC.lowFrequency.value = p.lowFrequency;
      this.masterMBC.highFrequency.value = p.highFrequency;
    }
  }

  private applyMasterCompBypass(): void {
    if (this._masterCompBypassed || this._masterChainBypassed) {
      this.masterComp.ratio.value = 1;
    } else {
      this.masterComp.ratio.value = this._compRatio;
    }
  }

  private applyMasterLimiterBypass(): void {
    if (this._masterLimiterBypassed || this._masterChainBypassed) {
      this.masterLimiter.threshold.value = 0;
    } else {
      this.masterLimiter.threshold.value = this._limiterThreshold;
    }
  }

  private applyMasterReverbBypass(): void {
    this.masterReverb.wet.value = (this._masterReverbBypassed || this._masterChainBypassed) ? 0 : this._reverbWet;
  }

  // ─── Persist master plugin params ─────────────────────────
  private static readonly _LS_KEY = "master-plugin-params";

  private _loadSavedParams(): Record<string, any> {
    try {
      const raw = localStorage.getItem(AudioEngine._LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  private _persistParams(): void {
    try {
      localStorage.setItem(AudioEngine._LS_KEY, JSON.stringify({
        eqLow: this._eqLow, eqMid: this._eqMid, eqHigh: this._eqHigh,
        filterBands: this._filterBands,
        mbcParams: this._mbcParams,
        compThreshold: this._compThreshold, compRatio: this._compRatio,
        compAttack: this._compAttack, compRelease: this._compRelease, compKnee: this._compKnee,
        limiterThreshold: this._limiterThreshold,
        reverbDecay: this._reverbDecay, reverbWet: this._reverbWet,
      }));
    } catch {}
  }

  private _saved = this._loadSavedParams();

  // EQ band values
  private _eqLow = this._saved.eqLow ?? 0;
  private _eqMid = this._saved.eqMid ?? 0;
  private _eqHigh = this._saved.eqHigh ?? 0;
  // Filter bands (5-band parametric)
  private _filterBands: FilterBandParams[] = (this._saved.filterBands as FilterBandParams[] | undefined)?.length === 5
    ? (this._saved.filterBands as FilterBandParams[])
    : [...DEFAULT_FILTER_BANDS];
  // Multiband compressor params
  private _mbcParams: MultibandCompParams = this._saved.mbcParams
    ? { ...DEFAULT_MULTIBAND_COMP, ...this._saved.mbcParams,
        low: { ...DEFAULT_MULTIBAND_COMP.low, ...(this._saved.mbcParams?.low ?? {}) },
        mid: { ...DEFAULT_MULTIBAND_COMP.mid, ...(this._saved.mbcParams?.mid ?? {}) },
        high: { ...DEFAULT_MULTIBAND_COMP.high, ...(this._saved.mbcParams?.high ?? {}) },
      }
    : { ...DEFAULT_MULTIBAND_COMP, low: { ...DEFAULT_MULTIBAND_COMP.low }, mid: { ...DEFAULT_MULTIBAND_COMP.mid }, high: { ...DEFAULT_MULTIBAND_COMP.high } };
  // Compressor params
  private _compThreshold = this._saved.compThreshold ?? -18;
  private _compRatio = this._saved.compRatio ?? 4;
  private _compAttack = this._saved.compAttack ?? 0.005;
  private _compRelease = this._saved.compRelease ?? 0.15;
  private _compKnee = this._saved.compKnee ?? 6;
  // Limiter params
  private _limiterThreshold = this._saved.limiterThreshold ?? -1;
  // Reverb params
  private _reverbDecay = this._saved.reverbDecay ?? 2.0;
  private _reverbWet = this._saved.reverbWet ?? 0.12;

  setMasterEqBypassed(b: boolean): void {
    this._masterEqBypassed = b;
    this.applyMasterEqBypass();
    this.notifyPluginListeners();
  }

  setMasterFilterBypassed(b: boolean): void {
    this._masterFilterBypassed = b;
    this.applyMasterFilterBypass();
    this.notifyPluginListeners();
  }

  setMasterMBCBypassed(b: boolean): void {
    this._masterMBCBypassed = b;
    this.applyMasterMBCBypass();
    this.notifyPluginListeners();
  }

  setMasterCompBypassed(b: boolean): void {
    this._masterCompBypassed = b;
    this.applyMasterCompBypass();
    this.notifyPluginListeners();
  }

  setMasterLimiterBypassed(b: boolean): void {
    this._masterLimiterBypassed = b;
    this.applyMasterLimiterBypass();
    this.notifyPluginListeners();
  }

  setMasterReverbBypassed(b: boolean): void {
    this._masterReverbBypassed = b;
    this.applyMasterReverbBypass();
    this.notifyPluginListeners();
  }

  setMasterChainBypassed(b: boolean): void {
    this._masterChainBypassed = b;
    this.applyMasterEqBypass();
    this.applyMasterFilterBypass();
    this.applyMasterMBCBypass();
    this.applyMasterCompBypass();
    this.applyMasterLimiterBypass();
    this.applyMasterReverbBypass();
    this.notifyPluginListeners();
  }

  // ─── Master Plugin Parameter Setters ─────────────────────

  setMasterEqLow(v: number): void { this._eqLow = v; if (!this._masterEqBypassed && !this._masterChainBypassed) this.masterEQ.low.value = v; this._persistParams(); }
  setMasterEqMid(v: number): void { this._eqMid = v; if (!this._masterEqBypassed && !this._masterChainBypassed) this.masterEQ.mid.value = v; this._persistParams(); }
  setMasterEqHigh(v: number): void { this._eqHigh = v; if (!this._masterEqBypassed && !this._masterChainBypassed) this.masterEQ.high.value = v; this._persistParams(); }

  setMasterCompThreshold(v: number): void { this._compThreshold = v; if (!this._masterCompBypassed && !this._masterChainBypassed) this.masterComp.threshold.value = v; this._persistParams(); }
  setMasterCompRatio(v: number): void { this._compRatio = v; if (!this._masterCompBypassed && !this._masterChainBypassed) this.masterComp.ratio.value = v; this._persistParams(); }
  setMasterCompAttack(v: number): void { this._compAttack = v; if (!this._masterCompBypassed && !this._masterChainBypassed) this.masterComp.attack.value = v; this._persistParams(); }
  setMasterCompRelease(v: number): void { this._compRelease = v; if (!this._masterCompBypassed && !this._masterChainBypassed) this.masterComp.release.value = v; this._persistParams(); }
  setMasterCompKnee(v: number): void { this._compKnee = v; if (!this._masterCompBypassed && !this._masterChainBypassed) this.masterComp.knee.value = v; this._persistParams(); }

  setMasterLimiterThreshold(v: number): void { this._limiterThreshold = v; if (!this._masterLimiterBypassed && !this._masterChainBypassed) this.masterLimiter.threshold.value = v; this._persistParams(); }

  setMasterReverbDecay(v: number): void { this._reverbDecay = v; this.masterReverb.decay = v; this._persistParams(); }
  setMasterReverbWet(v: number): void { this._reverbWet = v; if (!this._masterReverbBypassed && !this._masterChainBypassed) this.masterReverb.wet.value = v; this._persistParams(); }

  // ─── Multiband Compressor Setters ─────────────────────────

  setMasterMBCBand(band: "low" | "mid" | "high", params: Partial<MultibandCompBandParams>): void {
    const b = this._mbcParams[band];
    if (params.threshold !== undefined) b.threshold = params.threshold;
    if (params.ratio !== undefined) b.ratio = params.ratio;
    if (params.attack !== undefined) b.attack = params.attack;
    if (params.release !== undefined) b.release = params.release;
    if (params.knee !== undefined) b.knee = params.knee;
    if (!this._masterMBCBypassed && !this._masterChainBypassed) {
      const node = this.masterMBC[band];
      if (params.threshold !== undefined) node.threshold.value = b.threshold;
      if (params.ratio !== undefined) node.ratio.value = b.ratio;
      if (params.attack !== undefined) node.attack.value = b.attack;
      if (params.release !== undefined) node.release.value = b.release;
      if (params.knee !== undefined) node.knee.value = b.knee;
    }
    this._persistParams();
  }

  setMasterMBCCrossover(lowFreq?: number, highFreq?: number): void {
    if (lowFreq !== undefined) this._mbcParams.lowFrequency = lowFreq;
    if (highFreq !== undefined) this._mbcParams.highFrequency = highFreq;
    if (!this._masterMBCBypassed && !this._masterChainBypassed) {
      if (lowFreq !== undefined) this.masterMBC.lowFrequency.value = lowFreq;
      if (highFreq !== undefined) this.masterMBC.highFrequency.value = highFreq;
    }
    this._persistParams();
  }

  getMasterMBCParams(): MultibandCompParams {
    return {
      low: { ...this._mbcParams.low },
      mid: { ...this._mbcParams.mid },
      high: { ...this._mbcParams.high },
      lowFrequency: this._mbcParams.lowFrequency,
      highFrequency: this._mbcParams.highFrequency,
    };
  }

  // ─── Master Filter Band Setters ─────────────────────────

  setMasterFilterBand(index: number, params: Partial<FilterBandParams>): void {
    if (index < 0 || index >= 5) return;
    const band = this._filterBands[index];
    if (params.frequency !== undefined) band.frequency = params.frequency;
    if (params.type !== undefined) band.type = params.type;
    if (params.Q !== undefined) band.Q = params.Q;
    if (params.gain !== undefined) band.gain = params.gain;
    if (params.rolloff !== undefined) band.rolloff = params.rolloff;
    if (!this._masterFilterBypassed && !this._masterChainBypassed) {
      const f = this.masterFilters[index];
      f.type = band.type;
      f.frequency.value = band.frequency;
      f.Q.value = band.Q;
      f.gain.value = band.gain;
      f.rolloff = band.rolloff;
    }
    this._persistParams();
  }

  getMasterFilterBands(): FilterBandParams[] {
    return this._filterBands.map(b => ({ ...b }));
  }

  getMasterPluginState() {
    return {
      eqBypassed: this._masterEqBypassed,
      filterBypassed: this._masterFilterBypassed,
      mbcBypassed: this._masterMBCBypassed,
      compBypassed: this._masterCompBypassed,
      limiterBypassed: this._masterLimiterBypassed,
      reverbBypassed: this._masterReverbBypassed,
      chainBypassed: this._masterChainBypassed,
    };
  }

  getMasterPluginParams() {
    return {
      eqLow: this._eqLow, eqMid: this._eqMid, eqHigh: this._eqHigh,
      filterBands: this._filterBands.map(b => ({ ...b })),
      mbcParams: this.getMasterMBCParams(),
      compThreshold: this._compThreshold, compRatio: this._compRatio,
      compAttack: this._compAttack, compRelease: this._compRelease, compKnee: this._compKnee,
      limiterThreshold: this._limiterThreshold,
      reverbDecay: this._reverbDecay, reverbWet: this._reverbWet,
    };
  }

  // ─── Bus volume ───────────────────────────────────────

  setVoiceBusVolume(v: number): void {
    this.voiceBus.volume.value = volumeToDB(v);
  }

  setAtmoBusVolume(v: number): void {
    this.atmoBus.volume.value = volumeToDB(v);
  }

  setSfxBusVolume(v: number): void {
    this.sfxBus.volume.value = volumeToDB(v);
  }

  // ─── Getters ───────────────────────────────────────────

  get state(): EngineState { return this._state; }
  get volume(): number { return this._volume; }
  get totalDuration(): number { return this.getEffectiveTotalDuration(); }
  get trackCount(): number { return this.tracks.size; }

  get positionSec(): number { return this.transport.seconds; }

  getSnapshot(): EngineSnapshot {
    return {
      state: this._state,
      positionSec: this.positionSec,
      totalDuration: this.getEffectiveTotalDuration(),
      volume: this._volume,
    };
  }

  // ─── Reactive state ────────────────────────────────────

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snap = this.getSnapshot();
    for (const fn of this.listeners) {
      try { fn(snap); } catch { /* listener error */ }
    }
  }

  /** Subscribe to master plugin state changes (bypass toggles). */
  subscribePluginState(listener: () => void): () => void {
    this.pluginListeners.add(listener);
    return () => this.pluginListeners.delete(listener);
  }

  private notifyPluginListeners(): void {
    for (const fn of this.pluginListeners) {
      try { fn(); } catch { /* listener error */ }
    }
  }

  /** Schedule auto-stop at end of timeline using Tone transport.scheduleOnce */
  private _endScheduleId: number | null = null;

  private scheduleEndStop(): void {
    this.clearEndStop();
    const endAt = this.getEffectiveTotalDuration();
    if (endAt <= 0) return;
    this._endScheduleId = this.transport.scheduleOnce(() => {
      if (this._state !== "playing") return;
      this.transport.pause();
      for (const t of this.tracks.values()) {
        try { t.player.stop(); } catch { /* not started */ }
      }
      this._state = "paused";
      this.stopPositionLoop();
      this.notify();
    }, endAt);
  }

  private clearEndStop(): void {
    if (this._endScheduleId !== null) {
      this.transport.clear(this._endScheduleId);
      this._endScheduleId = null;
    }
  }

  private startPositionLoop(): void {
    this.stopPositionLoop();
    this.scheduleEndStop();
    const tick = () => {
      if (this._state !== "playing") return;
      this.notify();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopPositionLoop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.clearEndStop();
  }

  // ─── Cleanup ───────────────────────────────────────────

  dispose(): void {
    this.stop();
    for (const t of this.tracks.values()) t.dispose();
    this.tracks.clear();
    this.voiceBus.dispose();
    this.atmoBus.dispose();
    this.sfxBus.dispose();
    this.masterFilters.forEach(f => f.dispose());
    this.masterEQ.dispose();
    this.masterMBC.dispose();
    this.masterComp.dispose();
    this.masterLimiter.dispose();
    this.masterReverb.dispose();
    this.masterSplitter.dispose();
    this.masterMeterL.dispose();
    this.masterMeterR.dispose();
    this.masterDCMeterL.dispose();
    this.masterDCMeterR.dispose();
    this.masterFFT.dispose();
    this.masterBus.dispose();
    this.listeners.clear();
    this.pluginListeners.clear();
    AudioEngine.instance = null;
  }
}

// ─── Export singleton accessor ───────────────────────────────

export function getAudioEngine(): AudioEngine {
  return AudioEngine.getInstance();
}

/** Destroy the current engine and create a fresh one. Returns the new instance. */
export function resetAudioEngine(): AudioEngine {
  const w = window as unknown as { __audioEngine?: AudioEngine };
  try {
    AudioEngine.getInstance().dispose();
  } catch { /* ignore */ }
  delete w.__audioEngine;
  const newEngine = AudioEngine.getInstance();
  window.dispatchEvent(new Event("audio-engine-reset"));
  return newEngine;
}

export default AudioEngine;
