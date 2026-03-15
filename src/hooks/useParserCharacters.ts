/**
 * Hook for managing characters in the Parser module (local-first).
 * Extracts character names from analyzed scenes, manages CRUD, aliases, merge.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { Scene, ChapterStatus, TocChapter, LocalCharacter, CharacterAppearance } from "@/pages/parser/types";
import { saveCharactersToLocal, readCharactersFromLocal } from "@/lib/localSync";

interface UseParserCharactersParams {
  storage: ProjectStorage | null;
  tocEntries: TocChapter[];
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  bookId: string | null;
}

/** Simple quoted-speech speaker extraction (Russian / English dialogue patterns) */
function extractSpeakersFromText(text: string): string[] {
  const speakers = new Set<string>();

  // Pattern: «...» — Имя / "..." said Name / Name said
  // Capture capitalized names after em-dash or before/after speech verbs
  const dashPattern = /[»"]\s*[—–-]\s*([А-ЯЁA-Z][а-яёa-z]{2,}(?:\s+[А-ЯЁA-Z][а-яёa-z]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = dashPattern.exec(text)) !== null) {
    speakers.add(m[1].trim());
  }

  // Pattern: Name + speech verb (сказал, спросил, ответил, воскликнул, прошептал, etc.)
  const verbPattern = /([А-ЯЁA-Z][а-яёa-z]{2,}(?:\s+[А-ЯЁA-Z][а-яёa-z]+)?)\s+(?:сказал|спросил|ответил|воскликнул|прошептал|пробормотал|проговорил|заметил|добавил|крикнул|шепнул|буркнул|произнёс|произнес|said|asked|replied|exclaimed|whispered|muttered|shouted)/g;
  while ((m = verbPattern.exec(text)) !== null) {
    speakers.add(m[1].trim());
  }

  return Array.from(speakers);
}

function generateId(): string {
  return crypto.randomUUID();
}

