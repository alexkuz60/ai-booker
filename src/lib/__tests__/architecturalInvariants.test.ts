// @vitest-environment node
/**
 * Architectural invariant tests.
 *
 * These tests scan the source code to prevent re-introduction of
 * dangerous patterns that have caused data loss or session hijacking.
 *
 * If a test fails, it means someone added code that violates the
 * "One Book = One Folder" architecture or the storageGuard protections.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// ── Helpers ─────────────────────────────────────────────────

function collectTsFiles(dir: string, result: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      collectTsFiles(fullPath, result);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts") && !entry.includes("architecturalInvariants")) {
      result.push(fullPath);
    }
  }
  return result;
}

function searchFiles(dir: string, pattern: RegExp): { file: string; line: number; text: string }[] {
  const matches: { file: string; line: number; text: string }[] = [];
  for (const filePath of collectTsFiles(dir)) {
    const content = readFileSync(filePath, "utf-8");
    content.split("\n").forEach((text, idx) => {
      if (pattern.test(text)) {
        matches.push({ file: filePath.replace(/^.*\/src\//, "src/"), line: idx + 1, text: text.trim() });
      }
    });
  }
  return matches;
}

const SRC_DIR = join(__dirname, "../..");

// ── Whitelist definitions ───────────────────────────────────

/** Files allowed to call OPFSStorage.listProjects() */
const LIST_PROJECTS_WHITELIST = new Set([
  "src/hooks/useLibrary.ts",             // Library scan
  "src/hooks/useBookManager.ts",         // Delete book, clear all
  "src/hooks/useProjectStorage.ts",      // openProject, openProjectByName, hardReset
  "src/lib/projectCleanup.ts",           // wipeProjectBrowserState diagnostic
  "src/components/parser/LibraryView.tsx", // resolveSourceProject
  "src/components/profile/tabs/OpfsBrowserPanel.tsx", // Admin OPFS browser
]);

/** Files allowed to call OPFSStorage.openOrCreate() */
const OPEN_OR_CREATE_WHITELIST = new Set([
  "src/hooks/useProjectStorage.ts", // createProject, importProjectFromZip
]);

/** Files allowed to call storage.delete() */
const STORAGE_DELETE_WHITELIST = new Set([
  "src/lib/storageGuard.ts", // guardedDelete — the ONLY gateway
]);

// ── Tests ───────────────────────────────────────────────────

describe("Architectural invariants", () => {
  it("OPFSStorage.listProjects() is only called from whitelisted files", () => {
    const matches = searchFiles(SRC_DIR, /OPFSStorage\.listProjects\s*\(/);
    const violations = matches.filter((m) => !LIST_PROJECTS_WHITELIST.has(m.file));

    if (violations.length > 0) {
      const msg = violations.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `OPFSStorage.listProjects() found in non-whitelisted files:\n${msg}\n\n` +
        `Allowed files: ${[...LIST_PROJECTS_WHITELIST].join(", ")}`
      );
    }
  });

  it("OPFSStorage.openOrCreate() is only called from whitelisted files", () => {
    const matches = searchFiles(SRC_DIR, /OPFSStorage\.openOrCreate\s*\(/);
    const violations = matches.filter((m) => !OPEN_OR_CREATE_WHITELIST.has(m.file));

    if (violations.length > 0) {
      const msg = violations.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `OPFSStorage.openOrCreate() found in non-whitelisted files:\n${msg}\n\n` +
        `Allowed files: ${[...OPEN_OR_CREATE_WHITELIST].join(", ")}`
      );
    }
  });

  it("storage.delete() is only called from guardedDelete", () => {
    const matches = searchFiles(SRC_DIR, /storage\.delete\s*\(/);
    const violations = matches.filter((m) => !STORAGE_DELETE_WHITELIST.has(m.file));

    if (violations.length > 0) {
      const msg = violations.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `storage.delete() found outside storageGuard:\n${msg}\n\n` +
        `All deletions must go through guardedDelete() in src/lib/storageGuard.ts`
      );
    }
  });

  it("projectSourcePolicy module does not exist (dead code removed)", () => {
    const matches = searchFiles(SRC_DIR, /projectSourcePolicy/);
    // Allow only this test file and migrateMirrorTranslation.ts
    const violations = matches.filter(
      (m) => !m.file.includes("architecturalInvariants.test") && !m.file.includes("migrateMirrorTranslation")
    );

    if (violations.length > 0) {
      const msg = violations.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `References to projectSourcePolicy found (should be fully removed):\n${msg}`
      );
    }
  });

  it("no resolveFreshestSourceProject function exists", () => {
    const matches = searchFiles(SRC_DIR, /resolveFreshestSourceProject/);
    const violations = matches.filter((m) => !m.file.includes("architecturalInvariants.test"));

    if (violations.length > 0) {
      const msg = violations.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `resolveFreshestSourceProject still exists (must be removed):\n${msg}`
      );
    }
  });

  it("no multi-candidate ranking functions exist (pickPreferred, comparePreferred)", () => {
    const matches = searchFiles(SRC_DIR, /pickPreferredProjectCandidate|comparePreferredProjectCandidates/);
    const violations = matches.filter((m) => !m.file.includes("architecturalInvariants.test"));

    if (violations.length > 0) {
      const msg = violations.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `Multi-candidate ranking functions still exist (must be removed):\n${msg}`
      );
    }
  });

  it("no isLegacyMirrorMeta usage outside migration utility", () => {
    const matches = searchFiles(SRC_DIR, /isLegacyMirrorMeta/);
    const violations = matches.filter(
      (m) => !m.file.includes("architecturalInvariants.test") && !m.file.includes("migrateMirrorTranslation")
    );

    if (violations.length > 0) {
      const msg = violations.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `isLegacyMirrorMeta used outside migration utility:\n${msg}`
      );
    }
  });
});
