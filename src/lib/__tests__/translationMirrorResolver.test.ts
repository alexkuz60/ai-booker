import { describe, expect, it } from "vitest";
import {
  getExpectedTranslationProjectName,
  getLinkedTranslationProjectName,
  getTranslationMirrorSourceProjectName,
  isLikelyTranslationMirrorName,
} from "../translationMirrorResolver";

describe("translationMirrorResolver", () => {
  it("extracts source project name from mirror variants", () => {
    expect(getTranslationMirrorSourceProjectName("Собачье сердце_EN")).toBe("Собачье сердце");
    expect(getTranslationMirrorSourceProjectName("Book RU")).toBe("Book");
    expect(getTranslationMirrorSourceProjectName("Book-RU")).toBe("Book");
    expect(getTranslationMirrorSourceProjectName("Book")).toBeNull();
  });

  it("detects likely mirrors only when the source project exists", () => {
    const existingProjects = new Set(["Собачье сердце", "Собачье сердце_EN"]);

    expect(isLikelyTranslationMirrorName("Собачье сердце_EN", existingProjects)).toBe(true);
    expect(isLikelyTranslationMirrorName("Чужой_EN", existingProjects)).toBe(false);
  });

  it("reads linked project name from source meta", () => {
    expect(getLinkedTranslationProjectName({
      translationProject: { projectName: "Book_EN" },
    } as any)).toBe("Book_EN");
    expect(getLinkedTranslationProjectName(null)).toBeNull();
  });

  it("builds deterministic mirror name", () => {
    expect(getExpectedTranslationProjectName("Book", "en")).toBe("Book_EN");
  });
});
