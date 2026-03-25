/**
 * Helpers for syncing book structure to local ProjectStorage (V2 layout).
 * Writes JSON snapshots of the book's structure so it can be restored offline.
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import type { TocChapter, Scene, ChapterStatus, LocalCharacter } from "@/pages/parser/types";
import {
  getLeafChapterIds,
  isFolderNode,
  sanitizeChapterResultsForStructure,
} from "@/lib/tocStructure";
import { paths } from "@/lib/projectPaths";
import { buildSceneIndex, writeSceneIndex, readSceneIndex } from "@/lib/sceneIndex";

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
    // ── Validation guard: refuse to overwrite with empty data ──
    if (!data.toc || data.toc.length === 0) {
      console.warn("[localSync] Refusing to save empty TOC — skipping write");
      return;
    }

    const invalidEntry = data.toc.find(
      (e) => !e.title || typeof e.startPage !== "number" || typeof e.endPage !== "number",
    );
    if (invalidEntry) {
      console.warn("[localSync] Invalid TOC entry detected, skipping write:", invalidEntry);
      return;
    }

    // 1. Book structure (toc + parts)
    const structure: LocalBookStructure = {
      bookId: data.bookId,
      title: data.title,
      fileName: data.fileName,
      updatedAt: new Date().toISOString(),
      parts: data.parts,
      toc: data.toc,
    };
    await storage.writeJSON(paths.structureToc(), structure);

    // 1b. Also update project.json updatedAt so sync-check works
    try {
      const projectMeta = await storage.readJSON<Record<string, unknown>>(paths.projectMeta());
      if (projectMeta) {
        projectMeta.updatedAt = structure.updatedAt;
        await storage.writeJSON(paths.projectMeta(), projectMeta);
      }
    } catch {
      // non-critical — project.json may not exist yet
    }

    // 2. Chapter ID map
    const chapterMap: Record<string, string> = {};
    data.chapterIdMap.forEach((id, idx) => {
      chapterMap[String(idx)] = id;
    });
    await storage.writeJSON(paths.structureChapters(), chapterMap);

    // 3. Per-chapter scene data (leaf-only)
    const sanitizedResults = sanitizeChapterResultsForStructure(data.toc, data.chapterResults);
    const leafChapterIds = new Set(getLeafChapterIds(data.toc, data.chapterIdMap));

    // Clean up stale chapter directories
    const existingChapters = await storage.listDir("chapters").catch(() => []);
    const staleDeletes = existingChapters
      .filter((dirName) => !leafChapterIds.has(dirName))
      .map((dirName) => storage.delete(`chapters/${dirName}`).catch(() => undefined));

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
      sceneWrites.push(storage.writeJSON(paths.chapterContent(chapterId), chapterData));
    });

    await Promise.all([...staleDeletes, ...sceneWrites]);

    // 4. Build and write scene index
    const existingIndex = await readSceneIndex(storage);
    const sceneIndex = buildSceneIndex(data.chapterIdMap, sanitizedResults, existingIndex);
    await writeSceneIndex(storage, sceneIndex);

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
    const structure = await storage.readJSON<LocalBookStructure>(paths.structureToc());
    if (!structure) return null;

    // Chapter ID map
    const chapterMapRaw = await storage.readJSON<Record<string, string>>(paths.structureChapters());
    const chapterIdMap = new Map<number, string>();
    if (chapterMapRaw) {
      Object.entries(chapterMapRaw).forEach(([idx, id]) => {
        chapterIdMap.set(Number(idx), id);
      });
    }

    // Per-chapter results: iterate chapter directories
    const chapterResults = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
    const chapterDirs = await storage.listDir("chapters").catch(() => []);
    const reads = chapterDirs.map(async (chapterId) => {
      const data = await storage.readJSON<LocalChapterData>(
        `chapters/${chapterId}/content.json`,
      );
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
    await storage.writeJSON(paths.structureCharactersLegacy(), characters);
    console.debug(`[LocalSync] Characters saved: ${characters.length}`);
  } catch (err) {
    console.warn("[LocalSync] Failed to save characters:", err);
  }
}

export async function readCharactersFromLocal(
  storage: ProjectStorage,
): Promise<LocalCharacter[]> {
  try {
    const data = await storage.readJSON<LocalCharacter[]>(paths.structureCharactersLegacy());
    return data || [];
  } catch {
    return [];
  }
}
