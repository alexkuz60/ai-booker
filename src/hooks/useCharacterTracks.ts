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

/** Ensure a hex/hsl color has enough lightness to be visible on a dark timeline background.
 *  If lightness < 40%, boost it to 55%. */
function ensureTrackVisibility(color: string): string {
  // Handle hex colors (#rrggbb or #rgb)
  const hexMatch = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    let r: number, g: number, b: number;
    const hex = hexMatch[1];
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    // Relative luminance approximation
    const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
    if (lightness < 0.4) {
      // Convert to HSL and boost lightness
      const rn = r / 255, gn = g / 255, bn = b / 255;
      const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
      const d = max - min;
      let h = 0;
      if (d !== 0) {
        if (max === rn) h = ((gn - bn) / d + 6) % 6;
        else if (max === gn) h = (bn - rn) / d + 2;
        else h = (rn - gn) / d + 4;
        h *= 60;
      }
      const s = d === 0 ? 0 : d / (1 - Math.abs(max + min - 1));
      return `hsl(${Math.round(h)} ${Math.round(Math.min(s * 100, 80))}% 55%)`;
    }
  }
  // Handle hsl(h s% l%) — check if lightness is too low
  const hslMatch = color.match(/hsl\(\s*(\d+)\s+(\d+)%\s+(\d+)%\s*\)/);
  if (hslMatch) {
    const l = parseInt(hslMatch[3], 10);
    if (l < 40) {
      return `hsl(${hslMatch[1]} ${hslMatch[2]}% 55%)`;
    }
  }
  return color;
}

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
        console.warn(`[CharacterTracks] ⚠️ No character IDs derived for scene ${sid} (storyboard segs: ${storyboardSegments.length}, allChars: ${allChars.length})`);
        setCharTracks([]); setSpeakerToCharId(new Map());
        setCharDataReady(true);
        return;
      }

      const sceneChars = allChars.filter(c => charIdSet.has(c.id));
      if (sceneChars.length === 0) {
        console.warn(`[CharacterTracks] ⚠️ charIdSet has ${charIdSet.size} IDs but none found in allChars (${allChars.length} total)`);
        setCharTracks([]); setSpeakerToCharId(new Map());
        setCharDataReady(true);
        return;
      }

      setSpeakerToCharId(buildCharacterNameMap(sceneChars));

      setCharTracks(
        sceneChars.map((c, i) => ({
          id: `char-${c.id}`,
          label: c.name,
          color: c.color ? ensureTrackVisibility(c.color) : NARRATOR_COLORS[i % NARRATOR_COLORS.length],
          type: "narrator" as const,
        }))
      );
      setCharDataReady(true);
    })();
  }, [bookId, sceneId, clipsRefreshToken, storage]);

  return { charTracks, speakerToCharId, typeMappings, charDataReady, contextSceneIds };
}
