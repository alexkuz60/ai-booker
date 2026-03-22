/**
 * projectPaths — centralized OPFS path resolver.
 *
 * V1 (flat):   scenes/chapter_{id}.json, storyboard/scene_{id}.json, characters/index.json
 * V2 (nested): chapters/{chapterId}/content.json, chapters/{chapterId}/scenes/{sceneId}/storyboard.json
 *
 * All code MUST use these helpers instead of hardcoding paths.
 * When we flip LAYOUT to "v2", every consumer switches automatically.
 */

export type LayoutVersion = "v1" | "v2";

/** Current layout version — flip this once migration is complete */
export const LAYOUT: LayoutVersion = "v1";

// ─── Project-level paths ─────────────────────────────────────

export const paths = {
  /** Project metadata */
  projectMeta: () => "project.json",

  // ── Structure (V1 only — in V2 these are embedded in project.json) ──

  /** V1: TOC + parts snapshot */
  structureToc: () => (LAYOUT === "v1" ? "structure/toc.json" : "project.json"),

  /** V1: chapterIndex→uuid map */
  structureChapters: () =>
    LAYOUT === "v1" ? "structure/chapters.json" : "project.json",

  /** V1 legacy: characters saved by Parser */
  structureCharactersLegacy: () => "structure/characters.json",

  // ── Source file ────────────────────────────────────────────

  sourceFile: (format: "pdf" | "docx" | "fb2") =>
    `source/book.${format}`,

  // ── Characters (global) ────────────────────────────────────

  /** Global character index */
  characterIndex: () =>
    LAYOUT === "v1" ? "characters/index.json" : "characters.json",

  /** Directory containing scene-level character maps (V1) */
  characterDir: () =>
    LAYOUT === "v1" ? "characters" : null, // V2 uses per-scene path

  /** Scene-level character mapping */
  sceneCharacterMap: (sceneId: string, chapterId?: string) =>
    LAYOUT === "v1"
      ? `characters/scene_${sceneId}.json`
      : `chapters/${chapterId}/scenes/${sceneId}/characters.json`,

  // ── Chapter content (Parser scenes) ────────────────────────

  /** Chapter content file (scenes array + status) */
  chapterContent: (chapterId: string) =>
    LAYOUT === "v1"
      ? `scenes/chapter_${chapterId}.json`
      : `chapters/${chapterId}/content.json`,

  /** Directory containing chapter files — for listDir/cleanup */
  chapterContentDir: () =>
    LAYOUT === "v1" ? "scenes" : "chapters",

  /** Pattern test: is this filename a chapter content file? */
  isChapterContentFile: (fileName: string): boolean =>
    LAYOUT === "v1"
      ? fileName.startsWith("chapter_") && fileName.endsWith(".json")
      : fileName === "content.json",

  /** Extract chapterId from a chapter content file path (V1 only) */
  chapterIdFromFileName: (fileName: string): string | null => {
    if (LAYOUT === "v1") {
      const m = fileName.match(/^chapter_(.+)\.json$/);
      return m ? m[1] : null;
    }
    // V2: chapterId is the directory name, not embedded in file name
    return null;
  },

  // ── Storyboard (Studio segments) ───────────────────────────

  /** Storyboard data for a scene */
  storyboard: (sceneId: string, chapterId?: string) =>
    LAYOUT === "v1"
      ? `storyboard/scene_${sceneId}.json`
      : `chapters/${chapterId}/scenes/${sceneId}/storyboard.json`,

  /** Directory containing storyboard files — for listDir */
  storyboardDir: (chapterId?: string) =>
    LAYOUT === "v1"
      ? "storyboard"
      : `chapters/${chapterId}/scenes`,

  /** Extract sceneId from a storyboard filename (V1) */
  sceneIdFromStoryboardFile: (fileName: string): string | null => {
    if (LAYOUT === "v1") {
      const m = fileName.match(/^scene_(.+)\.json$/);
      return m ? m[1] : null;
    }
    return null;
  },

  // ── Audio ──────────────────────────────────────────────────

  /** TTS audio clip for a segment */
  ttsClip: (segmentId: string, sceneId?: string, chapterId?: string) =>
    LAYOUT === "v1"
      ? `audio/tts/${segmentId}.mp3`
      : `chapters/${chapterId}/scenes/${sceneId}/audio/tts/${segmentId}.mp3`,

  /** Atmosphere audio layer */
  atmosphereClip: (fileName: string, sceneId?: string, chapterId?: string) =>
    LAYOUT === "v1"
      ? `audio/atmosphere/${fileName}`
      : `chapters/${chapterId}/scenes/${sceneId}/audio/atmosphere/${fileName}`,

  /** Scene render stem */
  renderStem: (fileName: string, sceneId?: string, chapterId?: string) =>
    LAYOUT === "v1"
      ? `audio/renders/${fileName}`
      : `chapters/${chapterId}/scenes/${sceneId}/audio/renders/${fileName}`,

  // ── Montage ────────────────────────────────────────────────

  montageDir: () => "montage",
} as const;
