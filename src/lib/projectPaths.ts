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
import { resolveChapterFromMap, getCachedBookMap } from "@/lib/bookMap";

// ─── Helper: resolve chapterId for nested paths ─────────────

function requireChapterId(sceneId: string, provided?: string): string {
  if (provided) return provided;

  // 1. Primary: book map (precomputed, authoritative)
  const fromMap = resolveChapterFromMap(sceneId);
  if (fromMap) {
    // Diagnostic: cross-check with scene index
    const fromIndex = resolveChapterId(sceneId);
    if (fromIndex && fromIndex !== fromMap) {
      console.error(
        `[projectPaths] ❌ MISMATCH: bookMap says chapterId=${fromMap}, ` +
        `sceneIndex says ${fromIndex} for scene ${sceneId}`,
      );
    }
    return fromMap;
  }

  // 2. Fallback: scene index (for backward compat during migration)
  const fromIndex = resolveChapterId(sceneId);
  if (fromIndex) return fromIndex;

  const mapSize = Object.keys(getCachedBookMap()?.sceneToChapter ?? {}).length;
  const indexSize = Object.keys(getCachedSceneIndex()?.entries ?? {}).length;
  console.error(
    `[projectPaths] ❌ Cannot resolve chapterId for scene ${sceneId}! ` +
    `BookMap has ${mapSize} scenes, SceneIndex has ${indexSize} entries. ` +
    `This will cause data loss — writes will be skipped.`,
  );
  return "__unresolved__";
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

  // ── Audio metadata (segment_audio mirror) ──────────────

  /** Per-scene audio metadata (durations, paths, status) — replaces DB reads */
  audioMeta: (sceneId: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId, chapterId)}/scenes/${sceneId}/audio_meta.json`,

  // ── Clip plugin configs ───────────────────────────────

  /** Per-scene clip plugin configurations — replaces DB reads */
  clipPlugins: (sceneId: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId, chapterId)}/scenes/${sceneId}/clip_plugins.json`,

  /** Per-scene mixer state (volume, pan, preFx, reverb) + channel plugins (EQ, comp, limiter) */
  mixerState: (sceneId: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId, chapterId)}/scenes/${sceneId}/mixer_state.json`,

  // ── Translation (lang-subfolder within scene) ────────

  /** Translation storyboard: chapters/{ch}/scenes/{sc}/{lang}/storyboard.json */
  translationStoryboard: (sceneId: string, lang: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId, chapterId)}/scenes/${sceneId}/${lang}/storyboard.json`,

  /** Translation radar file: chapters/{ch}/scenes/{sc}/{lang}/radar-{stage}.json */
  translationRadar: (sceneId: string, lang: string, stage: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId, chapterId)}/scenes/${sceneId}/${lang}/radar-${stage}.json`,

  /** Translation TTS clip */
  translationTtsClip: (segmentId: string, sceneId: string, lang: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId, chapterId)}/scenes/${sceneId}/${lang}/audio/tts/${segmentId}.mp3`,

  /** Translation audio metadata */
  translationAudioMeta: (sceneId: string, lang: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId, chapterId)}/scenes/${sceneId}/${lang}/audio_meta.json`,

  /** Translation mixer state */
  translationMixerState: (sceneId: string, lang: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId, chapterId)}/scenes/${sceneId}/${lang}/mixer_state.json`,

  /** Translation clip plugins */
  translationClipPlugins: (sceneId: string, lang: string, chapterId?: string) =>
    `chapters/${requireChapterId(sceneId, chapterId)}/scenes/${sceneId}/${lang}/clip_plugins.json`,

  // ── Montage ────────────────────────────────────────────

  montageDir: () => "montage",
} as const;
