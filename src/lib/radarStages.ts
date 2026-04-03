/**
 * Staged radar data types and file helpers.
 *
 * Three files per scene (in translation project):
 *   - radar-literal.json   → 3R polygon (semantic, rhythm, phonetic)
 *   - radar-literary.json  → 5R polygon (all 5 axes)
 *   - radar-critique.json  → 5R + alternatives
 */

import type { RadarScores } from "./qualityRadar";
import type { ProjectStorage } from "./projectStorage";

// ── Types ────────────────────────────────────────────────────────────────────

export type RadarStage = "literal" | "literary" | "critique";

/** Per-segment radar data at one stage */
export interface StageSegmentRadar {
  segmentId: string;
  radar: RadarScores;
  /** Critique notes (literary/critique stages) */
  critiqueNotes?: string[];
  /** Literal text (literal stage) */
  literal?: string;
  /** Literary text (literary/critique stages) */
  literary?: string;
}

/** Critique alternative for one segment */
export interface CritiqueAlternative {
  text: string;
  radar: RadarScores;
  notes: string[];
}

/** Per-segment data in critique stage */
export interface CritiqueSegmentRadar extends StageSegmentRadar {
  alternatives?: CritiqueAlternative[];
}

/** File payload for radar-literal.json / radar-literary.json */
export interface StageRadarFile {
  sceneId: string;
  stage: RadarStage;
  updatedAt: string;
  segments: StageSegmentRadar[];
}

/** File payload for radar-critique.json */
export interface CritiqueRadarFile {
  sceneId: string;
  stage: "critique";
  updatedAt: string;
  segments: CritiqueSegmentRadar[];
}

// ── Paths ────────────────────────────────────────────────────────────────────

const STAGE_FILES: Record<RadarStage, string> = {
  literal: "radar-literal.json",
  literary: "radar-literary.json",
  critique: "radar-critique.json",
};

/**
 * Build radar file path. If `lang` is provided, uses the translation subfolder.
 */
export function radarStagePath(chapterId: string, sceneId: string, stage: RadarStage, lang?: string): string {
  if (lang) {
    return `chapters/${chapterId}/scenes/${sceneId}/${lang}/${STAGE_FILES[stage]}`;
  }
  return `chapters/${chapterId}/scenes/${sceneId}/${STAGE_FILES[stage]}`;
}

// ── Read helpers ─────────────────────────────────────────────────────────────

export async function readStageRadar(
  storage: ProjectStorage,
  chapterId: string,
  sceneId: string,
  stage: RadarStage,
  lang?: string,
): Promise<StageRadarFile | null> {
  const path = radarStagePath(chapterId, sceneId, stage, lang);
  return storage.readJSON<StageRadarFile>(path);
}

export async function readCritiqueRadar(
  storage: ProjectStorage,
  chapterId: string,
  sceneId: string,
  lang?: string,
): Promise<CritiqueRadarFile | null> {
  const path = radarStagePath(chapterId, sceneId, "critique", lang);
  return storage.readJSON<CritiqueRadarFile>(path);
}

/** Read all available stages for a scene */
export async function readAllStages(
  storage: ProjectStorage,
  chapterId: string,
  sceneId: string,
  lang?: string,
): Promise<{
  literal: StageRadarFile | null;
  literary: StageRadarFile | null;
  critique: CritiqueRadarFile | null;
}> {
  const [literal, literary, critique] = await Promise.all([
    readStageRadar(storage, chapterId, sceneId, "literal", lang),
    readStageRadar(storage, chapterId, sceneId, "literary", lang),
    readCritiqueRadar(storage, chapterId, sceneId, lang),
  ]);
  return { literal, literary, critique };
}

// ── Write helpers ────────────────────────────────────────────────────────────

export async function writeStageRadar(
  storage: ProjectStorage,
  chapterId: string,
  sceneId: string,
  stage: RadarStage,
  segments: StageSegmentRadar[],
  lang?: string,
): Promise<void> {
  const data: StageRadarFile = {
    sceneId,
    stage,
    updatedAt: new Date().toISOString(),
    segments,
  };
  await storage.writeJSON(radarStagePath(chapterId, sceneId, stage, lang), data);
}

export async function writeCritiqueRadar(
  storage: ProjectStorage,
  chapterId: string,
  sceneId: string,
  segments: CritiqueSegmentRadar[],
  lang?: string,
): Promise<void> {
  const data: CritiqueRadarFile = {
    sceneId,
    stage: "critique",
    updatedAt: new Date().toISOString(),
    segments,
  };
  await storage.writeJSON(radarStagePath(chapterId, sceneId, "critique", lang), data);
}

// ── Stage detection ──────────────────────────────────────────────────────────

/** Determine the highest completed stage for a segment */
export function getSegmentStage(
  segmentId: string,
  stages: {
    literal: StageRadarFile | null;
    literary: StageRadarFile | null;
    critique: CritiqueRadarFile | null;
  },
): RadarStage | null {
  if (stages.critique?.segments.some(s => s.segmentId === segmentId)) return "critique";
  if (stages.literary?.segments.some(s => s.segmentId === segmentId)) return "literary";
  if (stages.literal?.segments.some(s => s.segmentId === segmentId)) return "literal";
  return null;
}

// ── Labels ───────────────────────────────────────────────────────────────────

export const STAGE_LABELS: Record<RadarStage, { ru: string; en: string }> = {
  literal: { ru: "Перевод", en: "Translation" },
  literary: { ru: "Арт-правка", en: "Art Edit" },
  critique: { ru: "Оценка", en: "Critique" },
};

/** Layer toggle labels for the chart */
export const LAYER_LABELS: Record<string, { ru: string; en: string }> = {
  "3R": { ru: "3R", en: "3R" },
  "5R": { ru: "5R", en: "5R" },
  "5R+Alt": { ru: "5R+Alt", en: "5R+Alt" },
};
