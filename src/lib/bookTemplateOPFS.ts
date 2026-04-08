/**
 * bookTemplateOPFS.ts — единый источник истины для структуры OPFS-проекта.
 *
 * Описывает полную иерархию папок и дефолтные значения всех JSON-файлов.
 * Используется при создании нового проекта (createNewProject) и при
 * засеве пустых файлов сцены (seedEmptySceneFiles).
 *
 * НИКАКОЙ другой модуль не должен хардкодить дефолтные значения —
 * все берётся отсюда.
 */

import {
  type ProjectMeta,
  PROJECT_META_VERSION,
  createEmptyPipelineProgress,
} from "@/lib/projectStorage";

// ─── Root-level directories ──────────────────────────────

/** Directories created at project root */
export const ROOT_DIRS = ["structure", "synopsis", "chapters"] as const;

/** Sub-directories created inside each chapter folder */
export const CHAPTER_DIRS = ["scenes", "renders"] as const;

// ─── Root-level file defaults ────────────────────────────

export function getProjectMetaDefault(
  title: string,
  bookId: string,
  userId: string,
  language: "ru" | "en",
): ProjectMeta {
  const now = new Date().toISOString();
  return {
    version: PROJECT_META_VERSION,
    bookId,
    title,
    userId,
    createdAt: now,
    updatedAt: now,
    language,
    pipelineProgress: createEmptyPipelineProgress(),
  };
}

export function getStructureDefaults(): {
  toc: { bookId: string; title: string; fileName: string; updatedAt: string; parts: never[]; toc: never[] };
  chapters: Record<string, never>;
} {
  return {
    toc: {
      bookId: "",
      title: "",
      fileName: "",
      updatedAt: new Date().toISOString(),
      parts: [],
      toc: [],
    },
    chapters: {},
  };
}

// ─── Chapter template ────────────────────────────────────

export function getChapterContentDefault(
  chapterId: string,
  chapterIndex: number,
): { chapterId: string; chapterIndex: number; scenes: never[]; status: string } {
  return {
    chapterId,
    chapterIndex,
    scenes: [],
    status: "pending",
  };
}

// ─── Scene template ──────────────────────────────────────

/** Sub-directories created inside each scene folder */
export const SCENE_DIRS = [
  "tts",
  "audio/atmosphere",
] as const;

/**
 * Returns a map of filename → default JSON value for all files
 * that must exist inside a scene folder.
 */
export function getSceneFileDefaults(sceneId: string): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    "storyboard.json": {
      sceneId,
      updatedAt: now,
      segments: [],
      typeMappings: [],
      audioStatus: {},
      inlineNarrationSpeaker: null,
    },
    "audio_meta.json": {
      sceneId,
      updatedAt: now,
      entries: {},
    },
    "mixer_state.json": {},
    "clip_plugins.json": {
      sceneId,
      updatedAt: now,
      configs: {},
    },
    "characters.json": {},
    "atmospheres.json": {
      sceneId,
      updatedAt: now,
      atmo: [],
      sfx: [],
    },
  };
}

// ─── Translation scene template ──────────────────────────

/** Translation scenes have NO audio subdirectories — audio is created
 *  by exporting the translation as a new standalone book project (see TODO). */

/**
 * Returns a map of filename → default JSON value for all files
 * that must exist inside a scene's translation sub-folder ({lang}/).
 */
export function getTranslationFileDefaults(sceneId: string): Record<string, unknown> {
  const now = new Date().toISOString();

  const radarDefault = {
    sceneId,
    updatedAt: now,
    segments: [],
  };

  return {
    "storyboard.json": {
      sceneId,
      updatedAt: now,
      segments: [],
      typeMappings: [],
      audioStatus: {},
      inlineNarrationSpeaker: null,
    },
    "radar-literal.json": { ...radarDefault },
    "radar-literary.json": { ...radarDefault },
    "radar-critique.json": { ...radarDefault },
    "audio_meta.json": {
      sceneId,
      updatedAt: now,
      entries: {},
    },
    "mixer_state.json": {},
    "clip_plugins.json": {
      sceneId,
      updatedAt: now,
      configs: {},
    },
  };
}
