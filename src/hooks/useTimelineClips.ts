import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

const CHARS_PER_SEC = 14;

export interface TimelineClip {
  id: string;
  trackId: string; // "char-{characterId}" or "narrator"
  speaker: string | null;
  startSec: number;
  durationSec: number;
  label: string;
  segmentType: string;
  hasAudio: boolean;
  audioPath?: string;
}

interface RawSegment {
  id: string;
  segment_number: number;
  segment_type: string;
  speaker: string | null;
  scene_id: string;
}

interface RawPhrase {
  id: string;
  segment_id: string;
  phrase_number: number;
  text: string;
}

/**
 * Load real clips for timeline from scene_segments + segment_phrases.
 * Uses actual durations from segment_audio when available, falls back to char-based estimate.
 */
export function useTimelineClips(
  sceneIds: string[],
  characterMap: Map<string, string> // speaker name -> character ID
) {
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [loading, setLoading] = useState(false);

  const key = sceneIds.join(",") + "|" + [...characterMap.entries()].map(([k, v]) => `${k}:${v}`).join(",");

  useEffect(() => {
    if (sceneIds.length === 0) {
      setClips([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      // Load segments for these scenes
      const { data: segments } = await supabase
        .from("scene_segments")
        .select("id, segment_number, segment_type, speaker, scene_id")
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
        for (const a of audioData as any[]) {
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

      // Build clips: sequential timeline
      const sceneOrder = sceneIds;
      let globalOffset = 0;
      const result: TimelineClip[] = [];

      for (const sceneId of sceneOrder) {
        const sceneSegments = segments
          .filter(s => s.scene_id === sceneId)
          .sort((a, b) => a.segment_number - b.segment_number);

        let sceneOffset = globalOffset;

        for (const seg of sceneSegments) {
          const audioInfo = audioDurationMap.get(seg.id);
          let durationSec: number;

          if (audioInfo && audioInfo.durationMs > 0) {
            // Use real audio duration
            durationSec = audioInfo.durationMs / 1000;
          } else {
            // Fallback: estimate from text
            const segPhrases = phrasesBySegment.get(seg.id) ?? [];
            const totalChars = segPhrases.reduce((sum, p) => sum + p.text.length, 0);
            durationSec = Math.max(0.5, totalChars / CHARS_PER_SEC);
          }

          // Determine track ID
          let trackId = "narrator-fallback";
          if (seg.speaker && characterMap.has(seg.speaker)) {
            trackId = `char-${characterMap.get(seg.speaker)}`;
          } else if (seg.segment_type === "narrator" || seg.segment_type === "first_person") {
            trackId = "narrator-fallback";
          }

          result.push({
            id: seg.id,
            trackId,
            speaker: seg.speaker,
            startSec: sceneOffset,
            durationSec,
            label: seg.speaker || seg.segment_type,
            segmentType: seg.segment_type,
            hasAudio: !!audioInfo,
            audioPath: audioInfo?.audioPath,
          });

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
