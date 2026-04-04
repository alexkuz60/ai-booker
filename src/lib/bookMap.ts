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
  translationLanguages: string[] = [],
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

      // Build translation path entries for each active language
      const translations: Record<string, TranslationPathEntry> = {};
      for (const lang of translationLanguages) {
        const langBase = `${base}/${lang}`;
        translations[lang] = {
          storyboard: `${langBase}/storyboard.json`,
          radarLiteral: `${langBase}/radar-literal.json`,
          radarLiterary: `${langBase}/radar-literary.json`,
          radarCritique: `${langBase}/radar-critique.json`,
          audioMeta: `${langBase}/audio_meta.json`,
          mixerState: `${langBase}/mixer_state.json`,
          clipPlugins: `${langBase}/clip_plugins.json`,
          ttsDir: `${langBase}/audio/tts`,
        };
      }

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
        translations,
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

// ─── Integrity validation ───────────────────────────────────

/** JSON file keys from ScenePathEntry to validate */
const SCENE_JSON_KEYS: (keyof ScenePathEntry)[] = [
  "storyboard", "audioMeta", "mixerState", "clipPlugins", "characters", "atmospheres",
];

/** JSON file keys from TranslationPathEntry to validate */
const TRANS_JSON_KEYS: (keyof TranslationPathEntry)[] = [
  "storyboard", "radarLiteral", "radarLiterary", "radarCritique",
  "audioMeta", "mixerState", "clipPlugins",
];

/** Human-readable labels for toast messages */
const PATH_LABELS: Record<string, Record<string, string>> = {
  ru: {
    "book_map.json": "Карта книги",
    "project.json": "Метаданные проекта",
    "characters.json": "Реестр персонажей",
    storyboard: "Раскадровка",
    audioMeta: "Аудио-метаданные",
    mixerState: "Настройки микшера",
    clipPlugins: "Настройки плагинов",
    characters: "Персонажи сцены",
    atmospheres: "Атмосфера сцены",
    contentPath: "Текст главы",
    radarLiteral: "Радар (буквальный)",
    radarLiterary: "Радар (литературный)",
    radarCritique: "Радар (критика)",
  },
  en: {
    "book_map.json": "Book map",
    "project.json": "Project metadata",
    "characters.json": "Character registry",
    storyboard: "Storyboard",
    audioMeta: "Audio metadata",
    mixerState: "Mixer settings",
    clipPlugins: "Plugin settings",
    characters: "Scene characters",
    atmospheres: "Scene atmospheres",
    contentPath: "Chapter text",
    radarLiteral: "Radar (literal)",
    radarLiterary: "Radar (literary)",
    radarCritique: "Radar (critique)",
  },
};

function label(key: string, isRu: boolean): string {
  return (isRu ? PATH_LABELS.ru[key] : PATH_LABELS.en[key]) || key;
}

/**
 * Validate that all JSON files referenced in the book map actually exist in storage.
 * Returns an array of human-readable error strings for missing files.
 * Does NOT attempt any repairs — report only.
 */
export async function validateBookMapIntegrity(
  storage: ProjectStorage,
  map: BookMap,
  isRu: boolean,
): Promise<string[]> {
  const missing: string[] = [];

  // Root-level files
  for (const rootFile of ["project.json", "characters.json"]) {
    const exists = await storage.exists(rootFile).catch(() => false);
    if (!exists) {
      missing.push(`${label(rootFile, isRu)}: ${rootFile}`);
    }
  }

  // Per-chapter
  for (const [chapterId, chapter] of Object.entries(map.chapters)) {
    // content.json
    const contentExists = await storage.exists(chapter.contentPath).catch(() => false);
    if (!contentExists) {
      missing.push(`${label("contentPath", isRu)} (ch ${chapter.index}): ${chapter.contentPath}`);
    }

    // Per-scene JSON files
    for (const [sceneId, scene] of Object.entries(chapter.scenes)) {
      for (const key of SCENE_JSON_KEYS) {
        const path = scene[key];
        if (typeof path !== "string") continue;
        const exists = await storage.exists(path).catch(() => false);
        if (!exists) {
          missing.push(`${label(key, isRu)} (сц.${scene.sceneNumber}): ${path}`);
        }
      }

      // Translation subfolders
      for (const [lang, trans] of Object.entries(scene.translations)) {
        for (const tKey of TRANS_JSON_KEYS) {
          const path = trans[tKey];
          if (typeof path !== "string") continue;
          const exists = await storage.exists(path).catch(() => false);
          if (!exists) {
            missing.push(`[${lang}] ${label(tKey, isRu)} (сц.${scene.sceneNumber}): ${path}`);
          }
        }
      }
    }
  }

  return missing;
}
