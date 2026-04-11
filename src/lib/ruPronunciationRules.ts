/**
 * Russian pronunciation correction rules for TTS.
 *
 * Given a word, produces a list of possible phonetic corrections
 * the user can apply to make synthesised speech sound more natural.
 */

export interface PronunciationSuggestion {
  /** Human-readable label, e.g. "ж → ш (оглушение)" */
  label: string;
  /** The original substring in the word */
  original: string;
  /** The replacement substring */
  replacement: string;
  /** Character index in the word where the original starts */
  index: number;
  /** Rule category for grouping */
  rule: string;
}

// ── helpers ──────────────────────────────────────────────────

const VOWELS = new Set("аеёиоуыэюя");
const VOICED = new Set("бвгджз");
const VOICELESS = new Set("пфктшсхцчщ");

const DEVOICE_MAP: Record<string, string> = {
  б: "п", в: "ф", г: "к", д: "т", ж: "ш", з: "с",
};
const VOICE_MAP: Record<string, string> = {
  п: "б", ф: "в", к: "г", т: "д", ш: "ж", с: "з",
};

function isVowel(ch: string) { return VOWELS.has(ch); }

/** Very simple stressed-vowel detector: ё is always stressed; uppercase = stressed */
function isStressed(ch: string, idx: number, word: string): boolean {
  if (ch === "ё" || ch === "Ё") return true;
  // If only one vowel — it's stressed
  const vowelCount = [...word.toLowerCase()].filter(c => VOWELS.has(c)).length;
  if (vowelCount <= 1) return true;
  // Uppercase vowel hint (user may mark stress)
  if (ch >= "А" && ch <= "Я" && VOWELS.has(ch.toLowerCase())) return true;
  return false;
}

// ── rule generators ──────────────────────────────────────────

function devoicingAtEnd(w: string): PronunciationSuggestion[] {
  const lower = w.toLowerCase();
  const last = lower[lower.length - 1];
  if (!VOICED.has(last)) return [];
  const rep = DEVOICE_MAP[last];
  if (!rep) return [];
  return [{
    label: `${last} → ${rep} (оглушение на конце / devoicing)`,
    original: w[w.length - 1],
    replacement: rep,
    index: w.length - 1,
    rule: "devoicing_end",
  }];
}

function devoicingBeforeVoiceless(w: string): PronunciationSuggestion[] {
  const lower = w.toLowerCase();
  const results: PronunciationSuggestion[] = [];
  for (let i = 0; i < lower.length - 1; i++) {
    if (VOICED.has(lower[i]) && VOICELESS.has(lower[i + 1])) {
      const rep = DEVOICE_MAP[lower[i]];
      if (rep) {
        results.push({
          label: `${lower[i]} → ${rep} перед «${lower[i + 1]}» (ассимиляция / assimilation)`,
          original: w[i],
          replacement: rep,
          index: i,
          rule: "assimilation_voiceless",
        });
      }
    }
  }
  return results;
}

function voicingBeforeVoiced(w: string): PronunciationSuggestion[] {
  const lower = w.toLowerCase();
  const results: PronunciationSuggestion[] = [];
  for (let i = 0; i < lower.length - 1; i++) {
    if (VOICELESS.has(lower[i]) && VOICED.has(lower[i + 1])) {
      const rep = VOICE_MAP[lower[i]];
      if (rep) {
        results.push({
          label: `${lower[i]} → ${rep} перед «${lower[i + 1]}» (озвончение / voicing)`,
          original: w[i],
          replacement: rep,
          index: i,
          rule: "assimilation_voiced",
        });
      }
    }
  }
  return results;
}

function akanje(w: string): PronunciationSuggestion[] {
  const lower = w.toLowerCase();
  const results: PronunciationSuggestion[] = [];
  for (let i = 0; i < lower.length; i++) {
    if (lower[i] === "о" && !isStressed(w[i], i, w)) {
      results.push({
        label: `о → а (аканье / akanje)`,
        original: w[i],
        replacement: "а",
        index: i,
        rule: "akanje",
      });
    }
  }
  return results;
}

