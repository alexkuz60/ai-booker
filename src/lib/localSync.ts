/**
 * Helpers for syncing book structure to local ProjectStorage.
 * Writes JSON snapshots of the book's structure so it can be restored offline.
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import type { TocChapter, Scene, ChapterStatus, LocalCharacter } from "@/pages/parser/types";
import {
  getLeafChapterIds,
  isFolderNode,
  sanitizeChapterResultsForStructure,
} from "@/lib/tocStructure";

export interface LocalBookStructure {
  bookId: string;
  title: string;
  fileName: string;
  updatedAt: string;
  parts: Array<{ id: string; title: string; partNumber: number }>;
  toc: TocChapter[];
}

export interface LocalChapterData {
  chapterId: string;
  chapterIndex: number;
  scenes: Scene[];
  status: ChapterStatus;
}

/**
 * Write full book structure (TOC, parts, chapter→id map) to local project.
 */
export async function syncStructureToLocal(
  storage: ProjectStorage,
  data: {
    bookId: string;
    title: string;
    fileName: string;
    toc: TocChapter[];
    parts: Array<{ id: string; title: string; partNumber: number }>;
    chapterIdMap: Map<number, string>;
    chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  },
): Promise<void> {
  try {
    // 1. Book structure (toc + parts)
    const structure: LocalBookStructure = {
      bookId: data.bookId,
      title: data.title,
      fileName: data.fileName,
      updatedAt: new Date().toISOString(),
      parts: data.parts,
      toc: data.toc,
    };
    await storage.writeJSON("structure/toc.json", structure);

    // 1b. Also update project.json updatedAt so sync-check works
    try {
      const projectMeta = await storage.readJSON<Record<string, unknown>>("project.json");
      if (projectMeta) {
        projectMeta.updatedAt = structure.updatedAt;
        await storage.writeJSON("project.json", projectMeta);
      }
    } catch {
      // non-critical — project.json may not exist yet
    }

    // 2. Chapter ID map
    const chapterMap: Record<string, string> = {};
    data.chapterIdMap.forEach((id, idx) => {
      chapterMap[String(idx)] = id;
    });
    await storage.writeJSON("structure/chapters.json", chapterMap);

    // 3. Per-chapter scene data (leaf-only)
    const sanitizedResults = sanitizeChapterResultsForStructure(data.toc, data.chapterResults);
    const leafChapterIds = new Set(getLeafChapterIds(data.toc, data.chapterIdMap));

    // Cleanup stale scene files from old structure (folders/removed chapters)
    const existingSceneFiles = await storage.listDir("scenes").catch(() => []);
    const staleSceneDeletes = existingSceneFiles
      .filter((f) => {
        const m = f.match(/^chapter_(.+)\.json$/);
        if (!m) return false;
        return !leafChapterIds.has(m[1]);
      })
      .map((f) => storage.delete(`scenes/${f}`).catch(() => undefined));

    const sceneWrites: Promise<void>[] = [];
    sanitizedResults.forEach((result, idx) => {
      if (isFolderNode(data.toc, idx)) return;
      const chapterId = data.chapterIdMap.get(idx);
      if (!chapterId) return;
      const chapterData: LocalChapterData = {
        chapterId,
        chapterIndex: idx,
        scenes: result.scenes,
        status: result.status,
      };
      sceneWrites.push(storage.writeJSON(`scenes/chapter_${chapterId}.json`, chapterData));
    });

    await Promise.all([...staleSceneDeletes, ...sceneWrites]);

    console.debug(`[LocalSync] Structure saved: ${data.toc.length} chapters, ${data.chapterResults.size} results`);
  } catch (err) {
    console.warn("[LocalSync] Failed to sync structure:", err);
  }
}

/**
 * Read book structure from local project.
 */
export async function readStructureFromLocal(
  storage: ProjectStorage,
): Promise<{
  structure: LocalBookStructure | null;
  chapterIdMap: Map<number, string>;
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
} | null> {
  try {
    const structure = await storage.readJSON<LocalBookStructure>("structure/toc.json");
    if (!structure) return null;

    // Chapter ID map
    const chapterMapRaw = await storage.readJSON<Record<string, string>>("structure/chapters.json");
    const chapterIdMap = new Map<number, string>();
    if (chapterMapRaw) {
      Object.entries(chapterMapRaw).forEach(([idx, id]) => {
        chapterIdMap.set(Number(idx), id);
      });
    }

    // Per-chapter results (ignore folder-scene files from legacy saves)
    const chapterResults = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
    const sceneFiles = await storage.listDir("scenes");
    const reads = sceneFiles
      .filter((f) => f.startsWith("chapter_") && f.endsWith(".json"))
      .map(async (f) => {
        const data = await storage.readJSON<LocalChapterData>(`scenes/${f}`);
        if (!data) return;

        if (Number.isNaN(data.chapterIndex) || isFolderNode(structure.toc, data.chapterIndex)) {
          return;
        }

        chapterResults.set(data.chapterIndex, {
          scenes: data.scenes,
          status: data.status,
        });
      });
    await Promise.all(reads);

    const sanitizedResults = sanitizeChapterResultsForStructure(structure.toc, chapterResults);
    return { structure, chapterIdMap, chapterResults: sanitizedResults };
  } catch (err) {
    console.warn("[LocalSync] Failed to read structure:", err);
    return null;
  }
}

// ─── Characters local persistence ────────────────────────────

export async function saveCharactersToLocal(
  storage: ProjectStorage,
  characters: LocalCharacter[],
): Promise<void> {
  try {
    await storage.writeJSON("structure/characters.json", characters);
    console.debug(`[LocalSync] Characters saved: ${characters.length}`);
  } catch (err) {
    console.warn("[LocalSync] Failed to save characters:", err);
  }
}

export async function readCharactersFromLocal(
  storage: ProjectStorage,
): Promise<LocalCharacter[]> {
  try {
    const data = await storage.readJSON<LocalCharacter[]>("structure/characters.json");
    return data || [];
  } catch {
    return [];
  }
}
