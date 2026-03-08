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

  // Master metering (stereo split)
  private masterSplitter: Tone.Split;
  private masterMeterL: Tone.Meter;
  private masterMeterR: Tone.Meter;

  private tracks = new Map<string, EngineTrack>();
  private _totalDuration = 0;
  private _volume = 80;
  private _state: EngineState = "stopped";
  private listeners = new Set<StateListener>();
  private rafId = 0;
  private transport = Tone.getTransport();

  private constructor() {
    this.masterBus = new Tone.Channel({ volume: volumeToDB(this._volume) });
    this.masterSplitter = new Tone.Split();
    this.masterMeterL = new Tone.Meter({ smoothing: 0.8 });
    this.masterMeterR = new Tone.Meter({ smoothing: 0.8 });

    // Master chain: MasterBus → Splitter → MeterL/R, MasterBus → Destination
    this.masterBus.connect(this.masterSplitter);
    this.masterSplitter.connect(this.masterMeterL, 0);
    this.masterSplitter.connect(this.masterMeterR, 1);
    this.masterBus.toDestination();

    // Sub-buses → MasterBus
    this.voiceBus = new Tone.Channel({ volume: 0 }).connect(this.masterBus);
    this.atmoBus = new Tone.Channel({ volume: 0 }).connect(this.masterBus);
    this.sfxBus = new Tone.Channel({ volume: 0 }).connect(this.masterBus);

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
    }

    this.transport.start();
    this._state = "playing";
    this.startPositionLoop();
    this.notify();
  }

  pause(): void {
    if (this._state !== "playing") return;
    this.transport.pause();
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

    for (const t of this.tracks.values()) {
      t.unschedule();
      const trackEnd = t.startSec + t.durationSec;
      if (clamped < trackEnd) {
        if (clamped > t.startSec) {
          const offset = clamped - t.startSec;
          t.scheduleWithOffset(clamped, offset);
        } else {
          t.schedule();
        }
      }
    }

    if (wasPlaying) {
      this.transport.start();
      this._state = "playing";
      this.startPositionLoop();
    } else {
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
    const val = this.masterMeter.getValue();
    if (Array.isArray(val)) {
      return { levelL: val[0] ?? -Infinity, levelR: val[1] ?? -Infinity };
    }
    return { levelL: val, levelR: val };
  }

  getTrackMixState(trackId: string): TrackMixState | null {
    return this.tracks.get(trackId)?.getMixState() ?? null;
  }

  getAllTrackIds(): string[] {
    return Array.from(this.tracks.keys());
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
    this.masterMeter.dispose();
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
