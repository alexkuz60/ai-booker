/**
 * Programmatic phonetic & rhythmic feature extraction for Quality Radar.
 *
 * Computes two axes:
 *   - Rhythm: syllable count, avg syllable length, phrase length distribution
 *   - Phonetics: consonant onset frequencies, vowel frequencies (alliteration/assonance)
 *
 * Uses IPA-like phonetic categories as a universal bridge between RU and EN:
 *   "ш" and "sh" → same category (postalveolar fricative)
 *
 * All computation is client-side, no external API needed.
 */

// ── IPA-like phonetic categories ──────────────────────────────────────────────

/** Broad consonant categories (place + manner) */
type ConsonantCategory =
  | "bilabial_stop"       // p, b / п, б
  | "alveolar_stop"       // t, d / т, д
  | "velar_stop"          // k, g / к, г
  | "bilabial_nasal"      // m / м
  | "alveolar_nasal"      // n / н
  | "labiodental_fric"    // f, v / ф, в
  | "alveolar_fric"       // s, z / с, з
  | "postalveolar_fric"   // sh, zh / ш, ж
  | "palatal_fric"        // shch, ch / щ, ч
  | "alveolar_liquid"     // l / л
  | "alveolar_trill"      // r / р
  | "palatal_approx"      // y, j / й
  | "glottal_fric"        // h / х
  | "other_consonant";

/** Broad vowel categories */
type VowelCategory =
  | "front_close"    // i, и
  | "front_mid"      // e, э, е
  | "central_open"   // a, а
  | "back_mid"       // o, о
  | "back_close"     // u, у
  | "front_round"    // ü (rare)
  | "reduced";       // ъ, schwa

const CONSONANT_CATEGORIES = [
  "bilabial_stop", "alveolar_stop", "velar_stop",
  "bilabial_nasal", "alveolar_nasal",
  "labiodental_fric", "alveolar_fric", "postalveolar_fric", "palatal_fric",
  "alveolar_liquid", "alveolar_trill", "palatal_approx", "glottal_fric",
  "other_consonant",
] as const;

const VOWEL_CATEGORIES = [
  "front_close", "front_mid", "central_open", "back_mid", "back_close",
  "front_round", "reduced",
] as const;

// ── RU character → category maps ─────────────────────────────────────────────

const RU_CONSONANT_MAP: Record<string, ConsonantCategory> = {
  п: "bilabial_stop", б: "bilabial_stop",
  т: "alveolar_stop", д: "alveolar_stop",
  к: "velar_stop", г: "velar_stop",
  м: "bilabial_nasal",
  н: "alveolar_nasal",
  ф: "labiodental_fric", в: "labiodental_fric",
  с: "alveolar_fric", з: "alveolar_fric", ц: "alveolar_fric",
  ш: "postalveolar_fric", ж: "postalveolar_fric",
  щ: "palatal_fric", ч: "palatal_fric",
  л: "alveolar_liquid",
  р: "alveolar_trill",
  й: "palatal_approx",
  х: "glottal_fric",
};

const RU_VOWEL_MAP: Record<string, VowelCategory> = {
  и: "front_close", ы: "front_close",
  е: "front_mid", э: "front_mid",
  а: "central_open", я: "central_open",
  о: "back_mid", ё: "back_mid",
  у: "back_close", ю: "back_close",
};

// ── EN character → category maps ─────────────────────────────────────────────

const EN_CONSONANT_MAP: Record<string, ConsonantCategory> = {
  p: "bilabial_stop", b: "bilabial_stop",
  t: "alveolar_stop", d: "alveolar_stop",
  k: "velar_stop", g: "velar_stop", c: "velar_stop",
  m: "bilabial_nasal",
  n: "alveolar_nasal",
  f: "labiodental_fric", v: "labiodental_fric",
  s: "alveolar_fric", z: "alveolar_fric",
  j: "palatal_approx", y: "palatal_approx",
  l: "alveolar_liquid",
  r: "alveolar_trill",
  h: "glottal_fric",
  x: "other_consonant", q: "other_consonant", w: "other_consonant",
};

const EN_VOWEL_MAP: Record<string, VowelCategory> = {
  i: "front_close",
  e: "front_mid",
  a: "central_open",
  o: "back_mid",
  u: "back_close",
};

// EN digraphs that map to specific categories
const EN_DIGRAPH_CONSONANTS: [string, ConsonantCategory][] = [
  ["sh", "postalveolar_fric"],
  ["ch", "palatal_fric"],
  ["th", "alveolar_fric"],   // simplified
  ["ph", "labiodental_fric"],
  ["ng", "alveolar_nasal"],
  ["wh", "glottal_fric"],
];

// ── Feature extraction ───────────────────────────────────────────────────────

export interface PhoneticVector {
  /** Total syllable count */
  syllableCount: number;
  /** Average syllable length in characters */
  avgSyllableLength: number;
  /** Normalized consonant onset frequency distribution (14 categories) */
  consonantOnsetFreqs: number[];
  /** Normalized vowel frequency distribution (7 categories) */
  vowelFreqs: number[];
  /** Words per phrase (sentence), averaged */
  avgWordsPerPhrase: number;
  /** Total word count */
  wordCount: number;
}

/** Count syllables in Russian text (= number of vowels) */
function countSyllablesRu(word: string): number {
  return (word.match(/[аеёиоуыэюя]/gi) || []).length || 1;
}

/** Count syllables in English text (heuristic) */
function countSyllablesEn(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 2) return 1;
  let count = (w.match(/[aeiouy]+/g) || []).length;
  if (w.endsWith("e") && !w.endsWith("le") && count > 1) count--;
  if (w.endsWith("ed") && count > 1) count--;
  return Math.max(1, count);
}

