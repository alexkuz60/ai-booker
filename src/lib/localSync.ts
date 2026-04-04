/**
 * Helpers for syncing book structure to local ProjectStorage (V2 layout).
 * Writes JSON snapshots of the book's structure so it can be restored offline.
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import { DEFAULT_CLIP_PLUGIN_CONFIG } from "@/hooks/useClipPluginConfigs";
import type { TocChapter, Scene, ChapterStatus, LocalCharacter } from "@/pages/parser/types";
import {
  isFolderNode,
  sanitizeChapterResultsForStructure,
} from "@/lib/tocStructure";
import { paths } from "@/lib/projectPaths";
import { buildSceneIndex, writeSceneIndex, readSceneIndex } from "@/lib/sceneIndex";
import { writePipelineStep } from "@/hooks/usePipelineProgress";
import { buildBookMap, writeBookMap, readBookMap } from "@/lib/bookMap";

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
        const { sanitizeProjectMeta } = await import("@/lib/projectStorage");
        await storage.writeJSON(paths.projectMeta(), sanitizeProjectMeta({
          ...projectMeta,
          updatedAt: structure.updatedAt,
        }));
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

    // NOTE: No automatic deletion of chapter or scene directories.
    // Deletion of user data is ONLY allowed via explicit user action (delete button).
    // "Stale" directories are harmless — they just take disk space.

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

    await Promise.all(sceneWrites);

    // 3b. Seed empty scene-level JSON files (audio_meta, mixer_state, clip_plugins)
    // Only creates files that don't already exist — never overwrites user data.
    const seedWrites: Promise<void>[] = [];
    sanitizedResults.forEach((result, idx) => {
      if (isFolderNode(data.toc, idx)) return;
      const chapterId = data.chapterIdMap.get(idx);
      if (!chapterId) return;
      for (const scene of result.scenes) {
        const sceneId = (scene as any).id;
        if (!sceneId) continue;
        seedWrites.push(seedEmptySceneFiles(storage, sceneId, chapterId));
      }
    });
    await Promise.all(seedWrites);

    // 4. Build and write scene index
    const existingIndex = await readSceneIndex(storage);
    const sceneIndex = buildSceneIndex(data.chapterIdMap, sanitizedResults, existingIndex);
    await writeSceneIndex(storage, sceneIndex);

    // 5. Build and write book map (precomputed path map)
    const bookMap = buildBookMap(data.bookId, data.toc, data.chapterIdMap, sanitizedResults);
    await writeBookMap(storage, bookMap);

    // ── Auto-set pipeline flags ──
    await writePipelineStep(storage, "toc_extracted", true);
    const hasScenes = Array.from(data.chapterResults.values()).some(r => r.scenes.length > 0);
    if (hasScenes) {
      await writePipelineStep(storage, "scenes_analyzed", true);
    }

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

    // Load or rebuild book map
    let bookMap = await readBookMap(storage);
    if (!bookMap) {
      // book_map.json missing (legacy project or first restore) — rebuild it
      console.info("[LocalSync] book_map.json missing, rebuilding from structure");
      bookMap = buildBookMap(structure.bookId, structure.toc, chapterIdMap, sanitizedResults);
      await writeBookMap(storage, bookMap);
    }

    // Seed empty scene-level files for any scenes that are missing them
    const seedPromises: Promise<void>[] = [];
    sanitizedResults.forEach((result, idx) => {
      if (isFolderNode(structure.toc, idx)) return;
      const chapterId = chapterIdMap.get(idx);
      if (!chapterId) return;
      for (const scene of result.scenes) {
        const sceneId = (scene as any).id;
        if (!sceneId) continue;
        seedPromises.push(seedEmptySceneFiles(storage, sceneId, chapterId));
      }
    });
    if (seedPromises.length > 0) await Promise.all(seedPromises);

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

// ─── Seed empty scene-level files ────────────────────────────

/**
 * Create empty audio_meta.json, mixer_state.json, clip_plugins.json
 * for a scene if they don't already exist.
 * NEVER overwrites existing files — preserves user data.
 */
async function seedEmptySceneFiles(
  storage: ProjectStorage,
  sceneId: string,
  chapterId: string,
): Promise<void> {
  const base = `chapters/${chapterId}/scenes/${sceneId}`;

  const audioMetaPath = `${base}/audio_meta.json`;
  const mixerStatePath = `${base}/mixer_state.json`;
  const clipPluginsPath = `${base}/clip_plugins.json`;

  const [hasAudio, hasMixer, hasClip] = await Promise.all([
    storage.exists(audioMetaPath),
    storage.exists(mixerStatePath),
    storage.exists(clipPluginsPath),
  ]);

  const writes: Promise<void>[] = [];

  if (!hasAudio) {
    writes.push(storage.writeJSON(audioMetaPath, {
      sceneId,
      updatedAt: new Date().toISOString(),
      entries: {},
    }));
  }

  if (!hasMixer) {
    writes.push(storage.writeJSON(mixerStatePath, {}));
  }

  if (!hasClip) {
    writes.push(storage.writeJSON(clipPluginsPath, {
      sceneId,
      updatedAt: new Date().toISOString(),
      configs: {},
    }));
  }

  if (writes.length > 0) {
    await Promise.all(writes);
    console.debug(`[LocalSync] Seeded ${writes.length} empty files for scene ${sceneId}`);
  }
}
