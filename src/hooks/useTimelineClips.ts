import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const CHARS_PER_SEC = 14;

/** Silence gap prepended before every scene's first clip (seconds) */
export const SCENE_SILENCE_SEC = 2;

const SEGMENT_TYPE_LABELS: Record<string, string> = {
  narrator: "Рассказчик",
  first_person: "От первого лица",
  dialogue: "Диалог",
  inner_thought: "Мысли",
  epigraph: "Эпиграф",
  lyric: "Стихи",
  footnote: "Комментатор",
};

export interface TimelineClip {
  id: string;
  trackId: string; // "char-{characterId}" or "narrator-fallback"
  speaker: string | null;
  startSec: number;
  durationSec: number;
  label: string;
  segmentType: string;
  hasAudio: boolean;
  audioPath?: string;
  sceneId: string;
  fadeInSec?: number;
  fadeOutSec?: number;
}

interface RawPhrase {
  id: string;
  segment_id: string;
  phrase_number: number;
  text: string;
}

interface InlineNarrationAudio {
  text: string;
  insert_after: string;
  audio_path: string;
  duration_ms: number;
  offset_ms: number;
}

/**
 * Load real clips for timeline from scene_segments + segment_phrases.
 * Uses actual durations from segment_audio when available, falls back to char-based estimate.
 * Supports inline narration overlays from segment metadata.
 */
export function useTimelineClips(
  sceneIds: string[],
  characterMap: Map<string, string>, // speaker name (lowercase) -> character ID
  refreshToken: number = 0,
) {
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [loading, setLoading] = useState(false);
  /** Absolute second offset where each scene's silence gap begins */
  const [sceneBoundaries, setSceneBoundaries] = useState<number[]>([]);

  const key = sceneIds.join(",") + "|" + [...characterMap.entries()].map(([k, v]) => `${k}:${v}`).join(",") + "|" + refreshToken;

  useEffect(() => {
    if (sceneIds.length === 0) {
      setClips([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      // Load segments for these scenes (including metadata for inline narrations)
      const { data: segments } = await supabase
        .from("scene_segments")
        .select("id, segment_number, segment_type, speaker, scene_id, metadata")
        .in("scene_id", sceneIds)
        .order("scene_id")
        .order("segment_number");

      if (cancelled || !segments?.length) {
        if (!cancelled) { setClips([]); setLoading(false); }
        return;
      }

      const segIds = segments.map(s => s.id);

      // Load phrases and audio metadata in parallel
      const [{ data: phrases }, { data: audioData }] = await Promise.all([
        supabase
          .from("segment_phrases")
          .select("id, segment_id, phrase_number, text")
          .in("segment_id", segIds)
          .order("phrase_number"),
        supabase
          .from("segment_audio")
          .select("segment_id, duration_ms, audio_path, status")
          .in("segment_id", segIds)
          .eq("status", "ready"),
      ]);

      if (cancelled) return;

      // Build audio duration map
      const audioDurationMap = new Map<string, { durationMs: number; audioPath: string }>();
      if (audioData) {
        for (const a of audioData) {
          audioDurationMap.set(a.segment_id, {
            durationMs: a.duration_ms,
            audioPath: a.audio_path,
          });
        }
      }

      // Group phrases by segment
      const phrasesBySegment = new Map<string, RawPhrase[]>();
      for (const p of (phrases ?? [])) {
        const list = phrasesBySegment.get(p.segment_id) ?? [];
        list.push(p);
        phrasesBySegment.set(p.segment_id, list);
      }

      // Build clips: sequential timeline with per-scene silence gap
      const sceneOrder = sceneIds;
      let globalOffset = 0;
      const result: TimelineClip[] = [];
      const boundaries: number[] = [];

      for (const sceneId of sceneOrder) {
        const sceneSegments = segments
          .filter(s => s.scene_id === sceneId)
          .sort((a, b) => a.segment_number - b.segment_number);

        // Each scene starts with SCENE_SILENCE_SEC silence
        const sceneStart = globalOffset;
        boundaries.push(sceneStart);
        let sceneOffset = sceneStart + SCENE_SILENCE_SEC;

        for (const seg of sceneSegments) {
          const audioInfo = audioDurationMap.get(seg.id);
          let durationSec: number;

          if (audioInfo && audioInfo.durationMs > 0) {
            durationSec = audioInfo.durationMs / 1000;
          } else {
            const segPhrases = phrasesBySegment.get(seg.id) ?? [];
            const totalChars = segPhrases.reduce((sum, p) => sum + p.text.length, 0);
            durationSec = Math.max(0.5, totalChars / CHARS_PER_SEC);
          }

          // Determine track ID
          let trackId = "narrator-fallback";
          const speakerKey = seg.speaker?.toLowerCase();
          if (speakerKey && characterMap.has(speakerKey)) {
            trackId = `char-${characterMap.get(speakerKey)}`;
          } else if (seg.segment_type === "narrator" || seg.segment_type === "first_person") {
            trackId = "narrator-fallback";
          }

          result.push({
            id: seg.id,
            trackId,
            speaker: seg.speaker,
            startSec: sceneOffset,
            durationSec,
            label: seg.speaker || SEGMENT_TYPE_LABELS[seg.segment_type] || seg.segment_type,
            segmentType: seg.segment_type,
            hasAudio: !!audioInfo,
            audioPath: audioInfo?.audioPath,
            sceneId,
          });

          // ── Inline narration overlay clips ──────────────────
          const metadata = (seg.metadata ?? {}) as Record<string, unknown>;
          const inlineNarrAudio = (metadata.inline_narrations_audio ?? []) as InlineNarrationAudio[];

          for (let n = 0; n < inlineNarrAudio.length; n++) {
            const narr = inlineNarrAudio[n];
            if (!narr.audio_path || !narr.duration_ms) continue;

            const narrStartSec = sceneOffset + (narr.offset_ms / 1000);
            const narrDurationSec = narr.duration_ms / 1000;

            result.push({
              id: `${seg.id}_narrator_${n}`,
              trackId: "narrator-fallback",
              speaker: null,
              startSec: narrStartSec,
              durationSec: narrDurationSec,
              label: narr.text.slice(0, 30),
              segmentType: "narrator",
              hasAudio: true,
              audioPath: narr.audio_path,
              sceneId,
            });
          }

          sceneOffset += durationSec;
        }

        globalOffset = sceneOffset;
      }

      if (!cancelled) {
        setClips(result);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [key]);

  return { clips, loading };
}
