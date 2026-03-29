/**
 * translationPipeline — client-side orchestrator for the art-translation cycle.
 *
 * Flow per scene:
 *   1. translate-literal (batch all segments)
 *   2. translate-literary (per segment, with context)
 *   3. computeProgrammaticAxes (rhythm + phonetic — instant)
 *   4. computeSemanticScore (API embeddings)
 *   5. critique-translation (LLM: sentiment + cultural)
 *   6. Merge scores → RadarScores
 *   7. If weighted < threshold && iteration < MAX → repeat steps 2–6
 *   8. Save results to translation project storyboard
 *
 * Max 2 editorial iterations to cap token spend.
 */

import type { Segment } from "@/components/studio/storyboard/types";
import type { LocalStoryboardData } from "@/lib/storyboardSync";
import type { ProjectStorage } from "@/lib/projectStorage";
import { invokeWithFallback } from "@/lib/invokeWithFallback";
import {
  computeProgrammaticAxes,
  computeSemanticScore,
  computeWeightedScore,
  type RadarScores,
  type RadarWeights,
  DEFAULT_WEIGHTS,
} from "@/lib/qualityRadar";
import {
  writeStageRadar,
  writeCritiqueRadar,
  type StageSegmentRadar,
  type CritiqueSegmentRadar,
} from "@/lib/radarStages";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TranslationSegmentResult {
  segmentId: string;
  original: string;
  literal: string;
  literary: string;
  /** LLM critique notes */
  critiqueNotes: string[];
  /** Per-iteration radar snapshots (last = final) */
  radarHistory: RadarScores[];
  /** Current radar */
  radar: RadarScores;
  /** Number of editorial iterations performed */
  iterations: number;
}

export interface TranslationSceneResult {
  sceneId: string;
  chapterId: string;
  segments: TranslationSegmentResult[];
  /** Aggregate weighted score (average of segment scores) */
  aggregateScore: number;
}

export interface PipelineOptions {
  /** Source project storage (original text) */
  sourceStorage: ProjectStorage;
  /** Translation project storage (write results here) */
  targetStorage: ProjectStorage;
  sceneId: string;
  chapterId: string;
  /** Source language */
  sourceLang: "ru" | "en";
  /** Target language */
  targetLang: "ru" | "en";
  /** User API keys for embedding + AI provider routing */
  userApiKeys: Record<string, string>;
  /** AI model to use for translation/critique */
  model: string;
  /** Model for literary editing (may differ from literal) */
  literaryModel?: string;
  /** Model for critique */
  critiqueModel?: string;
  /** Quality threshold — skip re-iteration if weighted >= this */
  qualityThreshold?: number;
  /** Max editorial iterations (default 2) */
  maxIterations?: number;
  /** Radar weights preset */
  weights?: RadarWeights;
  /** Progress callback */
  onProgress?: (info: PipelineProgress) => void;
  /** Abort signal */
  signal?: AbortSignal;
  /** Is Russian UI (for fallback toasts) */
  isRu?: boolean;
}

export interface PipelineProgress {
  stage: "literal" | "literary" | "radar" | "critique" | "saving" | "done";
  /** 0..1 overall fraction */
  fraction: number;
  /** Current segment index (0-based) */
  segmentIndex?: number;
  totalSegments?: number;
  iteration?: number;
  message: string;
}

const MAX_ITERATIONS_DEFAULT = 2;
const QUALITY_THRESHOLD_DEFAULT = 0.80;

// ── Main pipeline ────────────────────────────────────────────────────────────

