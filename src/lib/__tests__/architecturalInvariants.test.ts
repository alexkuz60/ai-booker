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
  "src/hooks/useProjectStorage.ts",      // openProject, hardReset
  "src/lib/projectCleanup.ts",           // wipeProjectBrowserState diagnostic
  "src/components/profile/tabs/OpfsBrowserPanel.tsx", // Admin OPFS browser
]);

/** Files allowed to call OPFSStorage.createNewProject() */
const CREATE_NEW_PROJECT_WHITELIST = new Set([
  "src/hooks/useProjectStorage.ts", // createProject
]);

/** Files allowed to call OPFSStorage.restoreProjectFromBackup() */
const RESTORE_BACKUP_WHITELIST = new Set([
  "src/hooks/useProjectStorage.ts", // importProjectFromZip
  "src/lib/serverDeploy.ts",        // Wipe-and-Deploy restore
  "src/hooks/useBookRestore.ts",    // restore from server
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

  it("OPFSStorage.openOrCreate() must not exist anywhere (replaced by createNewProject / restoreProjectFromBackup)", () => {
    const matches = searchFiles(SRC_DIR, /OPFSStorage\.openOrCreate\s*\(/);
    if (matches.length > 0) {
      const msg = matches.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `OPFSStorage.openOrCreate() is BANNED. Use createNewProject() or restoreProjectFromBackup().\n${msg}`
      );
    }
  });

  it("OPFSStorage.createNewProject() is only called from whitelisted files", () => {
    const matches = searchFiles(SRC_DIR, /OPFSStorage\.createNewProject\s*\(/);
    const violations = matches.filter((m) => !CREATE_NEW_PROJECT_WHITELIST.has(m.file));

    if (violations.length > 0) {
      const msg = violations.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `OPFSStorage.createNewProject() found in non-whitelisted files:\n${msg}\n\n` +
        `Allowed files: ${[...CREATE_NEW_PROJECT_WHITELIST].join(", ")}`
      );
    }
  });

  it("OPFSStorage.restoreProjectFromBackup() is only called from whitelisted files", () => {
    const matches = searchFiles(SRC_DIR, /OPFSStorage\.restoreProjectFromBackup\s*\(/);
    const violations = matches.filter((m) => !RESTORE_BACKUP_WHITELIST.has(m.file));

    if (violations.length > 0) {
      const msg = violations.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `OPFSStorage.restoreProjectFromBackup() found in non-whitelisted files:\n${msg}\n\n` +
        `Allowed files: ${[...RESTORE_BACKUP_WHITELIST].join(", ")}`
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

    if (matches.length > 0) {
      const msg = matches.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `References to projectSourcePolicy found (should be fully removed):\n${msg}`
      );
    }
  });

  it("no resolveFreshestSourceProject function exists", () => {
    const matches = searchFiles(SRC_DIR, /resolveFreshestSourceProject/);

    if (matches.length > 0) {
      const msg = matches.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `resolveFreshestSourceProject still exists (must be removed):\n${msg}`
      );
    }
  });

  it("no multi-candidate ranking functions exist (pickPreferred, comparePreferred)", () => {
    const matches = searchFiles(SRC_DIR, /pickPreferredProjectCandidate|comparePreferredProjectCandidates/);

    if (matches.length > 0) {
      const msg = matches.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `Multi-candidate ranking functions still exist (must be removed):\n${msg}`
      );
    }
  });

  it("no isLegacyMirrorMeta usage anywhere", () => {
    const matches = searchFiles(SRC_DIR, /isLegacyMirrorMeta/);

    if (matches.length > 0) {
      const msg = matches.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `isLegacyMirrorMeta still referenced:\n${msg}`
      );
    }
  });

  it("no migrateMirrorTranslation module exists", () => {
    const matches = searchFiles(SRC_DIR, /migrateMirrorTranslation/);

    if (matches.length > 0) {
      const msg = matches.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join("\n");
      expect.fail(
        `migrateMirrorTranslation still referenced:\n${msg}`
      );
    }
  });
});
