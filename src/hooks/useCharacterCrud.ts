/**
 * CRUD operations for local-first character management.
 * Handles rename, gender, aliases, delete, merge, add + persistence.
 */

import { useCallback } from "react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { LocalCharacter, CharacterAppearance } from "@/pages/parser/types";
import { saveCharactersToLocal } from "@/lib/localSync";

function generateId(): string {
  return crypto.randomUUID();
}

export function useCharacterCrud(
  storage: ProjectStorage | null,
  characters: LocalCharacter[],
  setCharacters: React.Dispatch<React.SetStateAction<LocalCharacter[]>>,
) {
  const persist = useCallback(async (chars: LocalCharacter[]) => {
    if (!storage) return;
    await saveCharactersToLocal(storage, chars);
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

      const merged: LocalCharacter = {
        ...target,
        aliases: Array.from(allAliases),
        gender: target.gender || source.gender,
        appearances: Array.from(appMap.values()),
        sceneCount: Array.from(appMap.values()).reduce((sum, a) => sum + a.sceneNumbers.length, 0),
      };

      const next = prev.filter(c => c.id !== sourceId).map(c => c.id === targetId ? merged : c);
      persist(next);
      return next;
    });
  }, [persist, setCharacters]);

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
