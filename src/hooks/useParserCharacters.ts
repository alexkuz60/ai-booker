/**
 * Orchestrator hook for parser character management.
 * Composes: useCharacterCrud, useCharacterExtraction, useCharacterProfiles.
 * Keeps shared state (characters[], loading) and delegates domain logic.
 */

import { useState, useEffect, useRef } from "react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { Scene, ChapterStatus, TocChapter, LocalCharacter } from "@/pages/parser/types";
import { readCharactersFromLocal } from "@/lib/localSync";
import { useCharacterCrud } from "@/hooks/useCharacterCrud";
import { useCharacterExtraction } from "@/hooks/useCharacterExtraction";
import { useCharacterProfiles } from "@/hooks/useCharacterProfiles";

interface UseParserCharactersParams {
  storage: ProjectStorage | null;
  tocEntries: TocChapter[];
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  bookId: string | null;
  /** Resolved model for the profiler role */
  profilerModel?: string;
  /** User API keys map (e.g. { openrouter: "sk-...", proxyapi: "..." }) */
  userApiKeys?: Record<string, string>;
  isRu?: boolean;
  /** Effective pool for the profiler role (from useAiRoles.getEffectivePool) */
  effectivePool?: string[];
}

export function useParserCharacters({
  storage,
  tocEntries,
  chapterResults,
  bookId,
  profilerModel = "google/gemini-2.5-flash",
  userApiKeys = {},
  isRu = true,
  effectivePool,
}: UseParserCharactersParams) {
  const [characters, setCharacters] = useState<LocalCharacter[]>([]);
  const [loading, setLoading] = useState(false);
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

  // CRUD
  const crud = useCharacterCrud(storage, characters, setCharacters);

  // AI extraction
  const extraction = useCharacterExtraction({
    tocEntries,
    chapterResults,
    characters,
    setCharacters,
    persist: crud.persist,
    profilerModel,
    userApiKeys,
    isRu,
    effectivePool,
  });

  // AI profiling
  const profiles = useCharacterProfiles({
    tocEntries,
    chapterResults,
    characters,
    setCharacters,
    persist: crud.persist,
    profilerModel,
    userApiKeys,
    isRu,
    effectivePool,
  });

  return {
    characters,
    loading,
    // Extraction
    extracting: extraction.extracting,
    extractProgress: extraction.extractProgress,
    extractPoolStats: extraction.extractPoolStats,
    extractedCount: extraction.extractedCount,
    extractTotal: extraction.extractTotal,
    extractCharacters: extraction.extractCharacters,
    // Profiling
    profiling: profiles.profiling,
    profileProgress: profiles.profileProgress,
    profilePoolStats: profiles.profilePoolStats,
    profiledCount: profiles.profiledCount,
    profileTotal: profiles.profileTotal,
    profileCharacters: profiles.profileCharacters,
    // CRUD
    renameCharacter: crud.renameCharacter,
    updateGender: crud.updateGender,
    updateAliases: crud.updateAliases,
    deleteCharacter: crud.deleteCharacter,
    mergeCharacters: crud.mergeCharacters,
    addCharacter: crud.addCharacter,
    // Data for UI (chapter list in extraction menu)
    tocEntries,
    chapterResults,
  };
}