export async function runTranslationPipeline(
  opts: PipelineOptions,
): Promise<TranslationSceneResult> {
  const {
    sourceStorage,
    targetStorage,
    sceneId,
    chapterId,
    sourceLang,
    targetLang,
    userApiKeys,
    model,
    literaryModel,
    critiqueModel,
    qualityThreshold = QUALITY_THRESHOLD_DEFAULT,
    maxIterations = MAX_ITERATIONS_DEFAULT,
    weights = DEFAULT_WEIGHTS,
    onProgress,
    signal,
    isRu = false,
  } = opts;

  const progress = onProgress ?? (() => {});
  const checkAbort = () => { if (signal?.aborted) throw new DOMException("Aborted", "AbortError"); };

  // ── 1. Load source storyboard ──────────────────────────────────────────
  const sbPath = `chapters/${chapterId}/scenes/${sceneId}/storyboard.json`;
  const sourceSb = await sourceStorage.readJSON<LocalStoryboardData>(sbPath);
  if (!sourceSb?.segments?.length) {
    throw new Error(`No storyboard found for scene ${sceneId}`);
  }

  const segments = sourceSb.segments;
  const totalSegs = segments.length;

  // ── 2. Literal translation (batch) ─────────────────────────────────────
  checkAbort();
  progress({ stage: "literal", fraction: 0.05, message: isRu ? "Подстрочный перевод…" : "Literal translation…" });

  const literalResults = await batchLiteralTranslation(segments, model, userApiKeys, sourceLang, targetLang, isRu);
  checkAbort();

  // ── 3. Per-segment: literary → radar → critique → iterate ─────────────
  const results: TranslationSegmentResult[] = [];

  for (let si = 0; si < totalSegs; si++) {
    checkAbort();
    const seg = segments[si];
    const originalText = seg.phrases.map(p => p.text).join(" ").trim();
    const literalText = (literalResults[si] || "").trim() || originalText;

    // Skip segments with no text content
    if (!originalText) {
      results.push({
        segmentId: seg.segment_id,
        original: "",
        literal: "",
        literary: "",
        critiqueNotes: [],
        radarHistory: [],
        radar: { semantic: 0, sentiment: 0, rhythm: 0, phonetic: 0, cultural: 0, weighted: 0 },
        iterations: 0,
      });
      continue;
    }

    let currentLiterary = "";
    let critiqueNotes: string[] = [];
    const radarHistory: RadarScores[] = [];
    let finalRadar: RadarScores = { semantic: 0, sentiment: 0, rhythm: 0, phonetic: 0, cultural: 0, weighted: 0 };

    for (let iter = 0; iter < maxIterations; iter++) {
      checkAbort();

      // ── 3a. Literary translation ──
      const frac = 0.1 + (si / totalSegs) * 0.7 + (iter / maxIterations) * (0.7 / totalSegs);
      progress({
        stage: "literary", fraction: frac,
        segmentIndex: si, totalSegments: totalSegs, iteration: iter + 1,
        message: isRu
          ? `Лит. редактура сегмента ${si + 1}/${totalSegs} (итерация ${iter + 1})…`
          : `Literary editing segment ${si + 1}/${totalSegs} (iteration ${iter + 1})…`,
      });

      const prevCritique = iter > 0 ? critiqueNotes.join("\n") : undefined;
      const literaryResult = await callLiteraryTranslation({
        original: originalText,
        literal: literalText,
        previousLiterary: iter > 0 ? currentLiterary : undefined,
        previousCritique: prevCritique,
        segmentType: seg.segment_type,
        speaker: seg.speaker,
        model: literaryModel ?? model,
        userApiKeys,
        sourceLang,
        targetLang,
        isRu,
      });
      currentLiterary = literaryResult.text;
      checkAbort();

      // ── 3b. Programmatic radar axes (instant) ──
      progress({
        stage: "radar", fraction: frac + 0.02,
        segmentIndex: si, totalSegments: totalSegs, iteration: iter + 1,
        message: isRu ? "Анализ ритмики и фонетики…" : "Analyzing rhythm & phonetics…",
      });
      const { rhythm, phonetic } = computeProgrammaticAxes(originalText, currentLiterary, sourceLang, targetLang);

      // ── 3c. Semantic score (API) ──
      const semantic = await computeSemanticScore(originalText, currentLiterary, userApiKeys) ?? 0;
      checkAbort();

      // ── 3d. Critique (LLM) ──
      progress({
        stage: "critique", fraction: frac + 0.04,
        segmentIndex: si, totalSegments: totalSegs, iteration: iter + 1,
        message: isRu ? "Оценка критиком…" : "Critic assessment…",
      });
      const critiqueResult = await callCritique({
        original: originalText,
        translation: currentLiterary,
        segmentType: seg.segment_type,
        speaker: seg.speaker,
        model: critiqueModel ?? model,
        userApiKeys,
        embeddingDeltas: { rhythm, phonetic, semantic },
        isRu,
      });
      checkAbort();

      const sentiment = (critiqueResult.scores?.sentiment ?? 0) / 100;
      const cultural = (critiqueResult.scores?.cultural ?? 0) / 100;
      critiqueNotes = critiqueResult.issues?.map(
        (i: any) => `[${i.axis}] ${i.suggestion}`,
      ) ?? [];

      // ── 3e. Compute weighted radar ──
      const radar: RadarScores = {
        semantic,
        sentiment,
        rhythm,
        phonetic,
        cultural,
        weighted: 0,
      };
      radar.weighted = computeWeightedScore(radar, weights);
      radarHistory.push(radar);
      finalRadar = radar;

      // ── 3f. Check exit condition ──
      if (radar.weighted >= qualityThreshold) break;
      // Don't iterate further on last iteration
      if (iter === maxIterations - 1) break;
    }

    results.push({
      segmentId: seg.segment_id,
      original: originalText,
      literal: literalText,
      literary: currentLiterary,
      critiqueNotes,
      radarHistory,
      radar: finalRadar,
      iterations: radarHistory.length,
    });
  }

  // ── 4. Save to translation project ────────────────────────────────────
  checkAbort();
  progress({ stage: "saving", fraction: 0.95, message: isRu ? "Сохранение перевода…" : "Saving translation…" });
  await saveTranslationResults(targetStorage, sceneId, chapterId, sourceSb, results);

  // ── 5. Write staged radar files ───────────────────────────────────────
  await saveStageRadarFiles(targetStorage, sceneId, chapterId, results);

  const aggregateScore = results.length > 0
    ? results.reduce((sum, r) => sum + r.radar.weighted, 0) / results.length
    : 0;

  progress({ stage: "done", fraction: 1, message: isRu ? "Готово" : "Done" });

  return { sceneId, chapterId, segments: results, aggregateScore };
}

