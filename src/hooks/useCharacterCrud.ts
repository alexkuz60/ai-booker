/**
 * CRUD operations for local-first character management.
 * Handles rename, gender, aliases, delete, merge, add + persistence.
 * Now works with CharacterIndex (new format) stored in characters/index.json.
 */

import { useCallback } from "react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { CharacterIndex, CharacterAppearance } from "@/pages/parser/types";
import { saveCharacterIndex } from "@/lib/localCharacters";

function generateId(): string {
  return crypto.randomUUID();
}

export function useCharacterCrud(
  storage: ProjectStorage | null,
  characters: CharacterIndex[],
  setCharacters: React.Dispatch<React.SetStateAction<CharacterIndex[]>>,
) {
  const persist = useCallback(async (chars: CharacterIndex[]) => {
    if (!storage) return;
    await saveCharacterIndex(storage, chars);
  }, [storage]);

  const renameCharacter = useCallback(async (id: string, newName: string) => {
    setCharacters(prev => {
      const next = prev.map(c => c.id === id ? { ...c, name: newName } : c);
      persist(next);
      return next;
    });
  }, [persist, setCharacters]);

  const updateGender = useCallback(async (id: string, gender: "male" | "female" | "unknown") => {
    setCharacters(prev => {
      const next = prev.map(c => c.id === id ? { ...c, gender } : c);
      persist(next);
      return next;
    });
  }, [persist, setCharacters]);

  const updateAliases = useCallback(async (id: string, aliases: string[]) => {
    setCharacters(prev => {
      const next = prev.map(c => c.id === id ? { ...c, aliases } : c);
      persist(next);
      return next;
    });
  }, [persist, setCharacters]);

  const deleteCharacter = useCallback(async (id: string) => {
    setCharacters(prev => {
      const next = prev.filter(c => c.id !== id);
      persist(next);
      return next;
    });
  }, [persist, setCharacters]);

  const mergeCharacters = useCallback(async (sourceId: string, targetId: string) => {
    setCharacters(prev => {
      const source = prev.find(c => c.id === sourceId);
      const target = prev.find(c => c.id === targetId);
      if (!source || !target) return prev;

      const allAliases = new Set([...target.aliases, source.name, ...source.aliases]);
      allAliases.delete(target.name);

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

      const merged: CharacterIndex = {
        ...target,
        aliases: Array.from(allAliases),
        gender: target.gender !== "unknown" ? target.gender : source.gender,
        description: target.description || source.description,
        temperament: target.temperament || source.temperament,
        voice_config: target.voice_config?.voice_id ? target.voice_config : source.voice_config,
        appearances: Array.from(appMap.values()),
        sceneCount: Array.from(appMap.values()).reduce((sum, a) => sum + a.sceneNumbers.length, 0),
      };

      const next = prev.filter(c => c.id !== sourceId).map(c => c.id === targetId ? merged : c);
      persist(next);
      return next;
    });
  }, [persist, setCharacters]);

  const addCharacter = useCallback(async (name: string) => {
    const newChar: CharacterIndex = {
      id: generateId(),
      name,
      aliases: [],
      gender: "unknown",
      age_group: "unknown",
      sort_order: 0,
      speech_tags: [],
      psycho_tags: [],
      appearances: [],
      sceneCount: 0,
      voice_config: {},
    };
    setCharacters(prev => {
      const next = [...prev, newChar];
      persist(next);
      return next;
    });
    return newChar;
  }, [persist, setCharacters]);

  return {
    persist,
    renameCharacter,
    updateGender,
    updateAliases,
    deleteCharacter,
    mergeCharacters,
    addCharacter,
  };
}
