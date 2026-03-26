/**
 * sceneIndex — maps sceneId → chapterId for V2 path resolution.
 *
 * Persisted to `scene_index.json` in project root.
 * Loaded into memory on project open, updated on structure/storyboard changes.
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import type { TocChapter, Scene, ChapterStatus } from "@/pages/parser/types";
import { fnv1a32 } from "@/lib/contentHash";

// ─── Types ──────────────────────────────────────────────────

export interface SceneIndexEntry {
  chapterId: string;
  chapterIndex: number;
  sceneNumber: number;
  contentHash: number;
}

export interface SceneIndexData {
  version: 2;
  updatedAt: string;
  /** sceneId → entry */
  entries: Record<string, SceneIndexEntry>;
  /** Scene IDs that have storyboard data in OPFS */
  storyboarded: string[];
  /** Scene IDs that have character mapping data in OPFS */
  characterMapped: string[];
  /** Scene IDs whose content was changed in Parser AFTER storyboard analysis.
   *  Set ONLY by Parser (structure sync), cleared ONLY by Studio (successful re-analysis). */
  dirtyScenes: string[];
}

const INDEX_PATH = "scene_index.json";

// ─── In-memory cache ────────────────────────────────────────

let _cachedIndex: SceneIndexData | null = null;

export function getCachedSceneIndex(): SceneIndexData | null {
  return _cachedIndex;
}

export function setCachedSceneIndex(data: SceneIndexData | null): void {
  _cachedIndex = data;
}

/** Resolve chapterId for a given sceneId from the in-memory cache */
export function resolveChapterId(sceneId: string): string | undefined {
  return _cachedIndex?.entries[sceneId]?.chapterId;
}

/** Check if a scene has storyboard data without scanning directories */
export function isStoryboarded(sceneId: string): boolean {
  return _cachedIndex?.storyboarded.includes(sceneId) ?? false;
}

// ─── Persistence ────────────────────────────────────────────

export async function readSceneIndex(
  storage: ProjectStorage,
): Promise<SceneIndexData | null> {
  try {
    const data = await storage.readJSON<SceneIndexData>(INDEX_PATH);
    if (data?.version === 2) {
      _cachedIndex = data;
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeSceneIndex(
  storage: ProjectStorage,
  data: SceneIndexData,
): Promise<void> {
  try {
    data.updatedAt = new Date().toISOString();
    await storage.writeJSON(INDEX_PATH, data);
    _cachedIndex = data;
  } catch (err) {
    console.warn("[SceneIndex] Failed to write:", err);
  }
}

// ─── Build from structure data ──────────────────────────────

/**
 * Build scene index from chapter results (called during structure sync).
 */
export function buildSceneIndex(
  chapterIdMap: Map<number, string>,
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>,
  existingIndex?: SceneIndexData | null,
): SceneIndexData {
  const entries: Record<string, SceneIndexEntry> = {};

  chapterResults.forEach((result, chapterIndex) => {
    const chapterId = chapterIdMap.get(chapterIndex);
    if (!chapterId) return;

    result.scenes.forEach((scene, sceneNum) => {
      const sceneId = (scene as any).id;
      if (!sceneId) return;

      const content = (scene as any).content || "";
      entries[sceneId] = {
        chapterId,
        chapterIndex,
        sceneNumber: sceneNum + 1,
        contentHash: content ? fnv1a32(content) : 0,
      };
    });
  });

  // Prune stale scene IDs that no longer exist in the structure
  const validIds = new Set(Object.keys(entries));
  const storyboarded = (existingIndex?.storyboarded ?? []).filter(id => validIds.has(id));
  const characterMapped = (existingIndex?.characterMapped ?? []).filter(id => validIds.has(id));

  // Detect content changes: mark storyboarded scenes as dirty if their contentHash changed
  const prevDirty = new Set((existingIndex?.dirtyScenes ?? []).filter(id => validIds.has(id)));
  if (existingIndex) {
    for (const [sceneId, entry] of Object.entries(entries)) {
      const oldEntry = existingIndex.entries[sceneId];
      if (!oldEntry) continue;
      // Only mark dirty if scene had a storyboard AND content hash changed
      if (
        storyboarded.includes(sceneId) &&
        oldEntry.contentHash !== 0 &&
        entry.contentHash !== 0 &&
        oldEntry.contentHash !== entry.contentHash
      ) {
        prevDirty.add(sceneId);
      }
    }
  }

  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    entries,
    storyboarded,
    characterMapped,
    dirtyScenes: [...prevDirty],
  };
}

// ─── Index mutation helpers ─────────────────────────────────

export async function markStoryboarded(
  storage: ProjectStorage,
  sceneId: string,
): Promise<void> {
  if (!_cachedIndex) return;
  if (!_cachedIndex.storyboarded.includes(sceneId)) {
    _cachedIndex.storyboarded.push(sceneId);
    await writeSceneIndex(storage, _cachedIndex);
  }
}

export async function unmarkStoryboarded(
  storage: ProjectStorage,
  sceneId: string,
): Promise<void> {
  if (!_cachedIndex) return;
  const idx = _cachedIndex.storyboarded.indexOf(sceneId);
  if (idx >= 0) {
    _cachedIndex.storyboarded.splice(idx, 1);
    await writeSceneIndex(storage, _cachedIndex);
  }
}

export async function markCharacterMapped(
  storage: ProjectStorage,
  sceneId: string,
): Promise<void> {
  if (!_cachedIndex) return;
  if (!_cachedIndex.characterMapped.includes(sceneId)) {
    _cachedIndex.characterMapped.push(sceneId);
    await writeSceneIndex(storage, _cachedIndex);
  }
}

/**
 * Get content hash for a scene from the index.
 * Returns 0 if scene not found.
 */
export function getContentHash(sceneId: string): number {
  return _cachedIndex?.entries[sceneId]?.contentHash ?? 0;
}

// ─── Explicit dirty flag management ────────────────────────

/**
 * Check if a scene is dirty (content changed in Parser after storyboard analysis).
 * Uses EXPLICIT flag set by Parser, NOT hash comparison.
 */
export function isSceneDirty(sceneId: string): boolean {
  return _cachedIndex?.dirtyScenes?.includes(sceneId) ?? false;
}

/**
 * Mark a scene as dirty. Called ONLY from Parser (structure sync).
 */
export async function markSceneDirty(
  storage: ProjectStorage,
  sceneId: string,
): Promise<void> {
  if (!_cachedIndex) return;
  if (!_cachedIndex.dirtyScenes) _cachedIndex.dirtyScenes = [];
  if (!_cachedIndex.dirtyScenes.includes(sceneId)) {
    _cachedIndex.dirtyScenes.push(sceneId);
    await writeSceneIndex(storage, _cachedIndex);
  }
}

/**
 * Clear dirty flag for a scene. Called ONLY from Studio after successful re-analysis.
 */
export async function unmarkSceneDirty(
  storage: ProjectStorage,
  sceneId: string,
): Promise<void> {
  if (!_cachedIndex) return;
  if (!_cachedIndex.dirtyScenes) return;
  const idx = _cachedIndex.dirtyScenes.indexOf(sceneId);
  if (idx >= 0) {
    _cachedIndex.dirtyScenes.splice(idx, 1);
    await writeSceneIndex(storage, _cachedIndex);
  }
}
