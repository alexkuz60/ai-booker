/**
 * storageGuard — защита данных OPFS от случайного удаления.
 *
 * 1. guardedDelete(): единственный разрешённый способ удаления файлов в проекте.
 *    Проверяет путь по белому списку. Всё не в белом списке — отклоняется.
 * 2. snapshotBeforeWipe(): создаёт ZIP-бэкап проекта перед Wipe-and-Deploy.
 * 3. assertIntegrity(): проверяет, что критичные файлы не пропали после операции.
 * 4. destructiveOpsLog: журнал всех деструктивных операций (в памяти + console).
 */

import type { ProjectStorage } from "@/lib/projectStorage";

// ─── Destructive Operations Journal ─────────────────────────

export interface DestructiveLogEntry {
  timestamp: string;
  operation: string;
  path: string;
  caller: string;
  allowed: boolean;
  reason?: string;
}

const MAX_LOG_ENTRIES = 200;
const _journal: DestructiveLogEntry[] = [];

export function getDestructiveJournal(): readonly DestructiveLogEntry[] {
  return _journal;
}

function logEntry(entry: DestructiveLogEntry) {
  _journal.push(entry);
  if (_journal.length > MAX_LOG_ENTRIES) _journal.splice(0, _journal.length - MAX_LOG_ENTRIES);

  const icon = entry.allowed ? "🗑️" : "🚫";
  const status = entry.allowed ? "ALLOWED" : "BLOCKED";
  console.warn(
    `[StorageGuard] ${icon} ${status} delete "${entry.path}" by ${entry.caller}` +
    (entry.reason ? ` — ${entry.reason}` : ""),
  );
}

// ─── Allowed delete patterns ────────────────────────────────
// Whitelist approach: ONLY these patterns are allowed for in-project delete.
// Everything else is rejected.

const ALLOWED_DELETE_PATTERNS: RegExp[] = [
  // Single storyboard file (user re-analyzes a scene)
  /^chapters\/[^/]+\/scenes\/[^/]+\/storyboard\.json$/,
  // Single audio file (re-synthesis)
  /^chapters\/[^/]+\/scenes\/[^/]+\/audio\//,
  // TTS clips (re-synthesis of individual segments)
  /^chapters\/[^/]+\/scenes\/[^/]+\/tts\//,
  // Translation-specific storyboard (re-translate)
  /^chapters\/[^/]+\/scenes\/[^/]+\/[a-z]{2}\/storyboard\.json$/,
  // Translation audio (re-TTS in target language)
  /^chapters\/[^/]+\/scenes\/[^/]+\/[a-z]{2}\/audio\//,
  // Legacy translation audio files cleanup (audio_meta, mixer_state, clip_plugins in lang dirs)
  /^chapters\/[^/]+\/scenes\/[^/]+\/[a-z]{2}\/(audio_meta|mixer_state|clip_plugins)\.json$/,
];

/**
 * Guarded delete — only allows deletion of paths matching the whitelist.
 * ALL other deletions are blocked and logged.
 */
export async function guardedDelete(
  storage: ProjectStorage,
  path: string,
  caller: string,
): Promise<boolean> {
  const isAllowed = ALLOWED_DELETE_PATTERNS.some((pattern) => pattern.test(path));

  logEntry({
    timestamp: new Date().toISOString(),
    operation: "delete",
    path,
    caller,
    allowed: isAllowed,
    reason: isAllowed ? undefined : "Path not in whitelist",
  });

  if (!isAllowed) {
    console.error(
      `[StorageGuard] 🚫 BLOCKED deletion of "${path}" by ${caller}. ` +
      `Only explicitly whitelisted paths can be deleted.`,
    );
    return false;
  }

  await storage.delete(path);
  return true;
}

// ─── Pre-wipe snapshot ──────────────────────────────────────

const SNAPSHOT_KEY_PREFIX = "booker_pre_wipe_snapshot:";
const MAX_SNAPSHOTS = 3;

/**
 * Create a ZIP snapshot of the project before destructive operations.
 * Stored as a Blob in a module-level Map (survives within same tab session).
 */
const snapshotStore = new Map<string, { blob: Blob; createdAt: string }>();

