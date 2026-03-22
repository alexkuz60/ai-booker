/**
 * projectPaths — centralized OPFS path resolver.
 *
 * V1 (flat):   scenes/chapter_{id}.json, storyboard/scene_{id}.json, characters/index.json
 * V2 (nested): chapters/{chapterId}/content.json, chapters/{chapterId}/scenes/{sceneId}/storyboard.json
 *
 * All code MUST use these helpers instead of hardcoding paths.
 * Layout is detected per-project (v1 projects auto-migrate to v2 on open).
 */

import { resolveChapterId } from "@/lib/sceneIndex";

export type LayoutVersion = "v1" | "v2";

/** Active layout for the current project — set by migrator/bootstrap */
let _activeLayout: LayoutVersion = "v2";

export function getActiveLayout(): LayoutVersion {
  return _activeLayout;
}

export function setActiveLayout(v: LayoutVersion): void {
  _activeLayout = v;
}

// ─── Helper: resolve chapterId for V2 paths ─────────────────

function requireChapterId(sceneId: string, provided?: string): string {
  if (provided) return provided;
  const cid = resolveChapterId(sceneId);
  if (!cid) {
    console.error(
      `[projectPaths] ❌ Cannot resolve chapterId for scene ${sceneId}! ` +
      `Scene index has ${Object.keys(getCachedSceneIndex()?.entries ?? {}).length} entries. ` +
      `This will cause data loss — writes will be skipped.`
    );
  }
  return cid ?? "__unresolved__";
}

// ─── Project-level paths ─────────────────────────────────────

export const paths = {
  /** Project metadata */
  projectMeta: () => "project.json",

  /** Scene index (V2 only, but always safe to read) */
  sceneIndex: () => "scene_index.json",

  // ── Structure ──────────────────────────────────────────

  /** TOC + parts snapshot */
  structureToc: () =>
    _activeLayout === "v1" ? "structure/toc.json" : "structure/toc.json",
    // Kept in structure/ even in V2 for compatibility — it's project-level data

  /** chapterIndex→uuid map */
  structureChapters: () => "structure/chapters.json",

  /** V1 legacy: characters saved by Parser */
  structureCharactersLegacy: () => "structure/characters.json",

  // ── Source file ────────────────────────────────────────

  sourceFile: (format: "pdf" | "docx" | "fb2") =>
    `source/book.${format}`,

  // ── Characters (global) ────────────────────────────────

  /** Global character index */
  characterIndex: () =>
    _activeLayout === "v1" ? "characters/index.json" : "characters.json",

  /** Directory containing scene-level character maps (V1 only) */
  characterDir: () =>
    _activeLayout === "v1" ? "characters" : null,

  /** Scene-level character mapping */
  sceneCharacterMap: (sceneId: string, chapterId?: string) =>
    _activeLayout === "v1"
      ? `characters/scene_${sceneId}.json`
      : `chapters/${requireChapterId(sceneId, chapterId)}/scenes/${sceneId}/characters.json`,

  // ── Chapter content (Parser scenes) ────────────────────

  /** Chapter content file (scenes array + status) */
  chapterContent: (chapterId: string) =>
    _activeLayout === "v1"
      ? `scenes/chapter_${chapterId}.json`
      : `chapters/${chapterId}/content.json`,

  /** Directory containing chapter content files — for listDir/cleanup */
  chapterContentDir: () =>
    _activeLayout === "v1" ? "scenes" : "chapters",

  /** Pattern test: is this filename a chapter content file? (V1 flat listing) */
  isChapterContentFile: (fileName: string): boolean =>
    _activeLayout === "v1"
      ? fileName.startsWith("chapter_") && fileName.endsWith(".json")
      : true, // V2: every dir in chapters/ is a chapter

  /** Extract chapterId from a chapter content file path */
  chapterIdFromFileName: (fileName: string): string | null => {
    if (_activeLayout === "v1") {
      const m = fileName.match(/^chapter_(.+)\.json$/);
      return m ? m[1] : null;
    }
    // V2: the directory name IS the chapterId
    return fileName;
  },

  // ── Storyboard (Studio segments) ───────────────────────

  /** Storyboard data for a scene */
  storyboard: (sceneId: string, chapterId?: string) =>
    _activeLayout === "v1"
      ? `storyboard/scene_${sceneId}.json`
      : `chapters/${requireChapterId(sceneId, chapterId)}/scenes/${sceneId}/storyboard.json`,

  /** Directory containing storyboard files (V1 only) */
  storyboardDir: (chapterId?: string) =>
    _activeLayout === "v1"
      ? "storyboard"
      : chapterId
        ? `chapters/${chapterId}/scenes`
        : "chapters",

  /** Extract sceneId from a storyboard filename (V1 only) */
  sceneIdFromStoryboardFile: (fileName: string): string | null => {
    if (_activeLayout === "v1") {
      const m = fileName.match(/^scene_(.+)\.json$/);
      return m ? m[1] : null;
    }
    // V2: the directory name IS the sceneId
    return fileName;
  },

  // ── Audio ──────────────────────────────────────────────

  /** TTS audio clip for a segment */
  ttsClip: (segmentId: string, sceneId?: string, chapterId?: string) =>
    _activeLayout === "v1"
      ? `audio/tts/${segmentId}.mp3`
      : `chapters/${requireChapterId(sceneId ?? "", chapterId)}/scenes/${sceneId}/audio/tts/${segmentId}.mp3`,

  /** Atmosphere audio layer */
  atmosphereClip: (fileName: string, sceneId?: string, chapterId?: string) =>
    _activeLayout === "v1"
      ? `audio/atmosphere/${fileName}`
      : `chapters/${requireChapterId(sceneId ?? "", chapterId)}/scenes/${sceneId}/audio/atmosphere/${fileName}`,

  /** Scene render stem */
  renderStem: (fileName: string, sceneId?: string, chapterId?: string) =>
    _activeLayout === "v1"
      ? `audio/renders/${fileName}`
      : `chapters/${requireChapterId(sceneId ?? "", chapterId)}/scenes/${sceneId}/audio/renders/${fileName}`,

  // ── Montage ────────────────────────────────────────────

  montageDir: () => "montage",
} as const;
