/**
 * translationPipeline — client-side orchestrator for the art-translation cycle.
 *
 * Now operates on a single storage with lang-subfolder paths instead of
 * separate source/target OPFS projects.
 *
 * Flow per scene:
 *   1. translate-literal (batch all segments from source storyboard)
 *   2. translate-literary (per segment, with context)
 *   3. computeProgrammaticAxes (rhythm + phonetic — instant)
 *   4. computeSemanticScore (API embeddings)
 *   5. critique-translation (LLM: sentiment + cultural)
 *   6. Merge scores → RadarScores
 *   7. If weighted < threshold && iteration < MAX → repeat steps 2–6
 *   8. Save results to lang-subfolder storyboard
 *
 * Max 2 editorial iterations to cap token spend.
 */

import type { Segment } from "@/components/studio/storyboard/types";
import type { LocalStoryboardData } from "@/lib/storyboardSync";
import type { ProjectStorage } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";
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
  readStageRadar,
  readCritiqueRadar,
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
  critiqueNotes: string[];
  radarHistory: RadarScores[];
  radar: RadarScores;
  iterations: number;
}

export interface TranslationSceneResult {
  sceneId: string;
  chapterId: string;
  segments: TranslationSegmentResult[];
  aggregateScore: number;
}

export interface PipelineOptions {
  /** Single project storage (reads source, writes to lang subfolder) */
  storage: ProjectStorage;
  sceneId: string;
  chapterId: string;
  sourceLang: "ru" | "en";
  targetLang: "ru" | "en";
  userApiKeys: Record<string, string>;
  model: string;
  literaryModel?: string;
  critiqueModel?: string;
  qualityThreshold?: number;
  maxIterations?: number;
  weights?: RadarWeights;
  onProgress?: (info: PipelineProgress) => void;
  onSegmentComplete?: (segmentId: string, result: TranslationSegmentResult) => void;
  skipCompleted?: boolean;
  signal?: AbortSignal;
  isRu?: boolean;
}

