/**
 * EngineTrack — per-track signal chain for the audio engine.
 *
 * Signal chain: Player → [Telephone FX] → EQ3 → Comp → Channel → Limiter → Panner3D → Convolver → Reverb → Bus
 *               Channel → MeterMono; Reverb → Splitter → MeterL/R
 */

import * as Tone from "tone";
import {
  type TrackConfig,
  type TrackMeterData,
  type TrackMixState,
  type ChannelEqState,
  type ChannelCompState,
  type ChannelLimiterState,
  volumeToDB,
} from "@/lib/audioEngineTypes";

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
export { EngineTrack };
