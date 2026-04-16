/**
 * f5tts/tokenizer.ts — Character-level tokenizer for F5-TTS.
 *
 * Uses vocab from Misha24-10/F5-TTS_RUSSIAN (2545 tokens).
 * Each character maps to an integer token ID.
 * Unknown characters fall back to UNK_ID (index of space as safe fallback).
 */

import { F5_VOCAB_RU } from "./vocabRu";

let vocabMap: Map<string, number> | null = null;
let activeVocab: readonly string[] = F5_VOCAB_RU;

/** Load a custom vocab.txt (one token per line). Call before tokenize(). */
export function loadVocab(vocabText: string): void {
  const lines = vocabText.split("\n").map((l) => l.trim()).filter(Boolean);
  activeVocab = lines;
  vocabMap = null; // rebuild on next tokenize
}

/** Reset to built-in Russian vocab */
export function resetVocab(): void {
  activeVocab = F5_VOCAB_RU;
  vocabMap = null;
}

function ensureVocabMap(): Map<string, number> {
  if (vocabMap) return vocabMap;
  vocabMap = new Map<string, number>();
  for (let i = 0; i < activeVocab.length; i++) {
    vocabMap.set(activeVocab[i], i);
  }
  return vocabMap;
}

// Space token (index 0) used as fallback for unknown chars
const UNK_ID = 0;

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
  return activeVocab.length;
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