function splitPhrases(text: string): string[] {
  return text.split(/[.!?;…]+/).map(s => s.trim()).filter(Boolean);
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(w => w.replace(/[^\p{L}]/gu, "").length > 0);
}

/**
 * Extract consonant onset categories from text.
 * "Onset" = first consonant(s) of each word — measures alliteration.
 */
function extractOnsets(
  words: string[],
  consonantMap: Record<string, ConsonantCategory>,
  digraphs: [string, ConsonantCategory][] = [],
): ConsonantCategory[] {
  const onsets: ConsonantCategory[] = [];
  for (const word of words) {
    const w = word.toLowerCase().replace(/[^\p{L}]/gu, "");
    if (!w) continue;

    // Check digraphs first (EN only)
    let found = false;
    for (const [di, cat] of digraphs) {
      if (w.startsWith(di)) {
        onsets.push(cat);
        found = true;
        break;
      }
    }
    if (found) continue;

    const firstChar = w[0];
    const cat = consonantMap[firstChar];
    if (cat) onsets.push(cat);
  }
  return onsets;
}

/** Extract all vowel categories from text */
function extractVowels(
  text: string,
  vowelMap: Record<string, VowelCategory>,
): VowelCategory[] {
  const vowels: VowelCategory[] = [];
  for (const ch of text.toLowerCase()) {
    const cat = vowelMap[ch];
    if (cat) vowels.push(cat);
  }
  return vowels;
}

/** Normalize a category frequency array to sum=1 */
function normalizeFreqs(counts: number[]): number[] {
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum === 0) return counts.map(() => 0);
  return counts.map(c => c / sum);
}

/**
 * Extract phonetic feature vector from text.
 *
 * @param text  - Source text (a segment or phrase)
 * @param lang  - Language: "ru" or "en"
 * @returns PhoneticVector with normalized frequency distributions
 */
export function extractPhoneticFeatures(text: string, lang: "ru" | "en"): PhoneticVector {
  const words = splitWords(text);
  const phrases = splitPhrases(text);
  const wordCount = words.length;

  // Syllables
  const countFn = lang === "ru" ? countSyllablesRu : countSyllablesEn;
  let totalSyllables = 0;
  for (const w of words) {
    totalSyllables += countFn(w);
  }

  const cleanChars = text.replace(/[^\p{L}]/gu, "").length;
  const avgSyllableLength = totalSyllables > 0 ? cleanChars / totalSyllables : 0;

  // Consonant onsets (alliteration)
  const consonantMap = lang === "ru" ? RU_CONSONANT_MAP : EN_CONSONANT_MAP;
  const digraphs = lang === "ru" ? [] : EN_DIGRAPH_CONSONANTS;
  const onsets = extractOnsets(words, consonantMap, digraphs);

  const consonantCounts = CONSONANT_CATEGORIES.map(cat =>
    onsets.filter(o => o === cat).length,
  );

  // Vowel frequencies (assonance)
  const vowelMap = lang === "ru" ? RU_VOWEL_MAP : EN_VOWEL_MAP;
  const vowels = extractVowels(text, vowelMap);
  const vowelCounts = VOWEL_CATEGORIES.map(cat =>
    vowels.filter(v => v === cat).length,
  );

  // Phrases
  const avgWordsPerPhrase = phrases.length > 0
    ? wordCount / phrases.length
    : wordCount;

  return {
    syllableCount: totalSyllables,
    avgSyllableLength: Math.round(avgSyllableLength * 100) / 100,
    consonantOnsetFreqs: normalizeFreqs(consonantCounts),
    vowelFreqs: normalizeFreqs(vowelCounts),
    avgWordsPerPhrase: Math.round(avgWordsPerPhrase * 100) / 100,
    wordCount,
  };
}

// ── Similarity ───────────────────────────────────────────────────────────────

/** Cosine similarity between two vectors of equal length */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Compare rhythm between original and translation.
 * Returns 0–1 score based on syllable ratio, phrase length similarity, etc.
 */
export function compareRhythm(original: PhoneticVector, translation: PhoneticVector): number {
  // Syllable count ratio (closer to 1 = better)
  const syllRatio = original.syllableCount > 0
    ? Math.min(original.syllableCount, translation.syllableCount) /
      Math.max(original.syllableCount, translation.syllableCount)
    : 0;

  // Average syllable length similarity
  const maxAvg = Math.max(original.avgSyllableLength, translation.avgSyllableLength, 1);
  const avgSim = 1 - Math.abs(original.avgSyllableLength - translation.avgSyllableLength) / maxAvg;

  // Phrase length similarity
  const maxPhr = Math.max(original.avgWordsPerPhrase, translation.avgWordsPerPhrase, 1);
  const phrSim = 1 - Math.abs(original.avgWordsPerPhrase - translation.avgWordsPerPhrase) / maxPhr;

  // Weighted average
  return Math.max(0, Math.min(1,
    syllRatio * 0.4 + avgSim * 0.3 + phrSim * 0.3,
  ));
}

/**
 * Compare phonetic "texture" (alliteration/assonance) between original and translation.
 * Returns 0–1 score.
 */
export function comparePhonetics(original: PhoneticVector, translation: PhoneticVector): number {
  const consonantSim = cosineSimilarity(original.consonantOnsetFreqs, translation.consonantOnsetFreqs);
  const vowelSim = cosineSimilarity(original.vowelFreqs, translation.vowelFreqs);

  // Consonant onsets (alliteration) weighted higher
  return consonantSim * 0.6 + vowelSim * 0.4;
}
