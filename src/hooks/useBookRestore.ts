/**
 * useBookRestore — restores books from OPFS or server.
 * restoreFromLocal: reads from OPFS ProjectStorage.
 * openSavedBook: local-only — tries OPFS first; deploys from server via Wipe-and-Deploy.
 * ensurePdfLoaded: lazy-loads PDF proxy from local project.
 */

import { useState, useCallback } from "react";
import { clearChapterTextsCache } from "@/lib/chapterTextsCache";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  flattenTocWithRanges, type TocEntry,
} from "@/lib/pdf-extract";
import { t } from "@/pages/parser/i18n";
import type { Scene, TocChapter, Step, ChapterStatus, BookRecord, CharacterIndex } from "@/pages/parser/types";
import { classifySection, normalizeLevels, ACTIVE_BOOK_KEY } from "@/pages/parser/types";
import { OPFSStorage, type ProjectStorage } from "@/lib/projectStorage";
import { syncStructureToLocal, readStructureFromLocal } from "@/lib/localSync";
import { isFolderNode, normalizeTocRanges, sanitizeChapterResultsForStructure } from "@/lib/tocStructure";
import { detectFileFormat, getSourcePath, stripFileExtension, type FileFormat } from "@/lib/fileFormatUtils";
import { getProjectActivityMs } from "@/lib/projectActivity";
import { saveCharacterIndex, saveSceneCharacterMap } from "@/lib/localCharacters";
import { saveStoryboardToLocal, type LocalTypeMappingEntry } from "@/lib/storyboardSync";
import type { SceneCharacterMap } from "@/pages/parser/types";
import { wipeProjectBrowserState } from "@/lib/projectCleanup";

interface UseBookRestoreParams {
  userId: string | undefined;
  isRu: boolean;
  storageBackend: "fs-access" | "opfs" | "none";
  projectStorage?: ProjectStorage | null;
  createProject?: (title: string, bookId: string, userId: string, language: "ru" | "en") => Promise<ProjectStorage>;
  openProjectByName?: (projectName: string) => Promise<ProjectStorage | null>;
  /** For ensurePdfLoaded fallback */
  books: BookRecord[];
  fileName: string;
  bookId: string | null;
  /** Map of bookId → OPFS project names (from useLibrary) */
  localProjectNamesByBookId: Map<string, string[]>;
  // State setters from orchestrator
  setStep: (s: Step) => void;
  setFileName: (s: string) => void;
  setBookId: (id: string | null) => void;
  setTocEntries: React.Dispatch<React.SetStateAction<TocChapter[]>>;
  setChapterIdMap: React.Dispatch<React.SetStateAction<Map<number, string>>>;
  setPartIdMap: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  setChapterResults: React.Dispatch<React.SetStateAction<Map<number, { scenes: Scene[]; status: ChapterStatus }>>>;
  setPdfRef: React.Dispatch<React.SetStateAction<any>>;
  setTotalPages: React.Dispatch<React.SetStateAction<number>>;
  setErrorMsg: React.Dispatch<React.SetStateAction<string>>;
}

