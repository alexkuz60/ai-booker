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

// ─── Types ──────────────────────────────────────────────────

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

export interface TrackMixState {
  volume: number;       // 0-100
  pan: number;          // -1..1
  reverbWet: number;    // 0-1
  reverbBypassed: boolean;
  preFxBypassed: boolean;
  muted: boolean;
  solo: boolean;
}

export interface EngineSnapshot {
  state: EngineState;
  positionSec: number;
  totalDuration: number;
  volume: number;
}

type StateListener = (snapshot: EngineSnapshot) => void;

// ─── Utility ────────────────────────────────────────────────

/** Convert 0-100 linear volume to dB (-Infinity…0) */
function volumeToDB(v: number): number {
  if (v <= 0) return -Infinity;
  return 20 * Math.log10(v / 100);
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

  // Pre-FX placeholder (compressor slot, bypassed by default)
  private preFxNode: Tone.Compressor;
  private _preFxBypassed = true;

  // Per-channel reverb
  private reverbNode: Tone.Reverb;
  private _reverbBypassed = true;
  private _reverbWet = 0.15;

  // Metering: mono (pre-pan) and stereo split (post-pan)
  private meterMono: Tone.Meter;
  private splitter: Tone.Split;
  private meterL: Tone.Meter;
  private meterR: Tone.Meter;

  private _muted = false;
  private _solo = false;
  private _volume = 80;
  private _pan = 0;

  private scheduledId: number | null = null;

  constructor(config: TrackConfig, bus: Tone.Channel) {
    this.id = config.id;
    this.startSec = config.startSec;
    this.durationSec = config.durationSec;
    this.overlay = config.overlay ?? false;
    this.busType = config.bus ?? "voice";
    this._volume = config.volume ?? 80;
    this._pan = config.pan ?? 0;

    // Pre-FX: light compressor, bypassed
    this.preFxNode = new Tone.Compressor({
      threshold: -24,
      ratio: 3,
      attack: 0.01,
      release: 0.1,
    });

    // Channel: volume + pan
    this.channel = new Tone.Channel({
      volume: volumeToDB(this._volume),
      pan: this._pan,
    });

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

    // Chain: Player → PreFX → Channel → Reverb → Splitter → MeterL/R
    //                              └→ MeterMono
    //        Reverb → Bus (main output)
    this.player = new Tone.Player({ url: config.url });

    // Wire signal chain
    this.player.connect(this.preFxNode);
    this.preFxNode.connect(this.channel);
    this.channel.connect(this.meterMono);
    this.channel.connect(this.reverbNode);
    this.reverbNode.connect(bus);
    // Stereo metering tap
    this.reverbNode.connect(this.splitter);
    this.splitter.connect(this.meterL, 0);
    this.splitter.connect(this.meterR, 1);

    // Apply bypass states
    this.applyPreFxBypass();
    this.applyReverbBypass();
  }

  // ── Scheduling ──

  schedule(): void {
    this.unschedule();
    this.scheduledId = Tone.getTransport().schedule((time) => {
      if (this.player.loaded) this.player.start(time);
    }, this.startSec);
  }

  scheduleWithOffset(transportTime: number, offset: number): void {
    this.unschedule();
    this.scheduledId = Tone.getTransport().schedule((time) => {
      if (this.player.loaded) this.player.start(time, offset);
    }, transportTime);
  }

  unschedule(): void {
    if (this.scheduledId !== null) {
      Tone.getTransport().clear(this.scheduledId);
      this.scheduledId = null;
    }
    try { this.player.stop(); } catch { /* not started */ }
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

  // ── Pre-FX ──

  setPreFxBypassed(b: boolean): void {
    this._preFxBypassed = b;
    this.applyPreFxBypass();
  }

  private applyPreFxBypass(): void {
    // Bypass by setting ratio to 1 (no compression)
    if (this._preFxBypassed) {
      this.preFxNode.ratio.value = 1;
    } else {
      this.preFxNode.ratio.value = 3;
    }
  }

  get preFxBypassed() { return this._preFxBypassed; }

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
    };
  }

  get loaded(): boolean { return this.player.loaded; }

  dispose(): void {
    this.unschedule();
    this.player.dispose();
    this.preFxNode.dispose();
    this.channel.dispose();
    this.reverbNode.dispose();
    this.meterMono.dispose();
    this.splitter.dispose();
    this.meterL.dispose();
    this.meterR.dispose();
  }
}