function ikanje(w: string): PronunciationSuggestion[] {
  const lower = w.toLowerCase();
  const results: PronunciationSuggestion[] = [];
  for (let i = 0; i < lower.length; i++) {
    if (lower[i] === "е" && !isStressed(w[i], i, w)) {
      results.push({
        label: `е → и (иканье / ikanje)`,
        original: w[i],
        replacement: "и",
        index: i,
        rule: "ikanje",
      });
    }
  }
  return results;
}

// ── digraph / cluster rules ──────────────────────────────────

interface ClusterRule {
  pattern: RegExp;
  from: string;
  to: string;
  label_ru: string;
  label_en: string;
  rule: string;
}

const CLUSTER_RULES: ClusterRule[] = [
  { pattern: /чн/gi, from: "чн", to: "шн", label_ru: "чн → шн", label_en: "čn → šn", rule: "chn_shn" },
  { pattern: /чт/gi, from: "чт", to: "шт", label_ru: "чт → шт", label_en: "čt → št", rule: "cht_sht" },
  { pattern: /тся/gi, from: "тся", to: "ца", label_ru: "тся → ца", label_en: "tsja → ca", rule: "tsya_ca" },
  { pattern: /ться/gi, from: "ться", to: "ца", label_ru: "ться → ца", label_en: "t'sja → ca", rule: "tsya_ca" },
  { pattern: /стн/gi, from: "стн", to: "сн", label_ru: "стн → сн (непроизносимая т)", label_en: "stn → sn (silent t)", rule: "silent_consonant" },
  { pattern: /здн/gi, from: "здн", to: "зн", label_ru: "здн → зн (непроизносимая д)", label_en: "zdn → zn (silent d)", rule: "silent_consonant" },
  { pattern: /лнц/gi, from: "лнц", to: "нц", label_ru: "лнц → нц (непроизносимая л)", label_en: "lnc → nc (silent l)", rule: "silent_consonant" },
  { pattern: /рдц/gi, from: "рдц", to: "рц", label_ru: "рдц → рц (непроизносимая д)", label_en: "rdc → rc (silent d)", rule: "silent_consonant" },
  { pattern: /вств/gi, from: "вств", to: "ств", label_ru: "вств → ств (непроизносимая в)", label_en: "vstv → stv (silent v)", rule: "silent_consonant" },
  { pattern: /нтск/gi, from: "нтск", to: "нск", label_ru: "нтск → нск (непроизносимая т)", label_en: "ntsk → nsk (silent t)", rule: "silent_consonant" },
  { pattern: /стск/gi, from: "стск", to: "сск", label_ru: "стск → сск (непроизносимая т)", label_en: "stsk → ssk (silent t)", rule: "silent_consonant" },
];

function clusterCorrections(w: string): PronunciationSuggestion[] {
  const lower = w.toLowerCase();
  const results: PronunciationSuggestion[] = [];

  for (const rule of CLUSTER_RULES) {
    let match: RegExpExecArray | null;
    const re = new RegExp(rule.pattern.source, "gi");
    while ((match = re.exec(lower)) !== null) {
      results.push({
        label: `${rule.label_ru} / ${rule.label_en}`,
        original: w.slice(match.index, match.index + rule.from.length),
        replacement: rule.to,
        index: match.index,
        rule: rule.rule,
      });
    }
  }

  return results;
}

// ── public API ───────────────────────────────────────────────

/**
 * Analyse a Russian word and return all applicable pronunciation corrections.
 */
export function getCorrections(word: string): PronunciationSuggestion[] {
  if (!word || word.length < 2) return [];

  return [
    ...clusterCorrections(word),
    ...devoicingAtEnd(word),
    ...devoicingBeforeVoiceless(word),
    ...voicingBeforeVoiced(word),
    ...akanje(word),
    ...ikanje(word),
  ];
}

/**
 * Apply a single correction to a phrase text.
 * Returns the new phrase text with the replacement applied at the correct position.
 */
export function applyCorrection(
  phraseText: string,
  wordStart: number,
  suggestion: PronunciationSuggestion,
): string {
  const absIndex = wordStart + suggestion.index;
  const before = phraseText.slice(0, absIndex);
  const after = phraseText.slice(absIndex + suggestion.original.length);
  return before + suggestion.replacement + after;
}