export async function snapshotBeforeWipe(
  storage: ProjectStorage,
  bookId: string,
): Promise<boolean> {
  try {
    console.log(`[StorageGuard] 📸 Creating pre-wipe snapshot for bookId=${bookId}...`);
    const zipBlob = await storage.exportZip();
    const key = `${bookId}_${Date.now()}`;

    snapshotStore.set(key, {
      blob: zipBlob,
      createdAt: new Date().toISOString(),
    });

    // Trim old snapshots
    const keys = Array.from(snapshotStore.keys());
    while (keys.length > MAX_SNAPSHOTS) {
      const oldest = keys.shift()!;
      snapshotStore.delete(oldest);
    }

    console.log(
      `[StorageGuard] ✅ Snapshot created: ${key} (${(zipBlob.size / 1024).toFixed(1)} KB)`,
    );

    // Also note in localStorage that a snapshot exists
    try {
      localStorage.setItem(
        `${SNAPSHOT_KEY_PREFIX}${bookId}`,
        JSON.stringify({ key, size: zipBlob.size, createdAt: new Date().toISOString() }),
      );
    } catch {
      // localStorage full — non-critical
    }

    return true;
  } catch (err) {
    console.error("[StorageGuard] ❌ Failed to create pre-wipe snapshot:", err);
    return false;
  }
}

/**
 * Download the latest snapshot for a book as a file (recovery).
 */
export function downloadLatestSnapshot(bookId: string): boolean {
  const entries = Array.from(snapshotStore.entries())
    .filter(([key]) => key.startsWith(bookId))
    .sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt));

  if (entries.length === 0) return false;

  const [, { blob, createdAt }] = entries[0];
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `recovery_${bookId}_${createdAt.replace(/[:.]/g, "-")}.zip`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

// ─── Post-operation integrity assertions ────────────────────

/** Critical paths that MUST exist after a restore/sync operation */
const CRITICAL_PATHS = [
  "project.json",
  "structure/toc.json",
  "structure/chapters.json",
];

/** Per-chapter paths that should NOT disappear if they existed before */
const SCENE_CRITICAL_FILES = [
  "storyboard.json",
  "audio_meta.json",
  "clip_plugins.json",
  "mixer_state.json",
];

export interface IntegrityReport {
  passed: boolean;
  missingCritical: string[];
  missingSceneFiles: string[];
  scenesChecked: number;
  timestamp: string;
}

/**
 * Assert that critical project files still exist after an operation.
 * Returns a report; logs warnings for any missing files.
 */
export async function assertIntegrity(
  storage: ProjectStorage,
  operation: string,
): Promise<IntegrityReport> {
  const missing: string[] = [];
  const missingScene: string[] = [];
  let scenesChecked = 0;

  // Check project-level critical paths
  for (const path of CRITICAL_PATHS) {
    const exists = await storage.exists(path);
    if (!exists) missing.push(path);
  }

  // Check scene-level files
  try {
    const chapterDirs = await storage.listDir("chapters");
    for (const chId of chapterDirs) {
      const sceneDirs = await storage.listDir(`chapters/${chId}/scenes`).catch(() => []);
      for (const scId of sceneDirs) {
        scenesChecked++;
        for (const file of SCENE_CRITICAL_FILES) {
          const path = `chapters/${chId}/scenes/${scId}/${file}`;
          const exists = await storage.exists(path);
          // Only report missing if storyboard exists (scene was processed)
          if (!exists && file !== "storyboard.json") {
            const sbExists = await storage.exists(`chapters/${chId}/scenes/${scId}/storyboard.json`);
            if (sbExists) missingScene.push(path);
          }
        }

        // Check language subdirectories
        const sceneContents = await storage.listDir(`chapters/${chId}/scenes/${scId}`).catch(() => []);
        for (const item of sceneContents) {
          if (/^[a-z]{2}$/.test(item)) {
            // Language subdir — check it has storyboard if parent does
            const parentSb = await storage.exists(`chapters/${chId}/scenes/${scId}/storyboard.json`);
            if (parentSb) {
              const langSb = await storage.exists(`chapters/${chId}/scenes/${scId}/${item}/storyboard.json`);
              if (!langSb) missingScene.push(`chapters/${chId}/scenes/${scId}/${item}/storyboard.json`);
            }
          }
        }
      }
    }
  } catch {
    // chapters dir may not exist yet — that's OK for new projects
  }

  const passed = missing.length === 0;

  const report: IntegrityReport = {
    passed,
    missingCritical: missing,
    missingSceneFiles: missingScene,
    scenesChecked,
    timestamp: new Date().toISOString(),
  };

  if (!passed) {
    console.error(
      `[StorageGuard] ❌ INTEGRITY CHECK FAILED after "${operation}":`,
      `Missing critical: ${missing.join(", ")}`,
    );
  } else {
    console.log(
      `[StorageGuard] ✅ Integrity OK after "${operation}": ` +
      `${scenesChecked} scenes checked, ${missingScene.length} non-critical warnings`,
    );
  }

  if (missingScene.length > 0) {
    console.warn(
      `[StorageGuard] ⚠️ Missing scene-level files (data may have been lost):`,
      missingScene,
    );
  }

  return report;
}