// ── Edge Function calls ──────────────────────────────────────────────────────

async function batchLiteralTranslation(
  segments: Segment[],
  model: string,
  userApiKeys: Record<string, string>,
  sourceLang: string,
  targetLang: string,
  isRu: boolean,
): Promise<string[]> {
  const segmentInputs = segments.map(seg => ({
    text: seg.phrases.map(p => p.text).join(" "),
    type: seg.segment_type,
    speaker: seg.speaker ?? undefined,
  }));

  const { data, error } = await invokeWithFallback<{
    translations: { original: string; translation: string }[];
  }>({
    functionName: "translate-literal",
    body: {
      segments: segmentInputs,
      source_lang: sourceLang,
      target_lang: targetLang,
      model,
    },
    userApiKeys,
    isRu,
  });

  if (error || !data?.translations) {
    console.error("[Pipeline] Literal translation failed:", error);
    throw new Error(`Literal translation failed: ${error?.message || "no data"}`);
  }

  return data.translations.map(t => t.translation);
}

interface LiteraryCallOpts {
  original: string;
  literal: string;
  previousLiterary?: string;
  previousCritique?: string;
  segmentType: string;
  speaker: string | null;
  model: string;
  userApiKeys: Record<string, string>;
  sourceLang: string;
  targetLang: string;
  isRu: boolean;
}

async function callLiteraryTranslation(opts: LiteraryCallOpts): Promise<{ text: string; notes: string[] }> {
  const body: Record<string, unknown> = {
    original: opts.original,
    literal: opts.literal,
    segment_type: opts.segmentType,
    speaker: opts.speaker,
    source_lang: opts.sourceLang,
    target_lang: opts.targetLang,
    model: opts.model,
  };

  // On re-iterations, include previous attempt + critique feedback
  if (opts.previousLiterary) {
    body.previous_translation = opts.previousLiterary;
  }
  if (opts.previousCritique) {
    body.critique_feedback = opts.previousCritique;
  }

  const { data, error } = await invokeWithFallback<{ text: string; notes: string[] }>({
    functionName: "translate-literary",
    body,
    userApiKeys: opts.userApiKeys,
    isRu: opts.isRu,
  });

  if (error || !data?.text) {
    console.error("[Pipeline] Literary translation failed:", error);
    throw new Error(`Literary translation failed: ${error?.message || "no data"}`);
  }

  return { text: data.text, notes: data.notes ?? [] };
}

