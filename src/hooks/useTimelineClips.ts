import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { readStoryboardFromLocal } from "@/lib/storyboardSync";
import { readAtmospheresForScenes, type TaggedAtmosphereClip } from "@/lib/localAtmospheres";
import { readAudioMeta, readAudioMetaForScenes } from "@/lib/localAudioMeta";

const CHARS_PER_SEC = 14;

/** Default silence gap prepended before every scene's first clip (seconds) */
export const SCENE_SILENCE_SEC = 2;

const SEGMENT_TYPE_LABELS: Record<string, string> = {
  narrator: "Рассказчик",
  first_person: "От первого лица",
  dialogue: "Диалог",
  monologue: "Монолог",
  inner_thought: "Мысли",
  epigraph: "Эпиграф",
  lyric: "Стихи",
  footnote: "Комментатор",
  telephone: "📞 Телефон",
};

/** System character routing: segment_type → system character name (lowercase) */
const SYSTEM_TYPE_TO_CHAR: Record<string, string> = {
  narrator: "рассказчик",
  epigraph: "рассказчик",
  lyric: "рассказчик",
  footnote: "комментатор",
};

export interface PhraseClipInfo {
  index: number;
  durationMs: number;
  audioPath: string;
}

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
  /** Playback speed multiplier (1.0 = normal) */
  speed?: number;
  /** Original duration_ms from DB (for resize calculations) */
  originalDurationMs?: number;
  /** Per-phrase sub-clips for merged segments — each phrase is a separate audio file */
  phraseClips?: PhraseClipInfo[];
}

