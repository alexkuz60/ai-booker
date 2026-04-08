/**
 * useCharacterTracks — loads character tracks from OPFS storyboard data.
 * Extracted from StudioTimeline.tsx for modularity.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { TypeMappingsByScene } from "@/hooks/useTimelineClips";
import { buildCharacterNameMap, deriveStoryboardCharacterIds, deriveStoryboardTypeMappings } from "@/lib/storyboardCharacterRouting";
import type { TimelineTrackData } from "@/components/studio/StudioTimeline";

const NARRATOR_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(30 75% 60%)",
  "hsl(280 60% 62%)",
  "hsl(350 70% 62%)",
  "hsl(160 55% 55%)",
  "hsl(200 65% 58%)",
  "hsl(45 80% 58%)",
  "hsl(320 60% 58%)",
  "hsl(100 50% 55%)",
];

export function useCharacterTracks(
  bookId: string | null | undefined,
  sceneId: string | null | undefined,
  storage: ProjectStorage | null,
  clipsRefreshToken: number,
) {
  const [charTracks, setCharTracks] = useState<TimelineTrackData[]>([]);
  const [speakerToCharId, setSpeakerToCharId] = useState<Map<string, string>>(new Map());
  const [typeMappings, setTypeMappings] = useState<TypeMappingsByScene>(new Map());
  const [charDataReady, setCharDataReady] = useState(false);

  const contextSceneIds = useMemo(() => sceneId ? [sceneId] : [], [sceneId]);

  // Reset char data readiness when scene changes
  const prevSceneIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (sceneId !== prevSceneIdRef.current) {
      prevSceneIdRef.current = sceneId ?? null;
      setCharDataReady(false);
    }
  }, [sceneId]);

  useEffect(() => {
    if (!bookId || contextSceneIds.length === 0) {
      setCharTracks([]); setSpeakerToCharId(new Map()); setTypeMappings(new Map()); return;
    }

    console.info(`[CharacterTracks] Loading for bookId=${bookId}, sceneId=${contextSceneIds[0]}`);

    (async () => {
      if (!storage) return;

      const sid = contextSceneIds[0];

      const { readCharacterIndex } = await import("@/lib/localCharacters");
      const { readStoryboardFromLocal } = await import("@/lib/storyboardSync");
      const [allChars, storyboard] = await Promise.all([
        readCharacterIndex(storage),
        readStoryboardFromLocal(storage, sid),
      ]);

      const storyboardSegments = storyboard?.segments ?? [];
      const derivedMappings = deriveStoryboardTypeMappings(
        storyboardSegments,
        allChars,
        storyboard?.typeMappings ?? [],
        storyboard?.inlineNarrationSpeaker ?? null,
      );

      const tm: TypeMappingsByScene = new Map();
      if (derivedMappings.length > 0) {
        const sceneTypeMappings = new Map<string, string>();
        for (const m of derivedMappings) {
          sceneTypeMappings.set(m.segmentType, m.characterId);
        }
        tm.set(sid, sceneTypeMappings);
      }
      setTypeMappings(tm);

      const charIdSet = deriveStoryboardCharacterIds(storyboardSegments, allChars, derivedMappings);

      if (charIdSet.size === 0) {
        setCharTracks([]); setSpeakerToCharId(new Map());
        setCharDataReady(true);
        return;
      }

      const sceneChars = allChars.filter(c => charIdSet.has(c.id));
      if (sceneChars.length === 0) {
        setCharTracks([]); setSpeakerToCharId(new Map());
        setCharDataReady(true);
        return;
      }

      setSpeakerToCharId(buildCharacterNameMap(sceneChars));

      setCharTracks(
        sceneChars.map((c, i) => ({
          id: `char-${c.id}`,
          label: c.name,
          color: c.color || NARRATOR_COLORS[i % NARRATOR_COLORS.length],
          type: "narrator" as const,
        }))
      );
      setCharDataReady(true);
    })();
  }, [bookId, sceneId, clipsRefreshToken, storage]);

  return { charTracks, speakerToCharId, typeMappings, charDataReady, contextSceneIds };
}
