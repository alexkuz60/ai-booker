import { describe, it, expect } from "vitest";
import {
  extractPhoneticFeatures,
  cosineSimilarity,
  compareRhythm,
  comparePhonetics,
} from "../phoneticFeatures";

describe("extractPhoneticFeatures", () => {
  it("counts Russian syllables correctly", () => {
    const f = extractPhoneticFeatures("Она шла домой", "ru");
    // о-на = 2, шла = 1, до-мой = 2 → 5
    expect(f.syllableCount).toBe(5);
    expect(f.wordCount).toBe(3);
  });

  it("counts English syllables correctly", () => {
    const f = extractPhoneticFeatures("She walked home today", "en");
    // she=1, walked=1, home=1, today=2 → 5
    expect(f.syllableCount).toBe(5);
    expect(f.wordCount).toBe(4);
  });

  it("produces normalized consonant freqs that sum to ~1", () => {
    const f = extractPhoneticFeatures("Красный кот кусал каштан", "ru");
    const sum = f.consonantOnsetFreqs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 2);
  });

  it("produces normalized vowel freqs that sum to ~1", () => {
    const f = extractPhoneticFeatures("Hello world and all", "en");
    const sum = f.vowelFreqs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 2);
  });

  it("handles empty text gracefully", () => {
    const f = extractPhoneticFeatures("", "ru");
    expect(f.syllableCount).toBe(0);
    expect(f.wordCount).toBe(0);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("handles zero vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("compareRhythm", () => {
  it("returns high score for similar rhythm", () => {
    const a = extractPhoneticFeatures("Она шла домой через парк", "ru");
    const b = extractPhoneticFeatures("She walked home through the park", "en");
    const score = compareRhythm(a, b);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("returns lower score for very different lengths", () => {
    const a = extractPhoneticFeatures("Да", "ru");
    const b = extractPhoneticFeatures(
      "Absolutely and without any shadow of a doubt yes indeed",
      "en",
    );
    const score = compareRhythm(a, b);
    expect(score).toBeLessThan(0.5);
  });
});

describe("comparePhonetics", () => {
  it("returns a score between 0 and 1", () => {
    const a = extractPhoneticFeatures("Шумел камыш деревья гнулись", "ru");
    const b = extractPhoneticFeatures("The reeds rustled trees were bending", "en");
    const score = comparePhonetics(a, b);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
