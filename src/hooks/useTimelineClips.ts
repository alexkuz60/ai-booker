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
 * Returns clips mapped to character track IDs.
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

      // Load all phrases for these segments
      const { data: phrases } = await supabase
        .from("segment_phrases")
        .select("id, segment_id, phrase_number, text")
        .in("segment_id", segIds)
        .order("phrase_number");

      if (cancelled) return;

      // Group phrases by segment
      const phrasesBySegment = new Map<string, RawPhrase[]>();
      for (const p of (phrases ?? [])) {
        const list = phrasesBySegment.get(p.segment_id) ?? [];
        list.push(p);
        phrasesBySegment.set(p.segment_id, list);
      }

      // Build clips: sequential timeline, accumulating time
      // Group segments by scene_id to handle chapter mode (multiple scenes in sequence)
      const sceneOrder = sceneIds;
      let globalOffset = 0;
      const result: TimelineClip[] = [];

      for (const sceneId of sceneOrder) {
        const sceneSegments = segments
          .filter(s => s.scene_id === sceneId)
          .sort((a, b) => a.segment_number - b.segment_number);

        let sceneOffset = globalOffset;

        for (const seg of sceneSegments) {
          const segPhrases = phrasesBySegment.get(seg.id) ?? [];
          const totalChars = segPhrases.reduce((sum, p) => sum + p.text.length, 0);
          const durationSec = Math.max(0.5, totalChars / CHARS_PER_SEC);

          // Determine track ID
          let trackId = "narrator-fallback";
          if (seg.speaker && characterMap.has(seg.speaker)) {
            trackId = `char-${characterMap.get(seg.speaker)}`;
          } else if (seg.segment_type === "narrator" || seg.segment_type === "first_person") {
            // Narrator segments without speaker: try to find a narrator character
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