// ─── AudioEngine (Singleton) ────────────────────────────────

class AudioEngine {
  private static instance: AudioEngine | null = null;

  // Buses
  private voiceBus: Tone.Channel;
  private atmoBus: Tone.Channel;
  private sfxBus: Tone.Channel;
  private masterBus: Tone.Channel;

  // Master insert chain: EQ → Compressor → Limiter → Reverb (post)
  private masterEQ: Tone.EQ3;
  private masterComp: Tone.Compressor;
  private masterLimiter: Tone.Limiter;
  private masterReverb: Tone.Reverb;

  // Bypass states for master chain
  private _masterEqBypassed = true;
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
  private _totalDuration = 0;
  private _volume = 80;
  private _state: EngineState = "stopped";
  private listeners = new Set<StateListener>();
  private rafId = 0;
  private transport = Tone.getTransport();

  private constructor() {
    this.masterBus = new Tone.Channel({ volume: volumeToDB(this._volume) });

    // Master insert chain nodes
    this.masterEQ = new Tone.EQ3({ low: 0, mid: 0, high: 0 });
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

    // Chain: MasterBus → EQ → Comp → Limiter → Reverb → Splitter → Meters + Destination
    this.masterBus.connect(this.masterEQ);
    this.masterEQ.connect(this.masterComp);
    this.masterComp.connect(this.masterLimiter);
    this.masterLimiter.connect(this.masterReverb);
    this.masterReverb.connect(this.masterSplitter);
    this.masterSplitter.connect(this.masterMeterL, 0);
    this.masterSplitter.connect(this.masterMeterR, 1);
    this.masterSplitter.connect(this.masterDCMeterL, 0);
    this.masterSplitter.connect(this.masterDCMeterR, 1);
    // Connect FFT analyzer to master reverb output (before destination)
    this.masterReverb.connect(this.masterFFT);
    this.masterReverb.toDestination();

    // Sub-buses → MasterBus
    this.voiceBus = new Tone.Channel({ volume: 0 }).connect(this.masterBus);
    this.atmoBus = new Tone.Channel({ volume: 0 }).connect(this.masterBus);
    this.sfxBus = new Tone.Channel({ volume: 0 }).connect(this.masterBus);

    // Apply initial bypass states (all bypassed by default)
    this.applyMasterEqBypass();
    this.applyMasterCompBypass();
    this.applyMasterLimiterBypass();
    this.applyMasterReverbBypass();

    this.transport.loop = false;
  }

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
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

  // ─── Track management ──────────────────────────────────

  async loadTracks(configs: TrackConfig[]): Promise<void> {
    this.stop();
    for (const t of this.tracks.values()) t.dispose();
    this.tracks.clear();

    if (configs.length === 0) {
      this._totalDuration = 0;
      this.notify();
      return;
    }

    for (const cfg of configs) {
      const bus = this.getBus(cfg.bus ?? "voice");
      const track = new EngineTrack(cfg, bus);
      this.tracks.set(cfg.id, track);
    }

    this._totalDuration = Math.max(
      ...configs.map((c) => c.startSec + c.durationSec)
    );

    // Wait for all players to load
    const loadPromises = Array.from(this.tracks.values()).map(
      (t) =>
        new Promise<void>((resolve) => {
          if (t.player.loaded) { resolve(); return; }
          const check = () => {
            if (t.player.loaded) resolve();
            else setTimeout(check, 50);
          };
          check();
          setTimeout(resolve, 30_000);
        })
    );

    await Promise.all(loadPromises);

    this.transport.cancel();
    for (const t of this.tracks.values()) t.schedule();

    this.notify();
  }