export function useParserCharacters({
  storage,
  tocEntries,
  chapterResults,
  bookId,
}: UseParserCharactersParams) {
  const [characters, setCharacters] = useState<LocalCharacter[]>([]);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const loadedBookRef = useRef<string | null>(null);

  // Load characters from local storage when book changes
  useEffect(() => {
    if (!storage || !bookId || bookId === loadedBookRef.current) return;
    loadedBookRef.current = bookId;
    (async () => {
      setLoading(true);
      const loaded = await readCharactersFromLocal(storage);
      setCharacters(loaded);
      setLoading(false);
    })();
  }, [storage, bookId]);

  // Save helper
  const persist = useCallback(async (chars: LocalCharacter[]) => {
    if (!storage) return;
    await saveCharactersToLocal(storage, chars);
  }, [storage]);

  // Extract characters from all analyzed scenes
  const extractCharacters = useCallback(async () => {
    setExtracting(true);

    const nameMap = new Map<string, { appearances: CharacterAppearance[]; sceneCount: number }>();

    chapterResults.forEach((result, idx) => {
      if (result.status !== "done" || !result.scenes?.length) return;
      const entry = tocEntries[idx];
      if (!entry) return;

      for (const scene of result.scenes) {
        const text = scene.content || "";
        if (!text) continue;

        const speakers = extractSpeakersFromText(text);
        for (const name of speakers) {
          const key = name.toLowerCase();
          if (!nameMap.has(key)) {
            nameMap.set(key, { appearances: [], sceneCount: 0 });
          }
          const data = nameMap.get(key)!;

          // Check if this chapter already has an appearance entry
          let chapterApp = data.appearances.find(a => a.chapterIdx === idx);
          if (!chapterApp) {
            chapterApp = { chapterIdx: idx, chapterTitle: entry.title, sceneNumbers: [] };
            data.appearances.push(chapterApp);
          }
          if (!chapterApp.sceneNumbers.includes(scene.scene_number)) {
            chapterApp.sceneNumbers.push(scene.scene_number);
            data.sceneCount++;
          }
        }
      }
    });

    // Merge with existing characters (keep IDs, add new ones)
    const existingByName = new Map<string, LocalCharacter>();
    for (const ch of characters) {
      existingByName.set(ch.name.toLowerCase(), ch);
      for (const alias of ch.aliases) {
        existingByName.set(alias.toLowerCase(), ch);
      }
    }

    const updated: LocalCharacter[] = [...characters];
    const usedIds = new Set(characters.map(c => c.id));

    for (const [key, data] of nameMap) {
      const existing = existingByName.get(key);
      if (existing) {
        // Update appearances
        existing.appearances = data.appearances;
        existing.sceneCount = data.sceneCount;
      } else {
        // Capitalize name from key
        const displayName = key.charAt(0).toUpperCase() + key.slice(1);
        const newChar: LocalCharacter = {
          id: generateId(),
          name: displayName,
          aliases: [],
          appearances: data.appearances,
          sceneCount: data.sceneCount,
        };
        updated.push(newChar);
        usedIds.add(newChar.id);
        existingByName.set(key, newChar);
      }
    }

    // Sort by scene count descending
    updated.sort((a, b) => b.sceneCount - a.sceneCount);

    setCharacters(updated);
    await persist(updated);
    setExtracting(false);
    return updated;
  }, [chapterResults, tocEntries, characters, persist]);

  // CRUD operations
  const renameCharacter = useCallback(async (id: string, newName: string) => {
    setCharacters(prev => {
      const next = prev.map(c => c.id === id ? { ...c, name: newName } : c);
      persist(next);
      return next;
    });
  }, [persist]);

  const updateAliases = useCallback(async (id: string, aliases: string[]) => {
    setCharacters(prev => {
      const next = prev.map(c => c.id === id ? { ...c, aliases } : c);
      persist(next);
      return next;
    });
  }, [persist]);

  const deleteCharacter = useCallback(async (id: string) => {
    setCharacters(prev => {
      const next = prev.filter(c => c.id !== id);
      persist(next);
      return next;
    });
  }, [persist]);

  const mergeCharacters = useCallback(async (sourceId: string, targetId: string) => {
    setCharacters(prev => {
      const source = prev.find(c => c.id === sourceId);
      const target = prev.find(c => c.id === targetId);
      if (!source || !target) return prev;

      // Merge aliases (source name + source aliases → target aliases)
      const allAliases = new Set([...target.aliases, source.name, ...source.aliases]);
      allAliases.delete(target.name); // don't add target's own name as alias

      // Merge appearances
      const appMap = new Map<number, CharacterAppearance>();
      for (const app of [...target.appearances, ...source.appearances]) {
        const existing = appMap.get(app.chapterIdx);
        if (existing) {
          const scenes = new Set([...existing.sceneNumbers, ...app.sceneNumbers]);
          existing.sceneNumbers = Array.from(scenes).sort((a, b) => a - b);
        } else {
          appMap.set(app.chapterIdx, { ...app });
        }
      }

      const merged: LocalCharacter = {
        ...target,
        aliases: Array.from(allAliases),
        appearances: Array.from(appMap.values()),
        sceneCount: Array.from(appMap.values()).reduce((sum, a) => sum + a.sceneNumbers.length, 0),
      };

      const next = prev.filter(c => c.id !== sourceId).map(c => c.id === targetId ? merged : c);
      persist(next);
      return next;
    });
  }, [persist]);

  const addCharacter = useCallback(async (name: string) => {
    const newChar: LocalCharacter = {
      id: generateId(),
      name,
      aliases: [],
      appearances: [],
      sceneCount: 0,
    };
    setCharacters(prev => {
      const next = [...prev, newChar];
      persist(next);
      return next;
    });
    return newChar;
  }, [persist]);

  return {
    characters,
    loading,
    extracting,
    extractCharacters,
    renameCharacter,
    updateAliases,
    deleteCharacter,
    mergeCharacters,
    addCharacter,
  };
}