interface CritiqueCallOpts {
  original: string;
  translation: string;
  segmentType: string;
  speaker: string | null;
  model: string;
  userApiKeys: Record<string, string>;
  embeddingDeltas: { rhythm: number; phonetic: number; semantic: number };
  isRu: boolean;
}

async function callCritique(opts: CritiqueCallOpts): Promise<any> {
  const { data, error } = await invokeWithFallback<any>({
    functionName: "critique-translation",
    body: {
      original: opts.original,
      translation: opts.translation,
      segment_type: opts.segmentType,
      speaker: opts.speaker,
      model: opts.model,
      embedding_deltas: opts.embeddingDeltas,
    },
    userApiKeys: opts.userApiKeys,
    isRu: opts.isRu,
  });

  if (error) {
    console.warn("[Pipeline] Critique failed, using zero scores:", error);
    return { scores: { sentiment: 0, cultural: 0 }, issues: [] };
  }

  return data ?? { scores: { sentiment: 0, cultural: 0 }, issues: [] };
}

// ── Persistence ──────────────────────────────────────────────────────────────

async function saveTranslationResults(
  targetStorage: ProjectStorage,
  sceneId: string,
  chapterId: string,
  sourceSb: LocalStoryboardData,
  results: TranslationSegmentResult[],
): Promise<void> {
  // Build a segment lookup
  const resultMap = new Map(results.map(r => [r.segmentId, r]));

  // Clone storyboard with translated text
  const translatedSb: LocalStoryboardData = {
    ...sourceSb,
    updatedAt: new Date().toISOString(),
    segments: sourceSb.segments.map(seg => {
      const result = resultMap.get(seg.segment_id);
      if (!result) return seg;

      // Replace phrase text with literary translation
      // Split translated text back into phrases proportionally
      const translatedPhrases = splitTranslationIntoPhrases(result.literary, seg.phrases.length);
      return {
        ...seg,
        phrases: seg.phrases.map((ph, pi) => ({
          ...ph,
          text: translatedPhrases[pi] ?? result.literary,
        })),
      };
    }),
    audioStatus: {}, // Translation needs its own TTS
  };

  const sbPath = `chapters/${chapterId}/scenes/${sceneId}/storyboard.json`;
  await targetStorage.writeJSON(sbPath, translatedSb);

  // Save radar scores alongside storyboard
  const radarPath = `chapters/${chapterId}/scenes/${sceneId}/radar.json`;
  const radarData = {
    sceneId,
    updatedAt: new Date().toISOString(),
    segments: results.map(r => ({
      segmentId: r.segmentId,
      radar: r.radar,
      radarHistory: r.radarHistory,
      iterations: r.iterations,
      critiqueNotes: r.critiqueNotes,
      literal: r.literal,
    })),
  };
  await targetStorage.writeJSON(radarPath, radarData);
}

/**
 * Heuristic: split translated text into N phrases by sentence boundaries.
 * Falls back to even character splits.
 */
function splitTranslationIntoPhrases(text: string, phraseCount: number): string[] {
  if (phraseCount <= 1) return [text];

  // Try splitting by sentences
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (sentences.length >= phraseCount) {
    // Distribute sentences across phrases
    const result: string[] = [];
    const perPhrase = Math.ceil(sentences.length / phraseCount);
    for (let i = 0; i < phraseCount; i++) {
      const start = i * perPhrase;
      const end = Math.min(start + perPhrase, sentences.length);
      result.push(sentences.slice(start, end).join(" "));
    }
    return result;
  }

  // Fallback: split by character count proportionally
  const totalLen = text.length;
  const avgLen = Math.ceil(totalLen / phraseCount);
  const result: string[] = [];
  let pos = 0;
  for (let i = 0; i < phraseCount; i++) {
    if (i === phraseCount - 1) {
      result.push(text.slice(pos));
    } else {
      // Try to split at word boundary
      let end = Math.min(pos + avgLen, totalLen);
      const spaceIdx = text.indexOf(" ", end);
      if (spaceIdx !== -1 && spaceIdx - end < 20) end = spaceIdx;
      result.push(text.slice(pos, end).trim());
      pos = end;
    }
  }
  return result.map(s => s.trim()).filter(Boolean);
}
