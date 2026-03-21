/**
 * Orchestrator hook for parser character management.
 * Composes: useCharacterCrud, useCharacterExtraction, useCharacterProfiles.
 * Keeps shared state (characters[], loading) and delegates domain logic.
 */

import { useState, useEffect, useRef } from "react";
import type { ProjectStorage } from "@/lib/projectStorage";
import type { Scene, ChapterStatus, TocChapter, CharacterIndex } from "@/pages/parser/types";
import { readCharacterIndex } from "@/lib/localCharacters";
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
  const [characters, setCharacters] = useState<CharacterIndex[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedBookRef = useRef<string | null>(null);

  // Clear characters immediately when bookId changes (prevents stale data from previous book)
  useEffect(() => {
    if (!bookId || bookId === loadedBookRef.current) return;
    setCharacters([]);
    loadedBookRef.current = null;
  }, [bookId]);

  // Load characters from local storage when book/storage are ready
  useEffect(() => {
    if (!storage || !bookId) return;
    if (bookId === loadedBookRef.current) return;
    loadedBookRef.current = bookId;
    (async () => {
      setLoading(true);
      const loaded = await readCharacterIndex(storage);
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
    stopProfiling: profiles.stopProfiling,
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
