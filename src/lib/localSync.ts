/**
 * Helpers for syncing book structure to local ProjectStorage (V2 layout).
 * Writes JSON snapshots of the book's structure so it can be restored offline.
 */

import { type ProjectStorage, getProjectTranslationLanguages } from "@/lib/projectStorage";

import type { TocChapter, Scene, ChapterStatus, LocalCharacter } from "@/pages/parser/types";
import {
  isFolderNode,
  sanitizeChapterResultsForStructure,
} from "@/lib/tocStructure";
import { paths } from "@/lib/projectPaths";
import { buildSceneIndex, writeSceneIndex, readSceneIndex } from "@/lib/sceneIndex";
import { getSceneFileDefaults, getTranslationFileDefaults } from "@/lib/bookTemplateOPFS";
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

    // Read translationLanguages from project.json for map & seed
    const projMeta = await storage.readJSON<Record<string, unknown>>(paths.projectMeta());
    const transLangs = getProjectTranslationLanguages(projMeta);

    // 3b. Seed empty scene-level JSON files (audio_meta, mixer_state, clip_plugins, translation)
    // Only creates files that don't already exist — never overwrites user data.
    const seedWrites: Promise<void>[] = [];
    sanitizedResults.forEach((result, idx) => {
      if (isFolderNode(data.toc, idx)) return;
      const chapterId = data.chapterIdMap.get(idx);
      if (!chapterId) return;
      for (const scene of result.scenes) {
        const sceneId = (scene as any).id;
        if (!sceneId) continue;
        seedWrites.push(seedEmptySceneFiles(storage, sceneId, chapterId, transLangs));
      }
    });
    await Promise.all(seedWrites);

    // 4. Build and write scene index
    const existingIndex = await readSceneIndex(storage);
    const sceneIndex = buildSceneIndex(data.chapterIdMap, sanitizedResults, existingIndex);
    await writeSceneIndex(storage, sceneIndex);

    // 5. Build and write book map (precomputed path map)
    const bookMap = buildBookMap(data.bookId, data.toc, data.chapterIdMap, sanitizedResults, transLangs);
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
    const projMeta = await storage.readJSON<Record<string, unknown>>(paths.projectMeta());
    const transLangs = getProjectTranslationLanguages(projMeta);
    let bookMap = await readBookMap(storage);
    if (!bookMap) {
      // book_map.json missing (legacy project or first restore) — rebuild it
      console.info("[LocalSync] book_map.json missing, rebuilding from structure");
      bookMap = buildBookMap(structure.bookId, structure.toc, chapterIdMap, sanitizedResults, transLangs);
      await writeBookMap(storage, bookMap);
    }

    // NOTE: No seeding here — readStructureFromLocal is a READ-ONLY operation.
    // All scene-level JSON files are created exclusively during syncStructureToLocal
    // (project creation / structure save). Lazy creation during reads risks race-condition
    // overwrites of existing data.

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
 * Create empty scene-level JSON files (and translation lang subfolders)
 * if they don't already exist. NEVER overwrites existing files — preserves user data.
 * All default values come from bookTemplateOPFS (single source of truth).
 */
async function seedEmptySceneFiles(
  storage: ProjectStorage,
  sceneId: string,
  chapterId: string,
  translationLanguages: string[] = [],
): Promise<void> {
  const base = `chapters/${chapterId}/scenes/${sceneId}`;

  // Collect all files to check: scene-level + per-language translation files
  const sceneDefaults = getSceneFileDefaults(sceneId);
  const sceneFiles = Object.keys(sceneDefaults);

  const langFileEntries: { path: string; defaultValue: unknown }[] = [];
  for (const lang of translationLanguages) {
    const transDefaults = getTranslationFileDefaults(sceneId);
    for (const [file, value] of Object.entries(transDefaults)) {
      langFileEntries.push({ path: `${base}/${lang}/${file}`, defaultValue: value });
    }
  }

  // Batch existence checks
  const allPaths = [
    ...sceneFiles.map((f) => `${base}/${f}`),
    ...langFileEntries.map((e) => e.path),
  ];
  const results = await Promise.all(allPaths.map((p) => storage.exists(p)));

  const writes: Promise<void>[] = [];

  // Seed scene-level files
  sceneFiles.forEach((file, i) => {
    if (results[i]) return;
    writes.push(storage.writeJSON(`${base}/${file}`, sceneDefaults[file]));
  });

  // Seed translation files
  const offset = sceneFiles.length;
  langFileEntries.forEach((entry, i) => {
    if (results[offset + i]) return;
    writes.push(storage.writeJSON(entry.path, entry.defaultValue));
  });

  if (writes.length > 0) {
    await Promise.all(writes);
    console.debug(`[LocalSync] Seeded ${writes.length} empty files for scene ${sceneId}`);
  }

  // Ensure empty subdirectories exist (tts/, audio/atmosphere/)
  for (const subDir of SCENE_DIRS) {
    const dirPath = `${base}/${subDir}`;
    if (!(await storage.exists(dirPath))) {
      // Write and delete a placeholder to force directory creation
      const placeholder = `${dirPath}/.keep`;
      await storage.writeJSON(placeholder, null);
      await storage.delete(placeholder);
    }
  }

  // Ensure translation audio subdirectories exist ({lang}/audio/tts/)
  for (const lang of translationLanguages) {
    for (const subDir of TRANSLATION_DIRS) {
      const dirPath = `${base}/${lang}/${subDir}`;
      if (!(await storage.exists(dirPath))) {
        const placeholder = `${dirPath}/.keep`;
        await storage.writeJSON(placeholder, null);
        await storage.delete(placeholder);
      }
    }
  }
}
