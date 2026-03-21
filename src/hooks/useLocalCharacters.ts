/**
 * Central hook for local-first character management in Studio.
 * Reads characters/index.json + scene maps, replacing all DB reads.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { CharacterIndex, SceneCharacterMap, CharacterVoiceConfig } from "@/pages/parser/types";
import {
  readCharacterIndex,
  saveCharacterIndex,
  readSceneCharacterMap,
  saveSceneCharacterMap,
  getSceneCharacterIds,
  getChapterCharacterIds,
  countSegmentAppearances,
  buildNameLookup,
  findCharacterByNameOrAlias,
} from "@/lib/localCharacters";

export interface UseLocalCharactersReturn {
  characters: CharacterIndex[];
  loading: boolean;
  /** Reload from OPFS */
  reload: () => Promise<void>;
  /** Update a single character field and persist */
  updateCharacter: (id: string, partial: Partial<CharacterIndex>) => Promise<void>;
  /** Merge multiple characters into primary (first in array) */
  mergeCharacters: (ids: string[]) => Promise<void>;
  /** Get characters appearing in a specific scene */
  sceneCharIds: Set<string>;
  /** Get characters appearing in the chapter */
  chapterCharIds: Set<string>;
  /** Segment counts per character (for extras detection) */
  segmentCounts: Map<string, number>;
  /** Fast lookup: name/alias (lowercase) → character ID */
  nameLookup: Map<string, string>;
  /** Find character by name or alias */
  findByName: (name: string) => CharacterIndex | undefined;
  /** Get character by ID */
  getById: (id: string) => CharacterIndex | undefined;
  /** Scene character map for current scene */
  sceneCharMap: SceneCharacterMap | null;
}

export function useLocalCharacters(
  storage: ProjectStorage | null,
  bookId: string | null,
  sceneId?: string | null,
  chapterSceneIds?: string[],
): UseLocalCharactersReturn {
  const [characters, setCharacters] = useState<CharacterIndex[]>([]);
  const [loading, setLoading] = useState(false);
  const [sceneCharIds, setSceneCharIds] = useState<Set<string>>(new Set());
  const [chapterCharIds, setChapterCharIds] = useState<Set<string>>(new Set());
  const [segmentCounts, setSegmentCounts] = useState<Map<string, number>>(new Map());
  const [sceneCharMap, setSceneCharMap] = useState<SceneCharacterMap | null>(null);
  const loadedBookRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    if (!storage || !bookId) {
      setCharacters([]);
      setSceneCharIds(new Set());
      setChapterCharIds(new Set());
      setSegmentCounts(new Map());
      setSceneCharMap(null);
      return;
    }
    setLoading(true);
    try {
      const [chars, counts] = await Promise.all([
        readCharacterIndex(storage),
        countSegmentAppearances(storage),
      ]);
      setCharacters(chars);
      setSegmentCounts(counts);
      loadedBookRef.current = bookId;
    } catch (err) {
      console.warn("[useLocalCharacters] Load error:", err);
    } finally {
      setLoading(false);
    }
  }, [storage, bookId]);

  // Load on mount / bookId change
  useEffect(() => {
    if (bookId !== loadedBookRef.current) {
      setCharacters([]);
      setSceneCharIds(new Set());
      setChapterCharIds(new Set());
    }
    reload();
  }, [reload, bookId]);

  // Load scene-level character IDs
  useEffect(() => {
    if (!storage || !sceneId) { setSceneCharIds(new Set()); setSceneCharMap(null); return; }
    (async () => {
      const [ids, map] = await Promise.all([
        getSceneCharacterIds(storage, sceneId),
        readSceneCharacterMap(storage, sceneId),
      ]);
      setSceneCharIds(ids);
      setSceneCharMap(map);
    })();
  }, [storage, sceneId, characters]);

  // Load chapter-level character IDs
  useEffect(() => {
    if (!storage || !chapterSceneIds?.length) { setChapterCharIds(new Set()); return; }
    getChapterCharacterIds(storage, chapterSceneIds).then(setChapterCharIds);
  }, [storage, chapterSceneIds, characters]);

  const updateCharacter = useCallback(async (id: string, partial: Partial<CharacterIndex>) => {
    if (!storage) return;
    setCharacters(prev => {
      const next = prev.map(c => c.id === id ? { ...c, ...partial } : c);
      saveCharacterIndex(storage, next);
      return next;
    });
  }, [storage]);

  const mergeCharacters = useCallback(async (ids: string[]) => {
    if (!storage || ids.length < 2) return;
    setCharacters(prev => {
      const ordered = ids.map(id => prev.find(c => c.id === id)).filter(Boolean) as CharacterIndex[];
      if (ordered.length < 2) return prev;

      const primary = ordered[0];
      const others = ordered.slice(1);

      const newAliases = [
        ...primary.aliases,
        ...others.flatMap(c => [c.name, ...c.aliases]),
      ].filter((v, i, a) => a.indexOf(v) === i && v.toLowerCase() !== primary.name.toLowerCase());

      const merged: CharacterIndex = {
        ...primary,
        aliases: newAliases,
        gender: primary.gender !== "unknown" ? primary.gender : (others.find(c => c.gender !== "unknown")?.gender || "unknown"),
        description: primary.description || others.find(c => c.description)?.description || null,
        temperament: primary.temperament || others.find(c => c.temperament)?.temperament || null,
        voice_config: primary.voice_config?.voice_id ? primary.voice_config : (others.find(c => c.voice_config?.voice_id)?.voice_config || {}),
      };

      const otherIds = new Set(others.map(c => c.id));
      const next = prev.filter(c => !otherIds.has(c.id)).map(c => c.id === primary.id ? merged : c);
      saveCharacterIndex(storage, next);
      return next;
    });
  }, [storage]);

  const nameLookup = useMemo(() => buildNameLookup(characters), [characters]);

  const findByName = useCallback((name: string) =>
    findCharacterByNameOrAlias(characters, name),
    [characters]);

  const charMap = useMemo(() => new Map(characters.map(c => [c.id, c])), [characters]);
  const getById = useCallback((id: string) => charMap.get(id), [charMap]);

  return {
    characters,
    loading,
    reload,
    updateCharacter,
    mergeCharacters,
    sceneCharIds,
    chapterCharIds,
    segmentCounts,
    nameLookup,
    findByName,
    getById,
    sceneCharMap,
  };
}
