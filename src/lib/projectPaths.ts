/**
 * projectPaths — centralized OPFS path resolver (V2 nested layout).
 *
 * V2 layout:
 *   chapters/{chapterId}/content.json
 *   chapters/{chapterId}/scenes/{sceneId}/storyboard.json
 *   chapters/{chapterId}/scenes/{sceneId}/characters.json
 *   characters.json (root)
 *   scene_index.json
 *
 * All code MUST use these helpers instead of hardcoding paths.
 */

import { resolveChapterId, getCachedSceneIndex } from "@/lib/sceneIndex";

// ─── Helper: resolve chapterId for nested paths ─────────────

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

  /** Scene index */
  sceneIndex: () => "scene_index.json",

  // ── Structure ──────────────────────────────────────────

  /** TOC + parts snapshot */
  structureToc: () => "structure/toc.json",

  /** chapterIndex→uuid map */
  structureChapters: () => "structure/chapters.json",

  /** Legacy characters path (kept for migration reads) */
  structureCharactersLegacy: () => "structure/characters.json",

  // ── Source file ────────────────────────────────────────

  sourceFile: (format: "pdf" | "docx" | "fb2") =>
    `source/book.${format}`,

  // ── Characters (global) ────────────────────────────────

  /** Global character index */
  characterIndex: () => "characters.json",

  /** Scene-level character mapping */
  sceneCharacterMap: (sceneId: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId, chapterId)}/scenes/${sceneId}/characters.json`,

  // ── Chapter content (Parser scenes) ────────────────────

  /** Chapter content file (scenes array + status) */
  chapterContent: (chapterId: string) =>
    `chapters/${chapterId}/content.json`,

  /** Directory containing chapter content — for listDir/cleanup */
  chapterContentDir: () => "chapters",

  // ── Storyboard (Studio segments) ───────────────────────

  /** Storyboard data for a scene */
  storyboard: (sceneId: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId, chapterId)}/scenes/${sceneId}/storyboard.json`,

  /** Directory for listing storyboard scenes */
  storyboardDir: (chapterId?: string) =>
    chapterId
      ? `chapters/${chapterId}/scenes`
      : "chapters",

  // ── Audio ──────────────────────────────────────────────

  /** TTS audio clip for a segment */
  ttsClip: (segmentId: string, sceneId?: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId ?? "", chapterId)}/scenes/${sceneId}/audio/tts/${segmentId}.mp3`,

  /** Scene atmosphere/sfx clip metadata */
  sceneAtmospheres: (sceneId: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId, chapterId)}/scenes/${sceneId}/atmospheres.json`,

  /** Atmosphere audio layer */
  atmosphereClip: (fileName: string, sceneId?: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId ?? "", chapterId)}/scenes/${sceneId}/audio/atmosphere/${fileName}`,

  /** Scene render stem */
  renderStem: (fileName: string, sceneId?: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId ?? "", chapterId)}/scenes/${sceneId}/audio/renders/${fileName}`,

  // ── Montage ────────────────────────────────────────────

  montageDir: () => "montage",
} as const;
