import { describe, expect, it } from "vitest";
import {
  comparePreferredProjectCandidates,
  isLegacyMirrorMeta,
  pickPreferredProjectCandidate,
} from "@/lib/projectSourcePolicy";

describe("projectSourcePolicy", () => {
  it("detects legacy mirror meta by legacy fields", () => {
    expect(isLegacyMirrorMeta({ targetLanguage: "en" })).toBe(true);
    expect(isLegacyMirrorMeta({ sourceProjectName: "Book" })).toBe(true);
    expect(isLegacyMirrorMeta({})).toBe(false);
    expect(isLegacyMirrorMeta(null)).toBe(false);
  });

  it("prefers a source project over a fresher legacy mirror", () => {
    const picked = pickPreferredProjectCandidate([
      { score: 200, isLegacyMirror: true, projectName: "Book_EN" },
      { score: 100, isLegacyMirror: false, projectName: "Book" },
    ]);

    expect(picked?.projectName).toBe("Book");
  });

  it("falls back to freshest candidate within the same project class", () => {
    expect(comparePreferredProjectCandidates(
      { score: 300, isLegacyMirror: false },
      { score: 100, isLegacyMirror: false },
    )).toBeLessThan(0);

    const picked = pickPreferredProjectCandidate([
      { score: 100, isLegacyMirror: true, projectName: "Book_EN_old" },
      { score: 300, isLegacyMirror: true, projectName: "Book_EN_new" },
    ]);

    expect(picked?.projectName).toBe("Book_EN_new");
  });
});