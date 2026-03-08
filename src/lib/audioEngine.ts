/**
 * AudioEngine — singleton multi-track audio engine built on Tone.js.
 *
 * Architecture:
 *   Track (Tone.Player) → Channel (Tone.Channel: gain + pan) → MasterBus → Destination
 *
 * Transport is the single source of truth for playback position.
 * Tracks are scheduled at absolute times on the Transport timeline.
 */

import * as Tone from "tone";

// ─── Types ──────────────────────────────────────────────────

export interface TrackConfig {
  id: string;
  /** Signed URL or blob URL */
  url: string;
  /** Absolute start time on the timeline (seconds) */
  startSec: number;
  /** Duration hint — used for UI; actual duration comes from the buffer */
  durationSec: number;
  /** Is this an overlay (inline narration) that plays concurrently? */
  overlay?: boolean;
  /** Initial volume 0-100 */
  volume?: number;
  /** Pan -1 (left) to 1 (right) */
  pan?: number;
}

export type EngineState = "stopped" | "playing" | "paused";

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
  // attempt perceptual curve: v=100 → 0dB, v=50 → ~-14dB, v=0 → -∞
  return 20 * Math.log10(v / 100);
}

// ─── Track ──────────────────────────────────────────────────

class EngineTrack {
  readonly id: string;
  readonly startSec: number;
  readonly durationSec: number;
  readonly overlay: boolean;

  player: Tone.Player;
  channel: Tone.Channel;
  private scheduledId: number | null = null;

  constructor(config: TrackConfig, masterBus: Tone.Channel) {
    this.id = config.id;
    this.startSec = config.startSec;
    this.durationSec = config.durationSec;
    this.overlay = config.overlay ?? false;

    this.channel = new Tone.Channel({
      volume: volumeToDB(config.volume ?? 80),
      pan: config.pan ?? 0,
    }).connect(masterBus);

    this.player = new Tone.Player({
      url: config.url,
      onload: () => {
        // Update duration from actual buffer if available
        // (this.durationSec stays as hint for scheduling)
      },
    }).connect(this.channel);
  }

  /** Schedule this track on the Transport */
  schedule(): void {
    this.unschedule();
    this.scheduledId = Tone.getTransport().schedule((time) => {
      if (this.player.loaded) {
        this.player.start(time);
      }
    }, this.startSec);
  }

  unschedule(): void {
    if (this.scheduledId !== null) {
      Tone.getTransport().clear(this.scheduledId);
      this.scheduledId = null;
    }
    try {
      this.player.stop();
    } catch {
      // not started — ignore
    }
  }

  setVolume(v: number): void {
    this.channel.volume.value = volumeToDB(v);
  }

  setPan(p: number): void {
    this.channel.pan.value = Math.max(-1, Math.min(1, p));
  }

  get loaded(): boolean {
    return this.player.loaded;
  }

  dispose(): void {
    this.unschedule();
    this.player.dispose();
    this.channel.dispose();
  }
}

// ─── AudioEngine (Singleton) ────────────────────────────────

class AudioEngine {
  private static instance: AudioEngine | null = null;

  private masterBus: Tone.Channel;
  private tracks = new Map<string, EngineTrack>();
  private _totalDuration = 0;
  private _volume = 80;
  private _state: EngineState = "stopped";
  private listeners = new Set<StateListener>();
  private rafId = 0;
  private transport = Tone.getTransport();

  private constructor() {
    this.masterBus = new Tone.Channel({
      volume: volumeToDB(this._volume),
    }).toDestination();

    // Transport config
    this.transport.loop = false;
  }

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  // ─── Track management ──────────────────────────────────