  async addTrack(config: TrackConfig): Promise<void> {
    const bus = this.getBus(config.bus ?? "voice");
    const track = new EngineTrack(config, bus);
    this.tracks.set(config.id, track);

    const end = config.startSec + config.durationSec;
    if (end > this._totalDuration) this._totalDuration = end;

    await new Promise<void>((resolve) => {
      const check = () => {
        if (track.player.loaded) resolve();
        else setTimeout(check, 50);
      };
      check();
      setTimeout(resolve, 30_000);
    });

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
      // Start overlapping clips immediately with correct offset
      for (const { track, offset } of immediateStarts) {
        if (track.player.loaded) {
          track.player.start(Tone.now(), offset);
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
    const clamped = Math.max(0, Math.min(toSec, this._totalDuration));
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
      // Start overlapping clips immediately with correct offset
      for (const { track, offset } of immediateStarts) {
        if (track.player.loaded) {
          track.player.start(Tone.now(), offset);
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
    try { this.masterReverb.disconnect(this.masterFFT); } catch { /* may already be disconnected */ }
    this.masterFFT.dispose();
    this.masterFFT = new Tone.FFT(size);
    this.masterReverb.connect(this.masterFFT);
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

  private _loadSavedParams(): Record<string, number> {
    try {
      const raw = localStorage.getItem(AudioEngine._LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  private _persistParams(): void {
    try {
      localStorage.setItem(AudioEngine._LS_KEY, JSON.stringify({
        eqLow: this._eqLow, eqMid: this._eqMid, eqHigh: this._eqHigh,
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
  }

  setMasterCompBypassed(b: boolean): void {
    this._masterCompBypassed = b;
    this.applyMasterCompBypass();
  }

  setMasterLimiterBypassed(b: boolean): void {
    this._masterLimiterBypassed = b;
    this.applyMasterLimiterBypass();
  }

  setMasterReverbBypassed(b: boolean): void {
    this._masterReverbBypassed = b;
    this.applyMasterReverbBypass();
  }

  setMasterChainBypassed(b: boolean): void {
    this._masterChainBypassed = b;
    this.applyMasterEqBypass();
    this.applyMasterCompBypass();
    this.applyMasterLimiterBypass();
    this.applyMasterReverbBypass();
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

  getMasterPluginState() {
    return {
      eqBypassed: this._masterEqBypassed,
      compBypassed: this._masterCompBypassed,
      limiterBypassed: this._masterLimiterBypassed,
      reverbBypassed: this._masterReverbBypassed,
      chainBypassed: this._masterChainBypassed,
    };
  }

  getMasterPluginParams() {
    return {
      eqLow: this._eqLow, eqMid: this._eqMid, eqHigh: this._eqHigh,
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
  get totalDuration(): number { return this._totalDuration; }
  get trackCount(): number { return this.tracks.size; }

  get positionSec(): number {
    if (this._state === "stopped") return 0;
    return this.transport.seconds;
  }

  getSnapshot(): EngineSnapshot {
    return {
      state: this._state,
      positionSec: this.positionSec,
      totalDuration: this._totalDuration,
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

  private startPositionLoop(): void {
    this.stopPositionLoop();
    const tick = () => {
      if (this._state !== "playing") return;
      if (this.transport.seconds >= this._totalDuration) {
        this.stop();
        return;
      }
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
  }

  // ─── Cleanup ───────────────────────────────────────────

  dispose(): void {
    this.stop();
    for (const t of this.tracks.values()) t.dispose();
    this.tracks.clear();
    this.voiceBus.dispose();
    this.atmoBus.dispose();
    this.sfxBus.dispose();
    this.masterEQ.dispose();
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
    AudioEngine.instance = null;
  }
}

// ─── Export singleton accessor ───────────────────────────────

export function getAudioEngine(): AudioEngine {
  return AudioEngine.getInstance();
}

export default AudioEngine;