export interface SceneBoundary {
  startSec: number;
  silenceSec: number;
  sceneId: string;
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
 * Load real clips for timeline from local storyboard in OPFS.
 * Uses actual durations from audio_meta.json when available, falls back to char-based estimate.
 * Now reads per-scene silence_sec from book_scenes.
 * Applies scene_type_mappings to route narrator/first_person clips to character tracks.
 */
export function useTimelineClips(
  sceneIds: string[],
  characterMap: Map<string, string>, // speaker name (lowercase) -> character ID
  refreshToken: number = 0,
  typeMappings?: TypeMappingsByScene,
) {
  const { storage } = useProjectStorageContext();
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [loading, setLoading] = useState(false);
  /** Scene boundaries with absolute start offset and silence duration */
  const [sceneBoundaries, setSceneBoundaries] = useState<SceneBoundary[]>([]);

  const typeMappingsKey = typeMappings ? [...typeMappings.entries()].map(([s, m]) => `${s}:${[...m.entries()].join("_")}`).join(";") : "";
  const key = sceneIds.join(",") + "|" + [...characterMap.entries()].map(([k, v]) => `${k}:${v}`).join(",") + "|" + refreshToken + "|" + typeMappingsKey;

  useEffect(() => {
    if (sceneIds.length === 0 || !storage) {
      setClips([]);
      setSceneBoundaries([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      // Local storyboard is the only source of truth for runtime text/segmentation data.
      // Atmosphere clips also come from OPFS (Local-Only K3).
      // Audio metadata (including persisted startSec) also comes from OPFS.
      const [localStoryboards, localAtmoClips, audioMetaMap] = await Promise.all([
        Promise.all(
          sceneIds.map(async (sceneId) => ({
            sceneId,
            data: await readStoryboardFromLocal(storage, sceneId),
          })),
        ),
        readAtmospheresForScenes(storage, sceneIds),
        readAudioMetaForScenes(storage, sceneIds),
      ]);

      // ── Diagnostic: trace storyboard + audio meta loading results ──
      for (const { sceneId, data } of localStoryboards) {
        if (!data) {
          console.warn(`[TimelineClips] ⚠️ No storyboard data for scene ${sceneId}`);
        } else {
          console.info(`[TimelineClips] ✅ Storyboard loaded for scene ${sceneId}: ${data.segments?.length ?? 0} segments`);
        }
      }
      console.info(`[TimelineClips] AudioMeta entries: ${audioMetaMap.size}, AtmoClips: ${localAtmoClips.length}`);

      // Read per-scene silenceSec from audio_meta.json (persisted during recalcPositions)
      const sceneSilenceMap = new Map<string, number>();
      const sceneMetaReads = sceneIds.map(async (sceneId) => {
        const meta = await readAudioMeta(storage, sceneId);
        if (meta?.silenceSec != null) {
          sceneSilenceMap.set(sceneId, meta.silenceSec);
        }
      });
      await Promise.all(sceneMetaReads);

      const segments = localStoryboards.flatMap(({ sceneId, data }) =>
        (data?.segments ?? []).map((segment) => ({
          id: segment.segment_id,
          segment_number: segment.segment_number,
          segment_type: segment.segment_type,
          speaker: segment.speaker,
          scene_id: sceneId,
          split_silence_ms: segment.split_silence_ms,
          inline_narrations: segment.inline_narrations,
          phrases: [...segment.phrases].sort((a, b) => a.phrase_number - b.phrase_number),
        })),
      );

      if (cancelled || segments.length === 0) {
        if (!cancelled) {
          console.warn(`[TimelineClips] ⚠️ No segments found for scenes [${sceneIds.join(", ")}] — timeline will be empty`);
          setClips([]); setSceneBoundaries([]); setLoading(false);
        }
        return;
      }

      if (cancelled) return;

      // Build audio map from OPFS (includes persisted startSec, durationMs)
      const audioDurationMap = new Map<string, { durationMs: number; audioPath: string; isReady: boolean; startSec?: number }>();
      for (const [segId, entry] of audioMetaMap) {
        audioDurationMap.set(segId, {
          durationMs: entry.durationMs,
          audioPath: entry.audioPath,
          isReady: entry.status === "ready",
          startSec: entry.startSec,
        });
      }

      // Build clips: use persisted startSec when available, fallback to sequential calc
      const sceneOrder = sceneIds;
      let globalOffset = 0;
      const result: TimelineClip[] = [];
      const boundaries: SceneBoundary[] = [];

      for (const sceneId of sceneOrder) {
        const sceneSegments = segments
          .filter(s => s.scene_id === sceneId)
          .sort((a, b) => a.segment_number - b.segment_number);

        const silenceSec = sceneSilenceMap.get(sceneId) ?? SCENE_SILENCE_SEC;

        const sceneStart = globalOffset;
        boundaries.push({ startSec: sceneStart, silenceSec, sceneId });

        // Fallback sequential offset when startSec not yet persisted
        let fallbackOffset = sceneStart + silenceSec;

        for (const seg of sceneSegments) {
          const audioInfo = audioDurationMap.get(seg.id);
          let durationSec: number;

          if (audioInfo && audioInfo.durationMs > 0) {
            durationSec = audioInfo.durationMs / 1000;
          } else {
            const segPhrases = seg.phrases ?? [];
            const totalChars = segPhrases.reduce((sum, p) => sum + p.text.length, 0);
            durationSec = Math.max(0.5, totalChars / CHARS_PER_SEC);
          }

          // Use persisted startSec (scene-local) + sceneStart, or sequential fallback
          let clipStartSec: number;
          if (audioInfo?.startSec != null) {
            clipStartSec = sceneStart + audioInfo.startSec;
          } else {
            // Legacy fallback: account for split_silence_ms
            const splitSilenceMs = typeof seg.split_silence_ms === "number" ? seg.split_silence_ms : 0;
            if (splitSilenceMs > 0) fallbackOffset += splitSilenceMs / 1000;
            clipStartSec = fallbackOffset;
          }

          // Determine track ID — routing priority:
          // 1. Dialogue: always use speaker name (never type mappings)
          // 2. Explicit scene_type_mappings (e.g. first_person → Таисия)
          // 3. System character auto-routing (footnote → Комментатор, narrator → Рассказчик)
          // 4. Speaker name lookup
          // 5. Fallback: narrator-fallback
          let trackId = "narrator-fallback";

          if (seg.segment_type === "dialogue" || seg.segment_type === "monologue" || seg.segment_type === "telephone") {
            const speakerKey = seg.speaker?.toLowerCase();
            if (speakerKey && characterMap.has(speakerKey)) {
              trackId = `char-${characterMap.get(speakerKey)}`;
            }
          } else {
            const sysCharName = SYSTEM_TYPE_TO_CHAR[seg.segment_type];
            if (sysCharName && characterMap.has(sysCharName)) {
              trackId = `char-${characterMap.get(sysCharName)}`;
            } else {
              const sceneTypeMappings = typeMappings?.get(sceneId);
              const mappedCharId = sceneTypeMappings?.get(seg.segment_type);

              if (mappedCharId) {
                trackId = `char-${mappedCharId}`;
              } else {
                const speakerKey = seg.speaker?.toLowerCase();
                if (speakerKey && characterMap.has(speakerKey)) {
                  trackId = `char-${characterMap.get(speakerKey)}`;
                }
              }
            }
          }

          result.push({
            id: seg.id,
            trackId,
            speaker: seg.speaker,
            startSec: clipStartSec,
            durationSec,
            label: (SYSTEM_TYPE_TO_CHAR[seg.segment_type] ? SEGMENT_TYPE_LABELS[seg.segment_type] : seg.speaker) || SEGMENT_TYPE_LABELS[seg.segment_type] || seg.segment_type,
            segmentType: seg.segment_type,
            hasAudio: !!audioInfo?.isReady,
            audioPath: audioInfo?.isReady ? audioInfo.audioPath : undefined,
            sceneId,
          });

          // ── Inline narration overlay clips ──────────────────
          const inlineNarrAudio: InlineNarrationAudio[] = [];

          let inlineTrackId = "narrator-fallback";
          const inlineMappings = typeMappings?.get(sceneId);
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

            const narrStartSec = clipStartSec + (narr.offset_ms / 1000);
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

          // Advance fallback offset for next segment
          fallbackOffset = clipStartSec + durationSec;
        }

        // Advance globalOffset: find max end of clips in this scene
        const sceneClipEnds = result
          .filter(c => c.sceneId === sceneId)
          .map(c => c.startSec + c.durationSec);
        globalOffset = sceneClipEnds.length > 0
          ? Math.max(...sceneClipEnds)
          : sceneStart + silenceSec;
      }

      // ── Atmosphere layer clips ──────────────────────────────
      // Add atmosphere/sfx/music clips from OPFS (Local-Only K3).
      // Ambience/music clips shorter than scene content are looped with crossfade.
      if (localAtmoClips.length > 0) {
        // Compute scene content durations (from voice clips)
        const sceneContentDuration = new Map<string, number>();
        for (const clip of result) {
          const end = clip.startSec + clip.durationSec;
          const prev = sceneContentDuration.get(clip.sceneId) ?? 0;
          if (end > prev) sceneContentDuration.set(clip.sceneId, end);
        }

        for (const layer of localAtmoClips) {
          const boundary = boundaries.find(b => b.sceneId === layer.scene_id);
          if (!boundary) continue;

          const trackId = layer.layer_type === "sfx" ? "atmosphere-sfx" : "atmosphere-bg";
          const sceneAudioStart = boundary.startSec + boundary.silenceSec;
          const offsetSec = (layer.offset_ms || 0) / 1000;
          const startSec = sceneAudioStart + offsetSec;
          const speed = layer.speed ?? 1;
          const rawClipLenSec = (layer.duration_ms || 0) / 1000 || 10;
          const clipLenSec = rawClipLenSec / speed;

          // Scene content end (absolute) → duration from clip start
          const sceneEndAbs = sceneContentDuration.get(layer.scene_id) ?? (startSec + clipLenSec);
          const sceneFillSec = Math.max(clipLenSec, sceneEndAbs - startSec);

          // No auto-loop: user controls speed & position manually; looping only at render time
          const shouldLoop = false;
          const crossfadeSec = 0;

          result.push({
            id: `atmo-${layer.id}`,
            trackId,
            speaker: null,
            startSec,
            durationSec: shouldLoop ? sceneFillSec : clipLenSec,
            label: (layer.layer_type === "music" ? "🎵 Music" : layer.layer_type === "sfx" ? "💥 SFX" : "🌧 Ambience")
              + (shouldLoop ? " ↻" : "")
              + (speed !== 1 ? ` ×${speed.toFixed(2)}` : ""),
            segmentType: `atmosphere_${layer.layer_type}`,
            hasAudio: true,
            audioPath: layer.audio_path,
            sceneId: layer.scene_id,
            fadeInSec: (layer.fade_in_ms || 500) / 1000,
            fadeOutSec: (layer.fade_out_ms || 1000) / 1000,
            loop: shouldLoop,
            clipLenSec: shouldLoop ? clipLenSec : undefined,
            loopCrossfadeSec: crossfadeSec,
            speed,
            originalDurationMs: layer.duration_ms,
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
  }, [key, storage]);

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