export interface PipelineProgress {
  stage: "literal" | "literary" | "radar" | "critique" | "saving" | "done";
  fraction: number;
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
    storage, sceneId, chapterId,
    sourceLang, targetLang, userApiKeys,
    model, literaryModel, critiqueModel,
    qualityThreshold = QUALITY_THRESHOLD_DEFAULT,
    maxIterations = MAX_ITERATIONS_DEFAULT,
    weights = DEFAULT_WEIGHTS,
    onProgress, onSegmentComplete,
    skipCompleted = false,
    signal, isRu = false,
  } = opts;

  const lang = targetLang;
  const progress = onProgress ?? (() => {});
  const checkAbort = () => { if (signal?.aborted) throw new DOMException("Aborted", "AbortError"); };

  // ── 1. Load source storyboard ──────────────────────────────────────────
  const sourceSb = await storage.readJSON<LocalStoryboardData>(
    paths.storyboard(sceneId, chapterId),
  );
  if (!sourceSb?.segments?.length) {
    throw new Error(`No storyboard found for scene ${sceneId}`);
  }

  const segments = sourceSb.segments;
  const totalSegs = segments.length;

  // ── 2. Determine which segments to process ─────────────────────────────
  const existingCritique = skipCompleted
    ? await readCritiqueRadar(storage, chapterId, sceneId, lang)
    : null;
  const completedSegmentIds = new Set<string>();
  if (existingCritique?.segments?.length) {
    for (const s of existingCritique.segments) {
      if (s.segmentId && s.radar?.weighted > 0) completedSegmentIds.add(s.segmentId);
    }
  }

  const segmentsToProcess = segments.filter(seg => !completedSegmentIds.has(seg.segment_id));

  // ── 3. Literal translation (batch) ────────────────────────────────────
  checkAbort();
  progress({
    stage: "literal", fraction: 0.05,
    segmentIndex: 0, totalSegments: totalSegs, iteration: 1,
    message: isRu ? `Подстрочный перевод 1/${totalSegs}…` : `Literal translation 1/${totalSegs}…`,
  });

  const literalResults = segmentsToProcess.length > 0
    ? await batchLiteralTranslation(segmentsToProcess, model, userApiKeys, sourceLang, targetLang, isRu)
    : [];
  checkAbort();

  const literalMap = new Map<string, string>();
  segmentsToProcess.forEach((seg, i) => {
    literalMap.set(seg.segment_id, (literalResults[i] || "").trim());
  });

  const literalSeedResults: TranslationSegmentResult[] = segmentsToProcess
    .map((seg) => ({
      segmentId: seg.segment_id,
      original: seg.phrases.map((p) => p.text).join(" ").trim(),
      literal: literalMap.get(seg.segment_id) || "",
      literary: "",
      critiqueNotes: [],
      radarHistory: [],
      radar: { semantic: 0, sentiment: 0, rhythm: 0, phonetic: 0, cultural: 0, weighted: 0 },
      iterations: 0,
    }))
    .filter((result) => !!result.literal);

  if (literalSeedResults.length > 0) {
    await saveTranslationResults(storage, sceneId, chapterId, lang, sourceSb, literalSeedResults);
  }

  // ── 4. Per-segment: literary → radar → critique → iterate ─────────────
  const results: TranslationSegmentResult[] = [];

  for (let si = 0; si < totalSegs; si++) {
    checkAbort();
    const seg = segments[si];
    const originalText = seg.phrases.map(p => p.text).join(" ").trim();

    if (completedSegmentIds.has(seg.segment_id)) continue;

    const literalText = literalMap.get(seg.segment_id) || originalText;

    if (!originalText) continue;

    let currentLiterary = "";
    let critiqueNotes: string[] = [];
    const radarHistory: RadarScores[] = [];
    let finalRadar: RadarScores = { semantic: 0, sentiment: 0, rhythm: 0, phonetic: 0, cultural: 0, weighted: 0 };

    for (let iter = 0; iter < maxIterations; iter++) {
      checkAbort();

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
        original: originalText, literal: literalText,
        previousLiterary: iter > 0 ? currentLiterary : undefined,
        previousCritique: prevCritique,
        segmentType: seg.segment_type, speaker: seg.speaker,
        model: literaryModel ?? model, userApiKeys, sourceLang, targetLang, isRu,
      });
      currentLiterary = literaryResult.text;
      checkAbort();

      progress({
        stage: "radar", fraction: frac + 0.02,
        segmentIndex: si, totalSegments: totalSegs, iteration: iter + 1,
        message: isRu ? "Анализ ритмики и фонетики…" : "Analyzing rhythm & phonetics…",
      });
      const { rhythm, phonetic } = computeProgrammaticAxes(originalText, currentLiterary, sourceLang, targetLang);
      const semantic = await computeSemanticScore(originalText, currentLiterary, userApiKeys) ?? 0;
      checkAbort();

      progress({
        stage: "critique", fraction: frac + 0.04,
        segmentIndex: si, totalSegments: totalSegs, iteration: iter + 1,
        message: isRu ? "Оценка критиком…" : "Critic assessment…",
      });
      const critiqueResult = await callCritique({
        original: originalText, translation: currentLiterary,
        segmentType: seg.segment_type, speaker: seg.speaker,
        model: critiqueModel ?? model, userApiKeys,
        embeddingDeltas: { rhythm, phonetic, semantic }, isRu,
      });
      checkAbort();

      const sentiment = (critiqueResult.scores?.sentiment ?? 0) / 100;
      const cultural = (critiqueResult.scores?.cultural ?? 0) / 100;
      critiqueNotes = critiqueResult.issues?.map((i: any) => `[${i.axis}] ${i.suggestion}`) ?? [];

      const radar: RadarScores = { semantic, sentiment, rhythm, phonetic, cultural, weighted: 0 };
      radar.weighted = computeWeightedScore(radar, weights);
      radarHistory.push(radar);
      finalRadar = radar;

      if (radar.weighted >= qualityThreshold) break;
      if (iter === maxIterations - 1) break;
    }

    const segResult: TranslationSegmentResult = {
      segmentId: seg.segment_id, original: originalText,
      literal: literalText, literary: currentLiterary,
      critiqueNotes, radarHistory, radar: finalRadar,
      iterations: radarHistory.length,
    };
    results.push(segResult);

    // Incremental persistence
    try {
      await Promise.all([
        saveStageRadarFiles(storage, sceneId, chapterId, lang, [segResult]),
        saveTranslationResults(storage, sceneId, chapterId, lang, sourceSb, [segResult]),
      ]);
    } catch (e) {
      console.warn("[Pipeline] Incremental translation write failed for segment", seg.segment_id, e);
    }

    onSegmentComplete?.(seg.segment_id, segResult);
  }

  // ── 5. Save to lang-subfolder storyboard ──────────────────────────────
  checkAbort();
  progress({ stage: "saving", fraction: 0.95, message: isRu ? "Сохранение перевода…" : "Saving translation…" });
  if (results.length > 0) {
    await saveTranslationResults(storage, sceneId, chapterId, lang, sourceSb, results);
    await saveStageRadarFiles(storage, sceneId, chapterId, lang, results);
  }

  const finalCritique = await readCritiqueRadar(storage, chapterId, sceneId, lang).catch(() => null);
  const weightedScores = finalCritique?.segments
    ?.map((segment) => segment.radar?.weighted)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score)) ?? [];

  const aggregateScore = weightedScores.length > 0
    ? weightedScores.reduce((sum, score) => sum + score, 0) / weightedScores.length
    : results.length > 0
      ? results.reduce((sum, r) => sum + r.radar.weighted, 0) / results.length
      : 0;

  progress({ stage: "done", fraction: 1, message: isRu ? "Готово" : "Done" });
  return { sceneId, chapterId, segments: results, aggregateScore };
}

