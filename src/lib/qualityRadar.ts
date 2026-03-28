/**
 * Quality Radar — orchestrator for all 5 axes of translation quality assessment.
 *
 * Axes:
 *   1. Semantic   — cosine similarity of API embeddings (OpenRouter / ProxyAPI)
 *   2. Sentiment  — LLM-based tonal match (via translation_critic)
 *   3. Rhythm     — programmatic syllable/phrase structure comparison
 *   4. Phonetic   — programmatic alliteration/assonance comparison
 *   5. Cultural   — LLM-based cultural code assessment (via translation_critic)
 *
 * Axes 1 uses embeddingClient.ts, axes 3–4 use phoneticFeatures.ts,
 * axes 2+5 are populated externally (from critique-translation Edge Function).
 */

import {
  extractPhoneticFeatures,
  compareRhythm,
  comparePhonetics,
  type PhoneticVector,
} from "./phoneticFeatures";
import {
  getEmbedding,
  embeddingCosineSimilarity,
  detectEmbeddingProvider,
  type EmbeddingOptions,
} from "./embeddingClient";

// ── Types ────────────────────────────────────────────────────────────────────

export type RadarAxis = "semantic" | "sentiment" | "rhythm" | "phonetic" | "cultural";

export interface RadarScores {
  semantic: number;       // 0–1
  sentiment: number;      // 0–1
  rhythm: number;         // 0–1
  phonetic: number;       // 0–1
  cultural: number;       // 0–1
  weighted: number;       // 0–1 weighted average
}

export interface RadarWeights {
  semantic: number;
  sentiment: number;
  rhythm: number;
  phonetic: number;
  cultural: number;
}

/** Preset weight configurations */
export const RADAR_PRESETS: Record<string, RadarWeights> = {
  prose: {
    semantic: 0.35,
    sentiment: 0.20,
    rhythm: 0.15,
    phonetic: 0.10,
    cultural: 0.20,
  },
  poetry: {
    semantic: 0.15,
    sentiment: 0.15,
    rhythm: 0.30,
    phonetic: 0.25,
    cultural: 0.15,
  },
  balanced: {
    semantic: 0.20,
    sentiment: 0.20,
    rhythm: 0.20,
    phonetic: 0.20,
    cultural: 0.20,
  },
};

export const DEFAULT_WEIGHTS: RadarWeights = RADAR_PRESETS.prose;

// ── Score thresholds ─────────────────────────────────────────────────────────

export type ScoreLevel = "green" | "yellow" | "red";

export function getScoreLevel(score: number): ScoreLevel {
  if (score >= 0.85) return "green";
  if (score >= 0.70) return "yellow";
  return "red";
}

export const SCORE_COLORS: Record<ScoreLevel, string> = {
  green: "hsl(142, 71%, 45%)",
  yellow: "hsl(48, 96%, 53%)",
  red: "hsl(0, 84%, 60%)",
};

// ── Programmatic axes (client-side, no API) ──────────────────────────────────

/**
 * Compute rhythm and phonetic scores between original and translation.
 * Pure computation, no network calls.
 */
export function computeProgrammaticAxes(
  originalText: string,
  translationText: string,
  originalLang: "ru" | "en",
  translationLang: "ru" | "en",
): { rhythm: number; phonetic: number; originalFeatures: PhoneticVector; translationFeatures: PhoneticVector } {
  const originalFeatures = extractPhoneticFeatures(originalText, originalLang);
  const translationFeatures = extractPhoneticFeatures(translationText, translationLang);

  return {
    rhythm: compareRhythm(originalFeatures, translationFeatures),
    phonetic: comparePhonetics(originalFeatures, translationFeatures),
    originalFeatures,
    translationFeatures,
  };
}

// ── Semantic axis (API-based) ────────────────────────────────────────────────

/**
 * Compute semantic similarity between original and translation texts.
 * Requires API keys for OpenRouter or ProxyAPI.
 *
 * @returns semantic score 0–1, or null if no embedding provider available
 */
export async function computeSemanticScore(
  originalText: string,
  translationText: string,
  userApiKeys: Record<string, string>,
  embeddingOpts?: EmbeddingOptions,
): Promise<number | null> {
  const opts = embeddingOpts ?? detectEmbeddingProvider(userApiKeys);
  if (!opts) return null;

  try {
    const [origEmb, transEmb] = await Promise.all([
      getEmbedding(originalText, opts),
      getEmbedding(translationText, opts),
    ]);
    return embeddingCosineSimilarity(origEmb.vector, transEmb.vector);
  } catch (err) {
    console.error("[QualityRadar] Semantic embedding failed:", err);
    return null;
  }
}

// ── Full radar computation ───────────────────────────────────────────────────

export interface ComputeRadarOptions {
  originalText: string;
  translationText: string;
  originalLang: "ru" | "en";
  translationLang: "ru" | "en";
  userApiKeys: Record<string, string>;
  embeddingOpts?: EmbeddingOptions;
  /** Pre-computed LLM scores from critique (sentiment + cultural) */
  criticScores?: { sentiment?: number; cultural?: number };
  weights?: RadarWeights;
}

/**
 * Compute all available Quality Radar axes.
 *
 * - Rhythm + Phonetic: always computed (programmatic)
 * - Semantic: computed if embedding provider available
 * - Sentiment + Cultural: provided externally from LLM critique, or default 0
 */
export async function computeRadarScores(
  opts: ComputeRadarOptions,
): Promise<RadarScores> {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;

  // Programmatic axes (instant)
  const { rhythm, phonetic } = computeProgrammaticAxes(
    opts.originalText,
    opts.translationText,
    opts.originalLang,
    opts.translationLang,
  );

  // Semantic axis (API call)
  const semantic = await computeSemanticScore(
    opts.originalText,
    opts.translationText,
    opts.userApiKeys,
    opts.embeddingOpts,
  ) ?? 0;

  // LLM axes (from critique, or 0 if not yet evaluated)
  const sentiment = opts.criticScores?.sentiment ?? 0;
  const cultural = opts.criticScores?.cultural ?? 0;

  // Weighted average
  const scores: RadarScores = {
    semantic,
    sentiment,
    rhythm,
    phonetic,
    cultural,
    weighted: 0,
  };

  scores.weighted = computeWeightedScore(scores, weights);
  return scores;
}

/** Compute weighted average from individual scores and weights */
export function computeWeightedScore(
  scores: Omit<RadarScores, "weighted">,
  weights: RadarWeights = DEFAULT_WEIGHTS,
): number {
  const axes: RadarAxis[] = ["semantic", "sentiment", "rhythm", "phonetic", "cultural"];
  let totalWeight = 0;
  let weightedSum = 0;

  for (const axis of axes) {
    const score = scores[axis];
    const weight = weights[axis];
    // Only count axes that have been evaluated (> 0)
    if (score > 0) {
      weightedSum += score * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// ── Labels (i18n) ────────────────────────────────────────────────────────────

export const AXIS_LABELS: Record<RadarAxis, { ru: string; en: string }> = {
  semantic: { ru: "Семантика", en: "Semantics" },
  sentiment: { ru: "Тональность", en: "Sentiment" },
  rhythm: { ru: "Ритмика", en: "Rhythm" },
  phonetic: { ru: "Фонетика", en: "Phonetics" },
  cultural: { ru: "Культурный код", en: "Cultural Code" },
};

export const PRESET_LABELS: Record<string, { ru: string; en: string }> = {
  prose: { ru: "Проза", en: "Prose" },
  poetry: { ru: "Поэзия", en: "Poetry" },
  balanced: { ru: "Баланс", en: "Balanced" },
};
