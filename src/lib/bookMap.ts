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
  /** Language subfolders for translations (e.g. { en: { ... } }) */
  translations: Record<string, TranslationPathEntry>;
}

export interface ChapterMapEntry {
  index: number;
  contentPath: string;
  scenesDir: string;
  rendersDir: string;
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
        ttsDir: `${base}/tts`,
        atmosphereDir: `${base}/audio/atmosphere`,
        translations,
      };
      sceneToChapter[sceneId] = chapterId;
    });

    chapters[chapterId] = {
      index: chapterIndex,
      contentPath: `chapters/${chapterId}/content.json`,
      scenesDir: `chapters/${chapterId}/scenes`,
      rendersDir: `chapters/${chapterId}/renders`,
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
  "storyboard", "audioMeta", "mixerState", "clipPlugins", "characters",
  // NOTE: "atmospheres" intentionally excluded — optional data, created on first use
];

/** JSON file keys from TranslationPathEntry to validate */
const TRANS_JSON_KEYS: (keyof TranslationPathEntry)[] = [
  "storyboard", "radarLiteral", "radarLiterary", "radarCritique",
  // NOTE: "audioMeta", "mixerState", "clipPlugins" intentionally excluded — created lazily
];

export interface BookMapIntegrityIssue {
  message: string;
  description: string;
  path: string;
}

type IntegrityMessageKey =
  | "projectMeta"
  | "characterRegistry"
  | "chapterContent"
  | "storyboard"
  | "audioMeta"
  | "mixerState"
  | "clipPlugins"
  | "sceneCharacters"
  | "atmospheres"
  | "translationStoryboard"
  | "translationAudioMeta"
  | "translationMixerState"
  | "translationClipPlugins"
  | "radarLiteral"
  | "radarLiterary"
  | "radarCritique";

const INTEGRITY_MESSAGES: Record<"ru" | "en", Record<IntegrityMessageKey, string>> = {
  ru: {
    projectMeta: "Не могу загрузить метаданные проекта",
    characterRegistry: "Не могу загрузить реестр персонажей",
    chapterContent: "Не могу загрузить текст главы",
    storyboard: "Не могу загрузить раскадровку",
    audioMeta: "Не могу загрузить аудио-метаданные",
    mixerState: "Не могу загрузить настройки микшера для студии",
    clipPlugins: "Не могу загрузить настройки плагинов для студии",
    sceneCharacters: "Не могу загрузить персонажей сцены",
    atmospheres: "Не могу загрузить атмосферу сцены",
    translationStoryboard: "Не могу загрузить перевод книги",
    translationAudioMeta: "Не могу загрузить аудио-метаданные перевода",
    translationMixerState: "Не могу загрузить настройки микшера перевода",
    translationClipPlugins: "Не могу загрузить настройки плагинов перевода",
    radarLiteral: "Не могу загрузить данные буквального перевода",
    radarLiterary: "Не могу загрузить данные литературного перевода",
    radarCritique: "Не могу загрузить критику перевода",
  },
  en: {
    projectMeta: "Can't load project metadata",
    characterRegistry: "Can't load character registry",
    chapterContent: "Can't load chapter text",
    storyboard: "Can't load storyboard",
    audioMeta: "Can't load audio metadata",
    mixerState: "Can't load studio mixer settings",
    clipPlugins: "Can't load studio plugin settings",
    sceneCharacters: "Can't load scene characters",
    atmospheres: "Can't load scene atmosphere",
    translationStoryboard: "Can't load book translation",
    translationAudioMeta: "Can't load translation audio metadata",
    translationMixerState: "Can't load translation mixer settings",
    translationClipPlugins: "Can't load translation plugin settings",
    radarLiteral: "Can't load literal translation data",
    radarLiterary: "Can't load literary translation data",
    radarCritique: "Can't load translation critique",
  },
};

function getIntegrityMessage(key: IntegrityMessageKey, isRu: boolean): string {
  return INTEGRITY_MESSAGES[isRu ? "ru" : "en"][key];
}

function createIntegrityIssue(
  key: IntegrityMessageKey,
  path: string,
  isRu: boolean,
): BookMapIntegrityIssue {
  return {
    message: getIntegrityMessage(key, isRu),
    description: path,
    path,
  };
}

function getSceneIntegrityMessageKey(key: keyof ScenePathEntry): IntegrityMessageKey | null {
  switch (key) {
    case "storyboard":
      return "storyboard";
    case "audioMeta":
      return "audioMeta";
    case "mixerState":
      return "mixerState";
    case "clipPlugins":
      return "clipPlugins";
    case "characters":
      return "sceneCharacters";
    case "atmospheres":
      return "atmospheres";
    default:
      return null;
  }
}

function getTranslationIntegrityMessageKey(key: keyof TranslationPathEntry): IntegrityMessageKey | null {
  switch (key) {
    case "storyboard":
      return "translationStoryboard";
    case "audioMeta":
      return "translationAudioMeta";
    case "mixerState":
      return "translationMixerState";
    case "clipPlugins":
      return "translationClipPlugins";
    case "radarLiteral":
      return "radarLiteral";
    case "radarLiterary":
      return "radarLiterary";
    case "radarCritique":
      return "radarCritique";
    default:
      return null;
  }
}

/**
 * Validate that ALL JSON files referenced in the book map exist in storage.
 * Returns the FIRST missing file as a fail-fast diagnostic issue.
 * Does NOT attempt any repairs — report only.
 */
export async function validateBookMapIntegrity(
  storage: ProjectStorage,
  map: BookMap,
  isRu: boolean,
): Promise<BookMapIntegrityIssue | null> {

  // Root-level files
  for (const rootFile of ["project.json", "characters.json"] as const) {
    const exists = await storage.exists(rootFile).catch(() => false);
    if (!exists) {
      return createIntegrityIssue(
        rootFile === "project.json" ? "projectMeta" : "characterRegistry",
        rootFile,
        isRu,
      );
    }
  }

  // Per-chapter + per-scene + per-translation
  for (const [_chapterId, chapter] of Object.entries(map.chapters)) {
    const contentExists = await storage.exists(chapter.contentPath).catch(() => false);
    if (!contentExists) {
      return createIntegrityIssue("chapterContent", chapter.contentPath, isRu);
    }

    for (const [_sceneId, scene] of Object.entries(chapter.scenes)) {
      for (const key of SCENE_JSON_KEYS) {
        const path = scene[key];
        if (typeof path !== "string") continue;
        const exists = await storage.exists(path).catch(() => false);
        if (!exists) {
          const messageKey = getSceneIntegrityMessageKey(key);
          if (messageKey) {
            return createIntegrityIssue(messageKey, path, isRu);
          }
        }
      }

      // Translation files
      for (const [lang, trans] of Object.entries(scene.translations)) {
        for (const tKey of TRANS_JSON_KEYS) {
          const path = trans[tKey];
          if (typeof path !== "string") continue;
          const exists = await storage.exists(path).catch(() => false);
          if (!exists) {
            const messageKey = getTranslationIntegrityMessageKey(tKey);
            if (messageKey) {
              return createIntegrityIssue(messageKey, path, isRu);
            }
          }
        }
      }
    }
  }

  return null;
}