// ── Edge Function calls ──────────────────────────────────────────────────────

async function batchLiteralTranslation(
  segments: Segment[], model: string, userApiKeys: Record<string, string>,
  sourceLang: string, targetLang: string, isRu: boolean,
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
    body: { segments: segmentInputs, source_lang: sourceLang, target_lang: targetLang, model },
    userApiKeys, isRu,
  });

  if (error || !data?.translations) {
    console.error("[Pipeline] Literal translation failed:", error);
    throw new Error(`Literal translation failed: ${error?.message || "no data"}`);
  }

  return data.translations.map(t => t.translation);
}

interface LiteraryCallOpts {
  original: string; literal: string;
  previousLiterary?: string; previousCritique?: string;
  segmentType: string; speaker: string | null;
  model: string; userApiKeys: Record<string, string>;
  sourceLang: string; targetLang: string; isRu: boolean;
}

async function callLiteraryTranslation(opts: LiteraryCallOpts): Promise<{ text: string; notes: string[] }> {
  const body: Record<string, unknown> = {
    original: opts.original, literal: opts.literal,
    segment_type: opts.segmentType, speaker: opts.speaker,
    source_lang: opts.sourceLang, target_lang: opts.targetLang, model: opts.model,
  };
  if (opts.previousLiterary) body.previous_translation = opts.previousLiterary;
  if (opts.previousCritique) body.critique_feedback = opts.previousCritique;

  const { data, error } = await invokeWithFallback<{ text: string; notes: string[] }>({
    functionName: "translate-literary", body, userApiKeys: opts.userApiKeys, isRu: opts.isRu,
  });

  if (error || !data?.text) {
    console.error("[Pipeline] Literary translation failed:", error);
    throw new Error(`Literary translation failed: ${error?.message || "no data"}`);
  }
  return { text: data.text, notes: data.notes ?? [] };
}

interface CritiqueCallOpts {
  original: string; translation: string;
  segmentType: string; speaker: string | null;
  model: string; userApiKeys: Record<string, string>;
  embeddingDeltas: { rhythm: number; phonetic: number; semantic: number };
  isRu: boolean;
}

async function callCritique(opts: CritiqueCallOpts): Promise<any> {
  const { data, error } = await invokeWithFallback<any>({
    functionName: "critique-translation",
    body: {
      original: opts.original, translation: opts.translation,
      segment_type: opts.segmentType, speaker: opts.speaker,
      model: opts.model, embedding_deltas: opts.embeddingDeltas,
    },
    userApiKeys: opts.userApiKeys, isRu: opts.isRu,
  });

  if (error) {
    console.warn("[Pipeline] Critique failed, using zero scores:", error);
    return { scores: { sentiment: 0, cultural: 0 }, issues: [] };
  }
  return data ?? { scores: { sentiment: 0, cultural: 0 }, issues: [] };
}

// ── Persistence ──────────────────────────────────────────────────────────────

async function saveTranslationResults(
  storage: ProjectStorage, sceneId: string, chapterId: string, lang: string,
  sourceSb: LocalStoryboardData, results: TranslationSegmentResult[],
): Promise<void> {
  if (results.length === 0) return;

  const resultMap = new Map(results.map(r => [r.segmentId, r]));
  const storyboardPath = paths.translationStoryboard(sceneId, lang, chapterId);
  const existingSb = await storage.readJSON<LocalStoryboardData>(storyboardPath);
  const existingSegments = new Map((existingSb?.segments ?? []).map((seg) => [seg.segment_id, seg]));

  const translatedSb: LocalStoryboardData = {
    ...(existingSb ?? sourceSb),
    updatedAt: new Date().toISOString(),
    segments: sourceSb.segments.map(seg => {
      const result = resultMap.get(seg.segment_id);
      const baseSeg = (existingSegments.get(seg.segment_id) ?? createEmptyTranslatedSegment(seg)) as Segment & {
        _literal?: string;
        _literary?: string;
      };

      if (!result) return baseSeg;

      const nextLiteral = result.literal || baseSeg._literal || "";
      const nextLiterary = result.literary || baseSeg._literary || "";
      const displayText = nextLiterary || nextLiteral;
      if (!displayText) return baseSeg;

      const translatedPhrases = splitTranslationIntoPhrases(displayText, seg.phrases.length);
      return {
        ...baseSeg,
        _literal: nextLiteral || undefined,
        _literary: nextLiterary || undefined,
        phrases: seg.phrases.map((ph, pi) => ({
          ...(baseSeg.phrases[pi] ?? ph),
          text: translatedPhrases[pi] ?? (pi === 0 ? displayText : ""),
        })),
      };
    }),
    audioStatus: existingSb?.audioStatus ?? {},
  };

  await storage.writeJSON(storyboardPath, translatedSb);
}

