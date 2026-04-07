import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import type { ProjectStorage } from "@/lib/projectStorage";
import {
  readAtmospheresFromLocal,
  updateAtmosphereClip,
  addAtmosphereClip,
  allClips,
  type LocalAtmosphereClip,
} from "@/lib/localAtmospheres";

export interface AtmoClipboard {
  sceneId: string;
  layerType: string;
  audioPath: string;
  durationMs: number;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  promptUsed: string;
  speed: number;
}

interface UseAtmoClipManipulationOpts {
  sceneId: string | null | undefined;
  isRu: boolean;
  zoom: number;
  positionSec: number;
  onRefresh: () => void;
  /** Scene boundaries to compute offset relative to scene start */
  getSceneStartSec: () => number;
  /** OPFS storage handle */
  storage: ProjectStorage | null | undefined;
}

export function useAtmoClipManipulation({
  sceneId,
  isRu,
  zoom,
  positionSec,
  onRefresh,
  getSceneStartSec,
  storage,
}: UseAtmoClipManipulationOpts) {
  const [clipboard, setClipboard] = useState<AtmoClipboard | null>(null);
  const clipboardRef = useRef(clipboard);
  clipboardRef.current = clipboard;

  // ── Copy ──────────────────────────────────────────────────
  const copyClip = useCallback(async (clipId: string) => {
    if (!storage || !sceneId) return;
    const atmoId = clipId.replace(/^atmo-/, "");
    const data = await readAtmospheresFromLocal(storage, sceneId);
    const clip = data ? allClips(data).find(c => c.id === atmoId) : undefined;
    if (!clip) return;
    setClipboard({
      sceneId,
      layerType: clip.layer_type,
      audioPath: clip.audio_path,
      durationMs: clip.duration_ms,
      volume: clip.volume,
      fadeInMs: clip.fade_in_ms,
      fadeOutMs: clip.fade_out_ms,
      promptUsed: clip.prompt_used,
      speed: clip.speed ?? 1,
    });
    toast.info(isRu ? "Клип скопирован" : "Clip copied");
  }, [isRu, sceneId, storage]);

  // ── Paste at transport position ───────────────────────────
  const pasteClip = useCallback(async () => {
    const cb = clipboardRef.current;
    if (!cb || !sceneId || !storage) {
      toast.warning(isRu ? "Нечего вставлять" : "Nothing to paste");
      return;
    }
    const sceneStart = getSceneStartSec();
    const offsetMs = Math.max(0, Math.round((positionSec - sceneStart) * 1000));

    const newClip: LocalAtmosphereClip = {
      id: crypto.randomUUID(),
      layer_type: cb.layerType,
      audio_path: cb.audioPath,
      duration_ms: cb.durationMs,
      volume: cb.volume,
      fade_in_ms: cb.fadeInMs,
      fade_out_ms: cb.fadeOutMs,
      prompt_used: cb.promptUsed,
      offset_ms: offsetMs,
      speed: cb.speed,
      created_at: new Date().toISOString(),
    };

    await addAtmosphereClip(storage, sceneId, newClip);
    toast.success(isRu ? "Клип вставлен" : "Clip pasted");
    onRefresh();
  }, [sceneId, isRu, positionSec, getSceneStartSec, onRefresh, storage]);

  // ── Move clip (update offset_ms) ──────────────────────────
  const moveClip = useCallback(async (clipId: string, newStartSec: number) => {
    if (!storage || !sceneId) return;
    const atmoId = clipId.replace(/^atmo-/, "");
    const sceneStart = getSceneStartSec();
    const offsetMs = Math.max(0, Math.round((newStartSec - sceneStart) * 1000));

    await updateAtmosphereClip(storage, sceneId, atmoId, { offset_ms: offsetMs });
    onRefresh();
  }, [sceneId, getSceneStartSec, onRefresh, storage]);

  // ── Resize clip (update speed) ──────────────────────────────
  const resizeClip = useCallback(async (clipId: string, newDurationSec: number, originalDurationMs: number, originalSpeed: number) => {
    if (!storage || !sceneId) return;
    const atmoId = clipId.replace(/^atmo-/, "");
    const rawDurationSec = originalDurationMs / 1000;
    const newSpeed = rawDurationSec / newDurationSec;
    const clampedSpeed = Math.max(0.5, Math.min(1.5, newSpeed));

    await updateAtmosphereClip(storage, sceneId, atmoId, { speed: clampedSpeed });
    toast.info(isRu ? `Скорость: ×${clampedSpeed.toFixed(2)}` : `Speed: ×${clampedSpeed.toFixed(2)}`);
    onRefresh();
  }, [sceneId, isRu, onRefresh, storage]);

  // ── Reset clip speed to 1× ────────────────────────────────
  const resetClipSpeed = useCallback(async (clipId: string) => {
    if (!storage || !sceneId) return;
    const atmoId = clipId.replace(/^atmo-/, "");
    await updateAtmosphereClip(storage, sceneId, atmoId, { speed: 1 });
    toast.info(isRu ? "Скорость сброшена: ×1.00" : "Speed reset: ×1.00");
    onRefresh();
  }, [sceneId, isRu, onRefresh, storage]);

  return { clipboard, copyClip, pasteClip, moveClip, resizeClip, resetClipSpeed };
}
