import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
}

export function useAtmoClipManipulation({
  sceneId,
  isRu,
  zoom,
  positionSec,
  onRefresh,
  getSceneStartSec,
}: UseAtmoClipManipulationOpts) {
  const [clipboard, setClipboard] = useState<AtmoClipboard | null>(null);
  const clipboardRef = useRef(clipboard);
  clipboardRef.current = clipboard;

  // ── Copy ──────────────────────────────────────────────────
  const copyClip = useCallback(async (clipId: string) => {
    const atmoId = clipId.replace(/^atmo-/, "");
    const { data, error } = await supabase
      .from("scene_atmospheres")
      .select("scene_id, layer_type, audio_path, duration_ms, volume, fade_in_ms, fade_out_ms, prompt_used, speed")
      .eq("id", atmoId)
      .maybeSingle();
    if (error || !data) return;
    setClipboard({
      sceneId: data.scene_id,
      layerType: data.layer_type,
      audioPath: data.audio_path,
      durationMs: data.duration_ms,
      volume: data.volume,
      fadeInMs: data.fade_in_ms,
      fadeOutMs: data.fade_out_ms,
      promptUsed: data.prompt_used,
      speed: data.speed ?? 1,
    });
    toast.info(isRu ? "Клип скопирован" : "Clip copied");
  }, [isRu]);

  // ── Paste at transport position ───────────────────────────
  const pasteClip = useCallback(async () => {
    const cb = clipboardRef.current;
    if (!cb || !sceneId) {
      toast.warning(isRu ? "Нечего вставлять" : "Nothing to paste");
      return;
    }
    const sceneStart = getSceneStartSec();
    const offsetMs = Math.max(0, Math.round((positionSec - sceneStart) * 1000));

    const { error } = await supabase.from("scene_atmospheres").insert({
      scene_id: sceneId,
      layer_type: cb.layerType,
      audio_path: cb.audioPath,
      duration_ms: cb.durationMs,
      volume: cb.volume,
      fade_in_ms: cb.fadeInMs,
      fade_out_ms: cb.fadeOutMs,
      prompt_used: cb.promptUsed,
      offset_ms: offsetMs,
      speed: cb.speed,
    });
    if (error) {
      toast.error(isRu ? "Ошибка вставки" : "Paste error", { description: error.message });
      return;
    }
    toast.success(isRu ? "Клип вставлен" : "Clip pasted");
    onRefresh();
  }, [sceneId, isRu, positionSec, getSceneStartSec, onRefresh]);

  // ── Move clip (update offset_ms) ──────────────────────────
  const moveClip = useCallback(async (clipId: string, newStartSec: number) => {
    const atmoId = clipId.replace(/^atmo-/, "");
    const sceneStart = getSceneStartSec();
    const offsetMs = Math.max(0, Math.round((newStartSec - sceneStart) * 1000));

    const { error } = await supabase
      .from("scene_atmospheres")
      .update({ offset_ms: offsetMs })
      .eq("id", atmoId);
    if (error) {
      toast.error(isRu ? "Ошибка перемещения" : "Move error", { description: error.message });
      return;
    }
    onRefresh();
  }, [isRu, getSceneStartSec, onRefresh]);

  // ── Resize clip (update speed) ──────────────────────────────
  // originalDurationMs = raw file duration, originalSpeed = current speed
  // newDurationSec = desired visual duration after resize
  const resizeClip = useCallback(async (clipId: string, newDurationSec: number, originalDurationMs: number, originalSpeed: number) => {
    const atmoId = clipId.replace(/^atmo-/, "");
    // Original visual duration = rawDuration / currentSpeed
    const rawDurationSec = originalDurationMs / 1000;
    // New speed = rawDuration / newVisualDuration
    const newSpeed = rawDurationSec / newDurationSec;
    // Clamp speed to 0.5–1.5 range (±50%)
    const clampedSpeed = Math.max(0.5, Math.min(1.5, newSpeed));

    const { error } = await supabase
      .from("scene_atmospheres")
      .update({ speed: clampedSpeed })
      .eq("id", atmoId);
    if (error) {
      toast.error(isRu ? "Ошибка изменения" : "Resize error", { description: error.message });
      return;
    }
    toast.info(isRu ? `Скорость: ×${clampedSpeed.toFixed(2)}` : `Speed: ×${clampedSpeed.toFixed(2)}`);
    onRefresh();
  }, [isRu, onRefresh]);

  return { clipboard, copyClip, pasteClip, moveClip, resizeClip };
}