function createEmptyTranslatedSegment(segment: Segment): Segment {
  return {
    ...segment,
    phrases: segment.phrases.map((phrase) => ({
      ...phrase,
      text: "",
    })),
  };
}

async function saveStageRadarFiles(
  storage: ProjectStorage, sceneId: string, chapterId: string, lang: string,
  results: TranslationSegmentResult[],
): Promise<void> {
  const mergeSegments = <T extends StageSegmentRadar>(existing: T[] | undefined, incoming: T[]): T[] => {
    const map = new Map<string, T>();
    for (const s of (existing ?? [])) map.set(s.segmentId, s);
    for (const s of incoming) map.set(s.segmentId, s);
    return Array.from(map.values());
  };

  const literalSegments: StageSegmentRadar[] = results.filter(r => r.literal).map(r => ({
    segmentId: r.segmentId,
    radar: {
      semantic: r.radarHistory[0]?.semantic ?? r.radar.semantic,
      sentiment: 0,
      rhythm: r.radarHistory[0]?.rhythm ?? r.radar.rhythm,
      phonetic: r.radarHistory[0]?.phonetic ?? r.radar.phonetic,
      cultural: 0, weighted: 0,
    },
    literal: r.literal,
  }));

  const literarySegments: StageSegmentRadar[] = results.filter(r => r.literary).map(r => ({
    segmentId: r.segmentId, radar: r.radar,
    literary: r.literary, critiqueNotes: r.critiqueNotes,
  }));

  const critiqueSegments: CritiqueSegmentRadar[] = results.filter(r => r.critiqueNotes.length > 0).map(r => ({
    segmentId: r.segmentId, radar: r.radar,
    literary: r.literary, critiqueNotes: r.critiqueNotes, alternatives: [],
  }));

  const [existingLiteral, existingLiterary, existingCritique] = await Promise.all([
    literalSegments.length > 0 ? readStageRadar(storage, chapterId, sceneId, "literal", lang) : null,
    literarySegments.length > 0 ? readStageRadar(storage, chapterId, sceneId, "literary", lang) : null,
    critiqueSegments.length > 0 ? readCritiqueRadar(storage, chapterId, sceneId, lang) : null,
  ]);

  await Promise.all([
    literalSegments.length > 0
      ? writeStageRadar(storage, chapterId, sceneId, "literal", mergeSegments(existingLiteral?.segments, literalSegments), lang)
      : Promise.resolve(),
    literarySegments.length > 0
      ? writeStageRadar(storage, chapterId, sceneId, "literary", mergeSegments(existingLiterary?.segments, literarySegments), lang)
      : Promise.resolve(),
    critiqueSegments.length > 0
      ? writeCritiqueRadar(storage, chapterId, sceneId, mergeSegments(existingCritique?.segments as CritiqueSegmentRadar[] | undefined, critiqueSegments), lang)
      : Promise.resolve(),
  ]);
}

function splitTranslationIntoPhrases(text: string, phraseCount: number): string[] {
  if (phraseCount <= 1) return [text];
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (sentences.length >= phraseCount) {
    const result: string[] = [];
    const perPhrase = Math.ceil(sentences.length / phraseCount);
    for (let i = 0; i < phraseCount; i++) {
      const start = i * perPhrase;
      const end = Math.min(start + perPhrase, sentences.length);
      result.push(sentences.slice(start, end).join(" "));
    }
    return result;
  }
  const totalLen = text.length;
  const avgLen = Math.ceil(totalLen / phraseCount);
  const result: string[] = [];
  let pos = 0;
  for (let i = 0; i < phraseCount; i++) {
    if (i === phraseCount - 1) {
      result.push(text.slice(pos));
    } else {
      let end = Math.min(pos + avgLen, totalLen);
      const spaceIdx = text.indexOf(" ", end);
      if (spaceIdx !== -1 && spaceIdx - end < 20) end = spaceIdx;
      result.push(text.slice(pos, end).trim());
      pos = end;
    }
  }
  return result.map(s => s.trim()).filter(Boolean);
}
