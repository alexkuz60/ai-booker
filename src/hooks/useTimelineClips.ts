import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const CHARS_PER_SEC = 14;

/** Default silence gap prepended before every scene's first clip (seconds) */
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

/** System character routing: segment_type → system character name (lowercase) */
const SYSTEM_TYPE_TO_CHAR: Record<string, string> = {
  narrator: "рассказчик",
  epigraph: "рассказчик",
  lyric: "рассказчик",
  footnote: "комментатор",
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
  /** If true, this clip loops to fill durationSec */
  loop?: boolean;
  /** Original single-iteration clip length in seconds */
  clipLenSec?: number;
  /** Crossfade between loop iterations (seconds) */
  loopCrossfadeSec?: number;
}

export interface SceneBoundary {
  startSec: number;
  silenceSec: number;
  sceneId: string;
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

/** Map: scene_id → Map<segment_type, character_id> */
export type TypeMappingsByScene = Map<string, Map<string, string>>;

/**
 * Load real clips for timeline from scene_segments + segment_phrases.
 * Uses actual durations from segment_audio when available, falls back to char-based estimate.
 * Supports inline narration overlays from segment metadata.
 * Now reads per-scene silence_sec from book_scenes.
 * Applies scene_type_mappings to route narrator/first_person clips to character tracks.
 */
export function useTimelineClips(
  sceneIds: string[],
  characterMap: Map<string, string>, // speaker name (lowercase) -> character ID
  refreshToken: number = 0,
  typeMappings?: TypeMappingsByScene,
) {
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [loading, setLoading] = useState(false);
  /** Scene boundaries with absolute start offset and silence duration */
  const [sceneBoundaries, setSceneBoundaries] = useState<SceneBoundary[]>([]);

  const typeMappingsKey = typeMappings ? [...typeMappings.entries()].map(([s, m]) => `${s}:${[...m.entries()].join("_")}`).join(";") : "";
  const key = sceneIds.join(",") + "|" + [...characterMap.entries()].map(([k, v]) => `${k}:${v}`).join(",") + "|" + refreshToken + "|" + typeMappingsKey;

  useEffect(() => {
    if (sceneIds.length === 0) {
      setClips([]);
      setSceneBoundaries([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      // Load segments, scenes, and atmosphere layers in parallel
      const [{ data: segments }, { data: sceneData }, { data: atmosphereLayers }] = await Promise.all([
        supabase
          .from("scene_segments")
          .select("id, segment_number, segment_type, speaker, scene_id, metadata")
          .in("scene_id", sceneIds)
          .order("scene_id")
          .order("segment_number"),
        supabase
          .from("book_scenes")
          .select("id, silence_sec")
          .in("id", sceneIds),
        supabase
          .from("scene_atmospheres")
          .select("id, scene_id, layer_type, audio_path, duration_ms, volume, fade_in_ms, fade_out_ms")
          .in("scene_id", sceneIds)
          .order("created_at"),
      ]);

      if (cancelled || !segments?.length) {
        if (!cancelled) { setClips([]); setSceneBoundaries([]); setLoading(false); }
        return;
      }

      // Build scene silence map
      const sceneSilenceMap = new Map<string, number>();
      if (sceneData) {
        for (const s of sceneData) {
          sceneSilenceMap.set(s.id, s.silence_sec ?? SCENE_SILENCE_SEC);
        }
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
      const boundaries: SceneBoundary[] = [];

      for (const sceneId of sceneOrder) {
        const sceneSegments = segments
          .filter(s => s.scene_id === sceneId)
          .sort((a, b) => a.segment_number - b.segment_number);

        // Get per-scene silence duration
        const silenceSec = sceneSilenceMap.get(sceneId) ?? SCENE_SILENCE_SEC;

        // Each scene starts with silenceSec silence
        const sceneStart = globalOffset;
        boundaries.push({ startSec: sceneStart, silenceSec, sceneId });
        let sceneOffset = sceneStart + silenceSec;

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

          // Determine track ID — routing priority:
          // 1. Dialogue: always use speaker name (never type mappings)
          // 2. Explicit scene_type_mappings (e.g. first_person → Таисия)
          // 3. System character auto-routing (footnote → Комментатор, narrator → Рассказчик)
          // 4. Speaker name lookup
          // 5. Fallback: narrator-fallback
          let trackId = "narrator-fallback";

          if (seg.segment_type === "dialogue") {
            // Dialogue always routes by speaker name, never by type mapping
            const speakerKey = seg.speaker?.toLowerCase();
            if (speakerKey && characterMap.has(speakerKey)) {
              trackId = `char-${characterMap.get(speakerKey)}`;
            }
          } else {
            const sceneTypeMappings = typeMappings?.get(sceneId);
            const mappedCharId = sceneTypeMappings?.get(seg.segment_type);

            if (mappedCharId) {
              trackId = `char-${mappedCharId}`;
            } else {
              // Auto-route system types to system characters
              const sysCharName = SYSTEM_TYPE_TO_CHAR[seg.segment_type];
              if (sysCharName && characterMap.has(sysCharName)) {
                trackId = `char-${characterMap.get(sysCharName)}`;
              } else {
                const speakerKey = seg.speaker?.toLowerCase();
                if (speakerKey && characterMap.has(speakerKey)) {
                  trackId = `char-${characterMap.get(speakerKey)}`;
                }
              }
            }
          }

          // Check for split silence (e.g. 1s gap before second part of a split block)
          const metadata = (seg.metadata ?? {}) as Record<string, unknown>;
          const splitSilenceMs = typeof metadata.split_silence_ms === "number" ? metadata.split_silence_ms : 0;
          if (splitSilenceMs > 0) {
            sceneOffset += splitSilenceMs / 1000;
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
          // Route to first_person character if mapped (voice consistency),
          // then to Рассказчик system character, then narrator-fallback
          const metadata = (seg.metadata ?? {}) as Record<string, unknown>;
          const inlineNarrAudio = (metadata.inline_narrations_audio ?? []) as InlineNarrationAudio[];

          let inlineTrackId = "narrator-fallback";
          const inlineMappings = typeMappings?.get(sceneId);
          // Priority: explicit inline_narration mapping > first_person mapping > system Рассказчик
          const inlineCharId = inlineMappings?.get("inline_narration");
          if (inlineCharId) {
            inlineTrackId = `char-${inlineCharId}`;
          } else {
            const fpCharId = inlineMappings?.get("first_person");
            if (fpCharId) {
              inlineTrackId = `char-${fpCharId}`;
            } else if (characterMap.has("рассказчик")) {
              inlineTrackId = `char-${characterMap.get("рассказчик")}`;
            }
          }

          for (let n = 0; n < inlineNarrAudio.length; n++) {
            const narr = inlineNarrAudio[n];
            if (!narr.audio_path || !narr.duration_ms) continue;

            const narrStartSec = sceneOffset + (narr.offset_ms / 1000);
            const narrDurationSec = narr.duration_ms / 1000;

            result.push({
              id: `${seg.id}_narrator_${n}`,
              trackId: inlineTrackId,
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

      // ── Atmosphere layer clips ──────────────────────────────
      // Add atmosphere/sfx/music clips from scene_atmospheres on dedicated tracks.
      // Ambience/music clips shorter than scene content are looped with crossfade.
      if (atmosphereLayers?.length) {
        // Compute scene content durations (from voice clips)
        const sceneContentDuration = new Map<string, number>();
        for (const clip of result) {
          const end = clip.startSec + clip.durationSec;
          const prev = sceneContentDuration.get(clip.sceneId) ?? 0;
          if (end > prev) sceneContentDuration.set(clip.sceneId, end);
        }

        for (const layer of atmosphereLayers as any[]) {
          const boundary = boundaries.find(b => b.sceneId === layer.scene_id);
          if (!boundary) continue;

          const trackId = layer.layer_type === "sfx" ? "atmosphere-sfx" : "atmosphere-bg";
          const startSec = boundary.startSec + boundary.silenceSec; // start after silence
          const clipLenSec = (layer.duration_ms || 0) / 1000 || 10;

          // Scene content end (absolute) → duration from clip start
          const sceneEndAbs = sceneContentDuration.get(layer.scene_id) ?? (startSec + clipLenSec);
          const sceneFillSec = Math.max(clipLenSec, sceneEndAbs - startSec);

          // Loop if clip is shorter than scene content (ambience/music only, not SFX)
          const shouldLoop = layer.layer_type !== "sfx" && clipLenSec < sceneFillSec;
          const crossfadeSec = shouldLoop ? Math.min(1, clipLenSec * 0.15) : 0;

          result.push({
            id: `atmo-${layer.id}`,
            trackId,
            speaker: null,
            startSec,
            durationSec: shouldLoop ? sceneFillSec : clipLenSec,
            label: (layer.layer_type === "music" ? "🎵 Music" : layer.layer_type === "sfx" ? "💥 SFX" : "🌧 Ambience")
              + (shouldLoop ? " ↻" : ""),
            segmentType: `atmosphere_${layer.layer_type}`,
            hasAudio: true,
            audioPath: layer.audio_path,
            sceneId: layer.scene_id,
            fadeInSec: (layer.fade_in_ms || 500) / 1000,
            fadeOutSec: (layer.fade_out_ms || 1000) / 1000,
            loop: shouldLoop,
            clipLenSec: shouldLoop ? clipLenSec : undefined,
            loopCrossfadeSec: crossfadeSec,
          });
        }
      }

      if (!cancelled) {
        setClips(result);
        setSceneBoundaries(boundaries);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [key]);

  // ── Auto-sync scene_playlists when clips change ──────────────
  // Ensures the montage scheme stays in sync with any timing change
  // (silence, synthesis speed, inline narrations, etc.)
  const prevSyncKeyRef = useRef<string>("");
  useEffect(() => {
    if (clips.length === 0 || loading) return;

    // Build a key from clip timing to avoid redundant writes
    const syncKey = clips.map(c => `${c.id}:${c.startSec}:${c.durationSec}`).join("|");
    if (syncKey === prevSyncKeyRef.current) return;
    prevSyncKeyRef.current = syncKey;

    // Group clips by scene and compute total duration per scene
    const sceneMap = new Map<string, { totalMs: number; segments: Array<Record<string, unknown>> }>();
    for (const clip of clips) {
      if (!clip.sceneId) continue;
      let entry = sceneMap.get(clip.sceneId);
      if (!entry) {
        entry = { totalMs: 0, segments: [] };
        sceneMap.set(clip.sceneId, entry);
      }
      const endMs = Math.round((clip.startSec + clip.durationSec) * 1000);
      if (endMs > entry.totalMs) entry.totalMs = endMs;
      if (clip.hasAudio) {
        entry.segments.push({
          segment_id: clip.id,
          speaker: clip.speaker,
          audio_path: clip.audioPath,
          duration_ms: Math.round(clip.durationSec * 1000),
          start_ms: Math.round(clip.startSec * 1000),
        });
      }
    }

    // Upsert each scene's playlist in parallel
    const updates = Array.from(sceneMap.entries()).map(([sceneId, data]) =>
      supabase.from("scene_playlists").upsert(
        {
          scene_id: sceneId,
          total_duration_ms: data.totalMs,
          segments: data.segments as unknown as import("@/integrations/supabase/types").Json,
          status: data.segments.length > 0 ? "ready" : "partial",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "scene_id" },
      ),
    );
    Promise.all(updates).catch(() => {/* silent — non-critical persistence */});
  }, [clips, loading]);

  return { clips, loading, sceneBoundaries };
}
