/**
 * bookMap — precomputed path map for every entity in the book.
 *
 * Persisted to `book_map.json` in OPFS project root.
 * Generated once when structure is created/modified.
 * Used as the AUTHORITATIVE source for path resolution.
 *
 * Principle: "Book structure = project map".
 * All paths are deterministic — derived from TOC, not discovered.
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import type { Scene, ChapterStatus } from "@/pages/parser/types";
import { isFolderNode } from "@/lib/tocStructure";
import type { TocChapter } from "@/pages/parser/types";

// ─── Types ──────────────────────────────────────────────────

export interface TranslationPathEntry {
  storyboard: string;
  radarLiteral: string;
  radarLiterary: string;
  radarCritique: string;
  audioMeta: string;
  mixerState: string;
  clipPlugins: string;
  ttsDir: string;
}

export interface ScenePathEntry {
  sceneNumber: number;
  basePath: string;
  storyboard: string;
  audioMeta: string;
  mixerState: string;
  clipPlugins: string;
  characters: string;
  atmospheres: string;
  ttsDir: string;
  atmosphereDir: string;
  rendersDir: string;
  /** Language subfolders for translations (e.g. { en: { ... } }) */
  translations: Record<string, TranslationPathEntry>;
}

export interface ChapterMapEntry {
  index: number;
  contentPath: string;
  scenesDir: string;
  scenes: Record<string, ScenePathEntry>;
}

export interface BookMap {
  version: 1;
  bookId: string;
  updatedAt: string;
  chapters: Record<string, ChapterMapEntry>;
  /** Flat sceneId → chapterId lookup for fast resolution */
  sceneToChapter: Record<string, string>;
}

const BOOK_MAP_PATH = "book_map.json";

// ─── In-memory cache ────────────────────────────────────────

let _cachedBookMap: BookMap | null = null;

export function getCachedBookMap(): BookMap | null {
  return _cachedBookMap;
}

export function setCachedBookMap(map: BookMap | null): void {
  _cachedBookMap = map;
}

// ─── Build ──────────────────────────────────────────────────

export function buildBookMap(
  bookId: string,
  toc: TocChapter[],
  chapterIdMap: Map<number, string>,
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>,
): BookMap {
  const chapters: Record<string, ChapterMapEntry> = {};
  const sceneToChapter: Record<string, string> = {};

  chapterResults.forEach((result, chapterIndex) => {
    if (isFolderNode(toc, chapterIndex)) return;
    const chapterId = chapterIdMap.get(chapterIndex);
    if (!chapterId) return;

    const scenes: Record<string, ScenePathEntry> = {};
    result.scenes.forEach((scene, i) => {
      const sceneId = (scene as any).id;
      if (!sceneId) return;

      const base = `chapters/${chapterId}/scenes/${sceneId}`;
      scenes[sceneId] = {
        sceneNumber: i + 1,
        basePath: base,
        storyboard: `${base}/storyboard.json`,
        audioMeta: `${base}/audio_meta.json`,
        mixerState: `${base}/mixer_state.json`,
        clipPlugins: `${base}/clip_plugins.json`,
        characters: `${base}/characters.json`,
        atmospheres: `${base}/atmospheres.json`,
        ttsDir: `${base}/audio/tts`,
        atmosphereDir: `${base}/audio/atmosphere`,
        rendersDir: `${base}/audio/renders`,
      };
      sceneToChapter[sceneId] = chapterId;
    });

    chapters[chapterId] = {
      index: chapterIndex,
      contentPath: `chapters/${chapterId}/content.json`,
      scenesDir: `chapters/${chapterId}/scenes`,
      scenes,
    };
  });

  return {
    version: 1,
    bookId,
    updatedAt: new Date().toISOString(),
    chapters,
    sceneToChapter,
  };
}

// ─── Persistence ────────────────────────────────────────────

export async function writeBookMap(
  storage: ProjectStorage,
  map: BookMap,
): Promise<void> {
  try {
    map.updatedAt = new Date().toISOString();
    await storage.writeJSON(BOOK_MAP_PATH, map);
    _cachedBookMap = map;
    console.debug(
      `[BookMap] Written: ${Object.keys(map.chapters).length} chapters, ` +
      `${Object.keys(map.sceneToChapter).length} scenes`,
    );
  } catch (err) {
    console.warn("[BookMap] Failed to write:", err);
  }
}

export async function readBookMap(
  storage: ProjectStorage,
): Promise<BookMap | null> {
  try {
    const data = await storage.readJSON<BookMap>(BOOK_MAP_PATH);
    if (data?.version === 1) {
      _cachedBookMap = data;
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Resolution (primary lookup) ────────────────────────────

/** Resolve chapterId for a sceneId from the cached book map */
export function resolveChapterFromMap(sceneId: string): string | undefined {
  return _cachedBookMap?.sceneToChapter[sceneId];
}

/** Get full scene path entry from cached book map */
export function getScenePaths(sceneId: string): ScenePathEntry | undefined {
  const chapterId = _cachedBookMap?.sceneToChapter[sceneId];
  if (!chapterId) return undefined;
  return _cachedBookMap?.chapters[chapterId]?.scenes[sceneId];
}

/** Get chapter path entry from cached book map */
export function getChapterPaths(chapterId: string): ChapterMapEntry | undefined {
  return _cachedBookMap?.chapters[chapterId];
}

// ─── Diagnostics ────────────────────────────────────────────

/**
 * Compare a computed path against the book map path.
 * Logs error on mismatch — these are code bugs.
 */
export function diagnosePath(
  label: string,
  computedPath: string,
  sceneId: string,
  pathKey: keyof ScenePathEntry,
): void {
  const entry = getScenePaths(sceneId);
  if (!entry) return; // map not loaded or scene not in map — skip silently
  const mapPath = entry[pathKey];
  if (mapPath !== computedPath) {
    console.error(
      `[BookMap] ❌ PATH MISMATCH in ${label}:\n` +
      `  map:      ${mapPath}\n` +
      `  computed: ${computedPath}\n` +
      `  sceneId:  ${sceneId}`,
    );
  }
}
