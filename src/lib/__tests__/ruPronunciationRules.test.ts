import { describe, it, expect } from "vitest";
import { getCorrections, applyCorrection } from "../ruPronunciationRules";

function findByRule(word: string, rule: string) {
  return getCorrections(word).filter(c => c.rule === rule);
}

describe("ruPronunciationRules", () => {
  // 1. Оглушение на конце слова
  describe("devoicing at word end", () => {
    it.each([
      ["сторож", "ж", "ш"],
      ["хлеб", "б", "п"],
      ["друг", "г", "к"],
      ["город", "д", "т"],
      ["мороз", "з", "с"],
    ])("%s: %s → %s", (word, from, to) => {
      const hits = findByRule(word, "devoicing_end");
      expect(hits.length).toBe(1);
      expect(hits[0].original).toBe(from);
      expect(hits[0].replacement).toBe(to);
    });

    it("no devoicing for voiceless ending", () => {
      expect(findByRule("кот", "devoicing_end")).toHaveLength(0);
    });
  });

  // 2. Ассимиляция по глухости
  describe("assimilation (voiceless)", () => {
    it("сказка: з → с перед к", () => {
      const hits = findByRule("сказка", "assimilation_voiceless");
      expect(hits.length).toBe(1);
      expect(hits[0].original).toBe("з");
      expect(hits[0].replacement).toBe("с");
    });

    it("ложка: ж → ш перед к", () => {
      const hits = findByRule("ложка", "assimilation_voiceless");
      expect(hits.length).toBe(1);
      expect(hits[0].original).toBe("ж");
      expect(hits[0].replacement).toBe("ш");
    });
  });

  // 3. Ассимиляция по звонкости
  describe("assimilation (voiced)", () => {
    it("сделать: с → з перед д", () => {
      const hits = findByRule("сделать", "assimilation_voiced");
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits[0].original).toBe("с");
      expect(hits[0].replacement).toBe("з");
    });
  });

  // 4. Аканье (безударное о → а)
  describe("akanje", () => {
    it("молоко: unstressed о → а", () => {
      const hits = findByRule("молоко", "akanje");
      expect(hits.length).toBeGreaterThanOrEqual(2);
      hits.forEach(h => {
        expect(h.original).toBe("о");
        expect(h.replacement).toBe("а");
      });
    });

    it("ё is always stressed, no akanje for single-vowel words", () => {
      expect(findByRule("кот", "akanje")).toHaveLength(0); // single vowel = stressed
    });
  });

  // 5. Иканье (безударное е → и)
  describe("ikanje", () => {
    it("весна: е → и", () => {
      const hits = findByRule("весна", "ikanje");
      expect(hits.length).toBe(1);
      expect(hits[0].original).toBe("е");
      expect(hits[0].replacement).toBe("и");
    });
  });

  // 6. чн → шн
  describe("чн → шн", () => {
    it("конечно", () => {
      const hits = findByRule("конечно", "chn_shn");
      expect(hits.length).toBe(1);
      expect(hits[0].replacement).toBe("шн");
    });
  });

  // 7. чт → шт
  describe("чт → шт", () => {
    it("что", () => {
      const hits = findByRule("что", "cht_sht");
      expect(hits.length).toBe(1);
      expect(hits[0].replacement).toBe("шт");
    });
  });

  // 8. тся/ться → ца
  describe("тся/ться → ца", () => {
    it("учиться", () => {
      const hits = findByRule("учиться", "tsya_ca");
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits[0].replacement).toBe("ца");
    });

    it("учится", () => {
      const hits = findByRule("учится", "tsya_ca");
      expect(hits.length).toBe(1);
      expect(hits[0].replacement).toBe("ца");
    });
  });

  // 9. Непроизносимые согласные
  describe("silent consonants", () => {
    it.each([
      ["честный", "стн", "сн"],
      ["поздно", "здн", "зн"],
      ["солнце", "лнц", "нц"],
      ["сердце", "рдц", "рц"],
      ["чувство", "вств", "ств"],
    ])("%s: %s → %s", (word, from, to) => {
      const hits = findByRule(word, "silent_consonant");
      expect(hits.length).toBe(1);
      expect(hits[0].original.toLowerCase()).toBe(from);
      expect(hits[0].replacement).toBe(to);
    });
  });

  // applyCorrection
  describe("applyCorrection", () => {
    it("replaces at correct position in phrase", () => {
      const phrase = "он сказал сказку";
      const corrections = getCorrections("сказку");
      const voiceless = corrections.find(c => c.rule === "assimilation_voiceless");
      expect(voiceless).toBeDefined();
      const result = applyCorrection(phrase, 10, voiceless!);
      expect(result).toBe("он сказал скаску");
    });
  });

  // Edge cases
  describe("edge cases", () => {
    it("empty / short words return no corrections", () => {
      expect(getCorrections("")).toHaveLength(0);
      expect(getCorrections("а")).toHaveLength(0);
    });
  });
});
