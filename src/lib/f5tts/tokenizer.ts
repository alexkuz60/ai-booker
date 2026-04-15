/**
 * f5tts/tokenizer.ts — Character-level tokenizer for F5-TTS.
 *
 * F5-TTS uses a simple character-level vocabulary (NOT BPE).
 * Each character maps to an integer token ID via vocab.txt.
 * Unknown characters fall back to a special <unk> token.
 */

/** Default vocab covering ASCII + common punctuation + Cyrillic */
const DEFAULT_VOCAB: string[] = [
  // 0 = <pad>, 1 = <unk>, 2 = <bos>, 3 = <eos>
  "<pad>", "<unk>", "<bos>", "<eos>",
  // ASCII printable (space=4, !=5, "=6, ...)
  " ", "!", "\"", "#", "$", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  ":", ";", "<", "=", ">", "?", "@",
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
  "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
  // Cyrillic lowercase
  "а", "б", "в", "г", "д", "е", "ё", "ж", "з", "и", "й", "к", "л", "м",
  "н", "о", "п", "р", "с", "т", "у", "ф", "х", "ц", "ч", "ш", "щ",
  "ъ", "ы", "ь", "э", "ю", "я",
];

let vocabMap: Map<string, number> | null = null;
let customVocab: string[] | null = null;

/** Load a custom vocab.txt (one token per line). Call before tokenize(). */
export function loadVocab(vocabText: string): void {
  const lines = vocabText.split("\n").map((l) => l.trim()).filter(Boolean);
  customVocab = lines;
  vocabMap = null; // rebuild on next tokenize
}

function ensureVocabMap(): Map<string, number> {
  if (vocabMap) return vocabMap;
  const src = customVocab ?? DEFAULT_VOCAB;
  vocabMap = new Map<string, number>();
  for (let i = 0; i < src.length; i++) {
    vocabMap.set(src[i], i);
  }
  return vocabMap;
}

const UNK_ID = 1;

/**
 * Tokenize text to Int32Array of token IDs.
 * Lowercases input, maps each character to vocab ID.
 */
export function tokenize(text: string): Int32Array {
  const map = ensureVocabMap();
  const lower = text.toLowerCase();
  const ids = new Int32Array(lower.length);
  for (let i = 0; i < lower.length; i++) {
    ids[i] = map.get(lower[i]) ?? UNK_ID;
  }
  return ids;
}

/** Get vocab size */
export function getVocabSize(): number {
  return ensureVocabMap().size;
}

/** Check if a character is in vocabulary */
export function isInVocab(char: string): boolean {
  return ensureVocabMap().has(char.toLowerCase());
}

/** Get coverage stats for a text string */
export function getVocabCoverage(text: string): { total: number; covered: number; missing: string[] } {
  const lower = text.toLowerCase();
  const map = ensureVocabMap();
  const missing = new Set<string>();
  let covered = 0;
  for (const ch of lower) {
    if (map.has(ch)) covered++;
    else missing.add(ch);
  }
  return { total: lower.length, covered, missing: [...missing] };
}