export function useBookRestore({
  userId, isRu, storageBackend, projectStorage, createProject, openProjectByName,
  books, fileName, bookId, localProjectNamesByBookId,
  setStep, setFileName, setBookId, setTocEntries, setChapterIdMap,
  setPartIdMap, setChapterResults, setPdfRef, setTotalPages, setErrorMsg,
}: UseBookRestoreParams) {
  const [pdfRef, setPdfRefLocal] = useState<any>(null);
  const [totalPages, setTotalPagesLocal] = useState(0);

  const updatePdfRef = useCallback((ref: any) => {
    setPdfRefLocal(ref);
    setPdfRef(ref);
  }, [setPdfRef]);

  const updateTotalPages = useCallback((pages: number) => {
    setTotalPagesLocal(pages);
    setTotalPages(pages);
  }, [setTotalPages]);

  const clearTransientBookState = useCallback(() => {
    updatePdfRef(null);
    updateTotalPages(0);
    clearChapterTextsCache();
  }, [updatePdfRef, updateTotalPages]);

  const getBookIdFromStorage = useCallback(async (storage: ProjectStorage | null | undefined): Promise<string | null> => {
    if (!storage?.isReady) return null;
    try {
      const meta = await storage.readJSON<{ bookId?: string }>("project.json");
      if (meta?.bookId) return meta.bookId;
      const structure = await storage.readJSON<{ bookId?: string }>("structure/toc.json");
      return structure?.bookId || null;
    } catch {
      return null;
    }
  }, []);

  const resolveLocalStorageForBook = useCallback(async (
    targetBookId: string,
    options?: { activate?: boolean },
  ): Promise<ProjectStorage | null> => {
    const activate = options?.activate ?? false;

    if (storageBackend === "opfs") {
      const projectNames = localProjectNamesByBookId.get(targetBookId);
      if (projectNames?.length) {
        try {
          const ranked = (await Promise.all(projectNames.map(async (projectName) => {
            try {
              const store = await OPFSStorage.openOrCreate(projectName);
              return {
                projectName,
                store,
                activityMs: await getProjectActivityMs(store),
              };
            } catch (err) {
              console.warn("[BookRestore] Failed to inspect OPFS project:", projectName, err);
              return null;
            }
          })))
            .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate)
            .sort((a, b) => b.activityMs - a.activityMs);

          const freshest = ranked[0];
          if (!freshest) return null;

          if (activate && openProjectByName) {
            const activated = await openProjectByName(freshest.projectName);
            if (activated?.isReady) {
              console.debug("[BookRestore] Activated freshest OPFS project:", freshest.projectName, targetBookId);
              return activated;
            }
          }

          const direct = freshest.store;
          if (direct.isReady) {
            console.debug("[BookRestore] Opened freshest OPFS project directly:", freshest.projectName, targetBookId);
            return direct;
          }
        } catch (err) {
          console.warn("[BookRestore] Failed to open freshest OPFS project for book:", targetBookId, err);
        }
      }
    }

    const activeBookId = await getBookIdFromStorage(projectStorage);
    if (projectStorage?.isReady && activeBookId === targetBookId) {
      return projectStorage;
    }

    return null;
  }, [storageBackend, localProjectNamesByBookId, openProjectByName, getBookIdFromStorage, projectStorage]);

  const ensureWritableLocalStorage = useCallback(async (
    targetBookId: string,
    targetTitle: string,
    targetFileName: string,
  ): Promise<ProjectStorage | null> => {
    const existing = await resolveLocalStorageForBook(targetBookId, { activate: true });
    if (existing?.isReady) return existing;

    const activeBookId = await getBookIdFromStorage(projectStorage);
    if (projectStorage?.isReady && activeBookId === targetBookId) {
      return projectStorage;
    }

    if (storageBackend === "opfs" && createProject && userId) {
      try {
        const lang = isRu ? "ru" as const : "en" as const;
        return await createProject(targetTitle || stripFileExtension(targetFileName), targetBookId, userId, lang);
      } catch (err) {
        console.warn("[BookRestore] Failed to create local project:", err);
      }
    }

    return null;
  }, [resolveLocalStorageForBook, getBookIdFromStorage, projectStorage, storageBackend, createProject, userId, isRu]);

  const restoreFromLocal = useCallback(async (savedBookId: string): Promise<boolean> => {
    clearTransientBookState();

    const storage = await resolveLocalStorageForBook(savedBookId, { activate: true });
    if (!storage?.isReady) return false;

    try {
      const local = await readStructureFromLocal(storage);
      if (!local?.structure || local.structure.bookId !== savedBookId) return false;

      const { structure, chapterIdMap: localChIdMap, chapterResults: localResults } = local;
      const normalizedToc = normalizeTocRanges(normalizeLevels(structure.toc));
      const sanitizedLocalResults = sanitizeChapterResultsForStructure(normalizedToc, localResults);

      setBookId(savedBookId);
      setFileName(structure.fileName);
      setTocEntries(normalizedToc);
      setChapterIdMap(localChIdMap);
      setChapterResults(sanitizedLocalResults);

      const newPartIdMap = new Map<string, string>();
      for (const p of structure.parts) {
        newPartIdMap.set(p.title, p.id);
      }
      setPartIdMap(newPartIdMap);

      sessionStorage.setItem(ACTIVE_BOOK_KEY, savedBookId);
      setStep("workspace");

      void syncStructureToLocal(storage, {
        bookId: savedBookId,
        title: structure.title,
        fileName: structure.fileName,
        toc: normalizedToc,
        parts: structure.parts,
        chapterIdMap: localChIdMap,
        chapterResults: sanitizedLocalResults,
      });

      const localMeta = await storage.readJSON<Record<string, unknown>>("project.json");
      const localFormat: FileFormat = (localMeta?.fileFormat as FileFormat) || detectFileFormat(structure.fileName);

      if (localFormat === "pdf") {
        const sourcePath = getSourcePath(localFormat);
        storage.readBlob(sourcePath).then(async (pdfBlob) => {
          if (!pdfBlob) {
            console.log("[LocalRestore] No local PDF found, keeping pdfRef empty");
            return;
          }
          try {
            const arrayBuffer = await pdfBlob.arrayBuffer();
            const { getDocument } = await import("pdfjs-dist");
            const pdf = await getDocument({ data: arrayBuffer }).promise;
            updatePdfRef(pdf);
            updateTotalPages(pdf.numPages);
            console.log(`[LocalRestore] PDF restored locally: ${pdf.numPages} pages`);
          } catch (pdfErr) {
            console.warn("[LocalRestore] Failed to parse local PDF:", pdfErr);
          }
        });
      } else {
        console.log("[LocalRestore] Non-PDF book — PDF proxy cleared");
      }

      console.log(`[LocalRestore] Restored from local: ${structure.toc.length} chapters, ${localResults.size} results`);
      toast.success(
        isRu
          ? `Книга «${structure.title}» загружена`
          : `Book "${structure.title}" loaded`
      );
      return true;
    } catch (err) {
      console.warn("[LocalRestore] Failed:", err);
      return false;
    }
  }, [clearTransientBookState, resolveLocalStorageForBook, isRu, setBookId, setFileName, setTocEntries, setChapterIdMap, setChapterResults, setPartIdMap, setStep, updatePdfRef, updateTotalPages]);

  const openSavedBook = useCallback(async (
    book: BookRecord,
    options?: { skipTimestampCheck?: boolean },
    checkServerNewer?: (bookId: string) => Promise<boolean>,
    setServerNewerBookId?: (bookId: string | null) => void,
  ) => {
    if (!userId) return;

    // When skipTimestampCheck is true, the user explicitly requested "load from server"
    // → skip local restore entirely and go straight to Wipe-and-Deploy
    if (!options?.skipTimestampCheck) {
      const canTryLocal = !!(await resolveLocalStorageForBook(book.id));
      if (canTryLocal) {
        const restored = await restoreFromLocal(book.id);
        if (restored) {
          if (checkServerNewer && setServerNewerBookId) {
            const isNewer = await checkServerNewer(book.id);
            if (isNewer) setServerNewerBookId(book.id);
          }
          return;
        }
        return;
      }
      return;
    }
    console.log(`[OpenBook] skipTimestampCheck=true → forcing Wipe-and-Deploy for book ${book.id}`);

    // ── Wipe-and-Deploy: clean slate before server restore ──
    // Step 1-2: Wipe OPFS project + browser state
    const existingProjects = localProjectNamesByBookId.get(book.id) || [];
    await wipeProjectBrowserState(book.id, existingProjects);

    clearTransientBookState();
    setStep("extracting_toc");
    setFileName(book.file_name);
    setBookId(book.id);
    sessionStorage.setItem(ACTIVE_BOOK_KEY, book.id);

    try {
      const [partsRes, chaptersRes, pdfBlob] = await Promise.all([
        supabase.from("book_parts").select("id, part_number, title").eq("book_id", book.id).order("part_number"),
        supabase.from("book_chapters").select("id, chapter_number, title, scene_type, mood, bpm, part_id, level, start_page, end_page").eq("book_id", book.id).order("chapter_number"),
        book.file_path
          ? supabase.storage.from("book-uploads").download(book.file_path).then(r => r.data)
          : Promise.resolve(null),
      ]);

      const parts = partsRes.data || [];
      const chapters = chaptersRes.data || [];

      if (chapters.length === 0) {
        toast.info(t("noChaptersFound", isRu));
        setStep("upload");
        return;
      }

      const bookFormat = detectFileFormat(book.file_name);
      const isBookDocx = bookFormat === "docx";

      let restoredPdf: any = null;
      let restoredTotalPages = 0;
      let tocFromPdf: { startPage: number; endPage: number; level: number }[] = [];

      if (!isBookDocx && pdfBlob) {
        try {
          const arrayBuffer = await pdfBlob.arrayBuffer();
          const { getDocument } = await import("pdfjs-dist");
          const pdf = await getDocument({ data: arrayBuffer }).promise;
          restoredPdf = pdf;
          restoredTotalPages = pdf.numPages;

          const rawOutline = await pdf.getOutline();
          if (rawOutline && rawOutline.length > 0) {
            const flat = flattenTocWithRanges(
              await (async function parseItems(items: any[], level: number): Promise<TocEntry[]> {
                const entries: TocEntry[] = [];
                for (const item of items) {
                  let pageNumber = 1;
                  try {
                    if (item.dest) {
                      const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
                      if (dest && dest[0]) {
                        const pageIndex = await pdf.getPageIndex(dest[0]);
                        pageNumber = pageIndex + 1;
                      }
                    }
                  } catch {}
                  const children = item.items?.length ? await parseItems(item.items, level + 1) : [];
                  entries.push({ title: item.title || "Untitled", pageNumber, level, children });
                }
                return entries;
              })(rawOutline, 0),
              pdf.numPages,
            );

            tocFromPdf = chapters.map((ch, i) => {
              const byTitle = flat.find(f => f.title === ch.title);
              if (byTitle) return { startPage: byTitle.startPage, endPage: byTitle.endPage, level: byTitle.level };
              if (i < flat.length) return { startPage: flat[i].startPage, endPage: flat[i].endPage, level: flat[i].level };
              return { startPage: 0, endPage: 0, level: 0 };
            });
          }
        } catch (pdfErr) {
          console.warn("Could not restore PDF for analysis:", pdfErr);
        }
      } else if (!isBookDocx && book.file_path && !pdfBlob) {
        toast.warning(
          isRu
            ? "PDF-файл не найден на сервере. Анализ будет недоступен до повторной загрузки."
            : "PDF file not found on server. Analysis unavailable until re-upload."
        );
      } else if (isBookDocx) {
        console.log("[OpenBook] DOCX book — no PDF proxy needed");
      }

      updatePdfRef(restoredPdf);
      updateTotalPages(restoredTotalPages);

      const partById = new Map<string, string>();
      const newPartIdMap = new Map<string, string>();
      for (const p of parts) {
        partById.set(p.id, p.title);
        newPartIdMap.set(p.title, p.id);
      }
      setPartIdMap(newPartIdMap);

      const hasParts = parts.length > 0;
      const savedToc: TocChapter[] = chapters.map((ch, i) => {
        const pdfInfo = tocFromPdf[i];
        const dbLevel = ch.level;
        const dbStartPage = (ch as any).start_page || 0;
        const dbEndPage = (ch as any).end_page || 0;
        return {
          title: ch.title,
          startPage: dbStartPage || pdfInfo?.startPage || 0,
          endPage: dbEndPage || pdfInfo?.endPage || 0,
          level: dbLevel != null ? dbLevel : (pdfInfo?.level ?? (hasParts && ch.part_id ? 1 : 0)),
          partTitle: ch.part_id ? partById.get(ch.part_id) : undefined,
          sectionType: classifySection(ch.title),
        };
      });
      const normalizedSavedToc = normalizeLevels(savedToc);
      const normalizedRangedToc = normalizeTocRanges(
        normalizedSavedToc,
        restoredTotalPages > 0 ? restoredTotalPages : undefined,
      );
      setTocEntries(normalizedRangedToc);

      const newChapterIdMap = new Map<number, string>();
      chapters.forEach((ch, i) => newChapterIdMap.set(i, ch.id));
      setChapterIdMap(newChapterIdMap);

      const allChapterIds = chapters.map(c => c.id);
      const { data: allScenes } = await supabase
        .from("book_scenes")
        .select("id, chapter_id, scene_number, title, content, scene_type, mood, bpm")
        .in("chapter_id", allChapterIds)
        .order("scene_number");

      const scenesByChapter = new Map<string, Scene[]>();
      for (const s of (allScenes || [])) {
        const list = scenesByChapter.get(s.chapter_id) || [];
        list.push({
          id: s.id,
          scene_number: s.scene_number,
          title: s.title,
          content: s.content || undefined,
          content_preview: (s.content || "").slice(0, 200) || undefined,
          scene_type: s.scene_type || "mixed",
          mood: s.mood || "neutral",
          bpm: s.bpm || 120,
          char_count: (s.content || "").length,
        });
        scenesByChapter.set(s.chapter_id, list);
      }

      const normalizedToc = normalizedRangedToc;
      const initRawMap = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
      chapters.forEach((ch, i) => {
        const scenes = isFolderNode(normalizedToc, i) ? [] : (scenesByChapter.get(ch.id) || []);
        initRawMap.set(i, { scenes, status: scenes.length > 0 ? "done" : "pending" });
      });
      const initMap = sanitizeChapterResultsForStructure(normalizedToc, initRawMap);
      setChapterResults(initMap);
      setStep("workspace");

      const targetStorage = await ensureWritableLocalStorage(
        book.id,
        book.title || stripFileExtension(book.file_name),
        book.file_name,
      );

      if (targetStorage?.isReady) {
        await syncStructureToLocal(targetStorage, {
          bookId: book.id,
          title: book.title || stripFileExtension(book.file_name),
          fileName: book.file_name,
          toc: normalizedToc,
          parts: parts.map(p => ({ id: p.id, title: p.title, partNumber: p.part_number })),
          chapterIdMap: newChapterIdMap,
          chapterResults: initMap,
        });

        // ── Load characters from server (full CharacterIndex format) ──
        try {
          const { data: serverChars } = await supabase
            .from("book_characters")
            .select("id, name, aliases, gender, age_group, temperament, speech_style, description, speech_tags, psycho_tags, sort_order, color, voice_config")
            .eq("book_id", book.id)
            .order("sort_order");

          if (serverChars && serverChars.length > 0) {
            const restoredChars: CharacterIndex[] = serverChars.map(sc => ({
              id: sc.id,
              name: sc.name,
              aliases: sc.aliases || [],
              gender: (sc.gender as "male" | "female" | "unknown") || "unknown",
              age_group: sc.age_group || "unknown",
              temperament: sc.temperament || null,
              speech_style: sc.speech_style || null,
              description: sc.description || null,
              speech_tags: sc.speech_tags || [],
              psycho_tags: sc.psycho_tags || [],
              sort_order: sc.sort_order || 0,
              color: sc.color || null,
              voice_config: (sc.voice_config as Record<string, unknown>) || {},
              appearances: [],
              sceneCount: 0,
            }));
            await saveCharacterIndex(targetStorage, restoredChars);
            console.log(`[OpenBook] Restored ${restoredChars.length} characters (full CharacterIndex) from server`);
          }
        } catch (charErr) {
          console.warn("[OpenBook] Failed to restore characters from server:", charErr);
        }

        // ── Restore storyboard data (segments + phrases + type_mappings) from server ──
        try {
          const allSceneIds = (allScenes || []).map(s => s.id);
          console.log(`[OpenBook] Restoring storyboards for ${allSceneIds.length} scenes...`);
          if (allSceneIds.length > 0) {
            // Fetch segments for all scenes (batched)
            const { data: serverSegments, error: segFetchErr } = await supabase
              .from("scene_segments")
              .select("id, scene_id, segment_number, segment_type, speaker, metadata")
              .in("scene_id", allSceneIds)
              .order("segment_number");

            console.log(`[OpenBook] Fetched ${serverSegments?.length ?? 0} segments from server${segFetchErr ? ` (error: ${segFetchErr.message})` : ""}`);

            if (serverSegments && serverSegments.length > 0) {
              // Fetch all phrases for these segments
              const segmentIds = serverSegments.map(s => s.id);
              const allPhrases: Array<{ id: string; segment_id: string; phrase_number: number; text: string; metadata: any }> = [];
              // Batch in chunks of 500 to avoid query limits
              for (let i = 0; i < segmentIds.length; i += 500) {
                const chunk = segmentIds.slice(i, i + 500);
                const { data: phrases } = await supabase
                  .from("segment_phrases")
                  .select("id, segment_id, phrase_number, text, metadata")
                  .in("segment_id", chunk)
                  .order("phrase_number");
                if (phrases) allPhrases.push(...phrases);
              }

              // Fetch type mappings
              const { data: serverMappings } = await supabase
                .from("scene_type_mappings")
                .select("scene_id, segment_type, character_id")
                .in("scene_id", allSceneIds);

              // Group phrases by segment
              const phrasesBySegment = new Map<string, typeof allPhrases>();
              for (const ph of allPhrases) {
                const list = phrasesBySegment.get(ph.segment_id) || [];
                list.push(ph);
                phrasesBySegment.set(ph.segment_id, list);
              }

              // Group segments by scene
              const segmentsByScene = new Map<string, typeof serverSegments>();
              for (const seg of serverSegments) {
                const list = segmentsByScene.get(seg.scene_id) || [];
                list.push(seg);
                segmentsByScene.set(seg.scene_id, list);
              }

              // Group mappings by scene
              const mappingsByScene = new Map<string, Array<{ segment_type: string; character_id: string }>>();
              for (const m of (serverMappings || [])) {
                const list = mappingsByScene.get(m.scene_id) || [];
                list.push({ segment_type: m.segment_type, character_id: m.character_id });
                mappingsByScene.set(m.scene_id, list);
              }

              // Build scene→chapterId lookup from loaded data
              const sceneToChapter = new Map<string, string>();
              for (const s of (allScenes || [])) {
                sceneToChapter.set(s.id, s.chapter_id);
              }

              // Write storyboard.json for each scene that has segments
              let restoredCount = 0;
              const writes: Promise<void>[] = [];
              for (const [sceneId, segs] of segmentsByScene) {
                const chId = sceneToChapter.get(sceneId);
                const segments = segs.map(seg => {
                  const meta = (seg.metadata as Record<string, any>) || {};
                  const phrases = (phrasesBySegment.get(seg.id) || []).map(ph => ({
                    phrase_id: ph.id,
                    phrase_number: ph.phrase_number,
                    text: ph.text,
                    annotations: (ph.metadata as any)?.annotations || undefined,
                  }));
                  return {
                    segment_id: seg.id,
                    segment_number: seg.segment_number,
                    segment_type: seg.segment_type,
                    speaker: seg.speaker || null,
                    phrases,
                    inline_narrations: meta.inline_narrations || undefined,
                    split_silence_ms: meta.split_silence_ms ?? undefined,
                  };
                });

                const sceneMappings = mappingsByScene.get(sceneId) || [];
                const typeMappings: LocalTypeMappingEntry[] = sceneMappings.map(m => ({
                  segmentType: m.segment_type,
                  characterId: m.character_id,
                  characterName: "",
                }));

                writes.push(
                  saveStoryboardToLocal(targetStorage, sceneId, {
                    segments,
                    typeMappings,
                    audioStatus: new Map(),
                    inlineNarrationSpeaker: null,
                  }, chId)
                );
                restoredCount++;
              }
              await Promise.all(writes);
              if (restoredCount > 0) {
                console.log(`[OpenBook] ✅ Restored ${restoredCount} storyboards (${allPhrases.length} phrases, ${(serverMappings || []).length} type mappings) from server`);
              } else {
                console.warn(`[OpenBook] ⚠️ Segments found (${serverSegments.length}) but 0 storyboards written — check sceneToChapter mapping`);
              }
            } else {
              console.log(`[OpenBook] No storyboard segments found on server for ${allSceneIds.length} scenes`);
            }
          }
        } catch (storyErr) {
          console.warn("[OpenBook] Failed to restore storyboards from server:", storyErr);
        }

        if (pdfBlob) {
          const sourcePath = getSourcePath(bookFormat);
          try {
            await targetStorage.writeBlob(sourcePath, pdfBlob);
          } catch (err) {
            console.warn("[OpenBook] Failed to save source file to local project:", err);
          }
        }

        try {
          const projMeta = await targetStorage.readJSON<Record<string, unknown>>("project.json");
          if (projMeta) {
            projMeta.fileFormat = bookFormat;
            projMeta.updatedAt = new Date().toISOString();
            await targetStorage.writeJSON("project.json", projMeta);
          }
        } catch {}
      }

      const pdfStatus = restoredPdf
        ? ` (${t("pdfRestored", isRu)})`
        : ` (${t("pdfNotFound", isRu)})`;
      toast.success(`${t("bookLoaded", isRu)}: «${book.title}»${pdfStatus}`);
    } catch (err: any) {
      console.error("Failed to open book:", err);
      setErrorMsg(err.message || "Unknown error");
      setStep("error");
    }
  }, [
    userId,
    isRu,
    resolveLocalStorageForBook,
    restoreFromLocal,
    clearTransientBookState,
    updatePdfRef,
    updateTotalPages,
    setStep,
    setFileName,
    setBookId,
    setTocEntries,
    setChapterIdMap,
    setPartIdMap,
    setChapterResults,
    ensureWritableLocalStorage,
    setErrorMsg,
  ]);

  const ensurePdfLoaded = useCallback(async (): Promise<any> => {
    if (pdfRef) return pdfRef;
    if (!bookId) return null;

    const storage = await resolveLocalStorageForBook(bookId, { activate: false });

    let format: FileFormat = "pdf";
    if (storage?.isReady) {
      try {
        const meta = await storage.readJSON<Record<string, unknown>>("project.json");
        if (meta?.fileFormat === "docx") format = "docx";
      } catch {}
    }
    if (format === "pdf" && fileName && detectFileFormat(fileName) === "docx") {
      format = "docx";
    }

    if (format === "docx") {
      console.log("[EnsureSource] DOCX book — PDF proxy not needed");
      return null;
    }

    const loadPdf = async (arrayBuffer: ArrayBuffer) => {
      const { getDocument } = await import("pdfjs-dist");
      const pdf = await getDocument({ data: arrayBuffer }).promise;
      updatePdfRef(pdf);
      updateTotalPages(pdf.numPages);
      return pdf;
    };

    if (storage?.isReady) {
      try {
        const localBlob = await storage.readBlob(getSourcePath("pdf"));
        if (localBlob) {
          console.log("[EnsurePDF] Loading from local project");
          return await loadPdf(await localBlob.arrayBuffer());
        }
      } catch (err) {
        console.warn("[EnsurePDF] Local read failed:", err);
      }
    }

    // К3: No server fallback — PDF must be in OPFS.
    // If missing, user should re-download the book from library or re-upload the file.
    console.warn("[EnsurePDF] PDF not found in local project. Re-download from library or re-upload.");
    return null;
  }, [pdfRef, bookId, resolveLocalStorageForBook, fileName, updatePdfRef, updateTotalPages]);

  return {
    pdfRef,
    totalPages,
    restoreFromLocal,
    openSavedBook,
    ensurePdfLoaded,
  };
}