  /**
   * Load a full set of tracks (replaces previous).
   * Returns a promise that resolves when all tracks are buffered.
   */
  async loadTracks(configs: TrackConfig[]): Promise<void> {
    // Dispose old
    this.stop();
    for (const t of this.tracks.values()) t.dispose();
    this.tracks.clear();

    if (configs.length === 0) {
      this._totalDuration = 0;
      this.notify();
      return;
    }

    // Create tracks
    for (const cfg of configs) {
      const track = new EngineTrack(cfg, this.masterBus);
      this.tracks.set(cfg.id, track);
    }

    // Compute total duration from config hints
    this._totalDuration = Math.max(
      ...configs.map((c) => c.startSec + c.durationSec)
    );

    // Wait for all players to load (with timeout)
    const loadPromises = Array.from(this.tracks.values()).map(
      (t) =>
        new Promise<void>((resolve) => {
          if (t.player.loaded) {
            resolve();
            return;
          }
          const checkLoaded = () => {
            if (t.player.loaded) resolve();
            else setTimeout(checkLoaded, 50);
          };
          checkLoaded();
          // Safety timeout: resolve after 30s even if not loaded
          setTimeout(resolve, 30_000);
        })
    );

    await Promise.all(loadPromises);

    // Schedule all tracks on the Transport
    for (const t of this.tracks.values()) {
      t.schedule();
    }

    this.transport.cancel(); // clear old schedule
    // Re-schedule after cancel
    for (const t of this.tracks.values()) {
      t.schedule();
    }

    this.notify();
  }

  /** Add a single track without replacing others */
  async addTrack(config: TrackConfig): Promise<void> {
    const track = new EngineTrack(config, this.masterBus);
    this.tracks.set(config.id, track);

    // Update total duration
    const end = config.startSec + config.durationSec;
    if (end > this._totalDuration) this._totalDuration = end;

    // Wait for load
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
      // Recompute duration
      this._totalDuration =
        this.tracks.size > 0
          ? Math.max(
              ...Array.from(this.tracks.values()).map(
                (t) => t.startSec + t.durationSec
              )
            )
          : 0;
      this.notify();
    }
  }

  // ─── Transport controls ────────────────────────────────

  async play(): Promise<void> {
    // Tone.js requires user gesture to start AudioContext
    await Tone.start();

    if (this._state === "playing") return;

    if (this._state === "stopped") {
      // Re-schedule all tracks from start
      this.transport.position = 0;
      for (const t of this.tracks.values()) {
        t.schedule();
      }
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
    // Stop all players
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

    // Stop transport and all players
    this.transport.stop();
    for (const t of this.tracks.values()) {
      try { t.player.stop(); } catch { /* not started */ }
    }

    // Move transport position
    this.transport.seconds = clamped;

    // Re-schedule tracks that haven't ended yet
    for (const t of this.tracks.values()) {
      t.unschedule();
      const trackEnd = t.startSec + t.durationSec;
      if (clamped < trackEnd) {
        if (clamped > t.startSec) {
          // Need to start mid-track
          const offset = clamped - t.startSec;
          t.unschedule();
          const schedId = this.transport.schedule((time) => {
            if (t.player.loaded) {
              t.player.start(time, offset);
            }
          }, clamped);
          // Store for cleanup (using internal ref)
          (t as any).scheduledId = schedId;
        } else {
          // Track starts in the future — normal schedule
          t.schedule();
        }
      }
      // else: track already ended at this position — skip
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

  // ─── Volume ────────────────────────────────────────────

  setMasterVolume(v: number): void {
    this._volume = Math.max(0, Math.min(100, v));
    this.masterBus.volume.value = volumeToDB(this._volume);
    try {
      localStorage.setItem("timeline-volume", String(this._volume));
    } catch { /* ignore */ }
    this.notify();
  }

  setTrackVolume(trackId: string, v: number): void {
    this.tracks.get(trackId)?.setVolume(v);
  }

  setTrackPan(trackId: string, p: number): void {
    this.tracks.get(trackId)?.setPan(p);
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
    // Immediately send current state
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

      // Check if playback reached the end
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
