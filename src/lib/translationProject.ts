/**
 * translationProject — creates a mirror OPFS project for art-translation.
 *
 * Copies structural data (toc, scene_index, chapter content) from the source
 * project, but only for chapters whose scenes are fully storyboarded ("Done").
 * Storyboard segment structure is copied with empty translation text.
 *
 * The new project's ProjectMeta gets `sourceProjectName` and `targetLanguage`.
 */

import type { ProjectStorage, ProjectMeta } from "@/lib/projectStorage";
import { OPFSStorage, PROJECT_META_VERSION } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";
import type { SceneIndexData } from "@/lib/sceneIndex";
import type { LocalStoryboardData } from "@/lib/storyboardSync";
import type { TocChapter } from "@/pages/parser/types";
import { readSceneIndex } from "@/lib/sceneIndex";

// ─── Types ──────────────────────────────────────────────────

export interface TranslationReadiness {
  /** Chapter index → list of scene IDs that are storyboarded */
  readyChapters: Map<number, string[]>;
  /** Chapter index → list of scene IDs NOT storyboarded */
  notReadyChapters: Map<number, string[]>;
  /** Total storyboarded scenes */
  totalReady: number;
  /** Total scenes */
  totalScenes: number;
}

/** Check which chapters are ready for translation (all scenes storyboarded). */
export async function checkTranslationReadiness(
  storage: ProjectStorage,
): Promise<TranslationReadiness> {
  const sceneIndex = await storage.readJSON<SceneIndexData>(paths.sceneIndex());
  const storyboarded = new Set(sceneIndex?.storyboarded ?? []);
  const entries = sceneIndex?.entries ?? {};

  const readyChapters = new Map<number, string[]>();
  const notReadyChapters = new Map<number, string[]>();

  // Group scenes by chapterIndex
  const byChapter = new Map<number, string[]>();
  for (const [sceneId, entry] of Object.entries(entries)) {
    const list = byChapter.get(entry.chapterIndex) ?? [];
    list.push(sceneId);
    byChapter.set(entry.chapterIndex, list);
  }

  let totalReady = 0;
  let totalScenes = 0;

  for (const [chapterIndex, sceneIds] of byChapter) {
    const ready = sceneIds.filter((id) => storyboarded.has(id));
    const notReady = sceneIds.filter((id) => !storyboarded.has(id));
    totalReady += ready.length;
    totalScenes += sceneIds.length;

    if (notReady.length === 0 && ready.length > 0) {
      readyChapters.set(chapterIndex, ready);
    } else {
      notReadyChapters.set(chapterIndex, notReady);
    }
  }

  return { readyChapters, notReadyChapters, totalReady, totalScenes };
}

// ─── Create translation project ─────────────────────────────

export interface CreateTranslationOpts {
  sourceStorage: ProjectStorage;
  sourceMeta: ProjectMeta;
  targetLanguage: "en" | "ru";
  /** Chapter indices to include (only fully storyboarded) */
  chapterIndices: number[];
  /** Progress callback: step label + fraction 0..1 */
  onProgress?: (label: string, fraction: number) => void;
}

/** Check if a translation project already exists in OPFS */
export async function translationProjectExists(
  sourceProjectName: string,
  targetLanguage: "en" | "ru",
): Promise<boolean> {
  const langSuffix = targetLanguage.toUpperCase();
  const projectName = `${sourceProjectName}_${langSuffix}`;
  const store = await OPFSStorage.openExisting(projectName);
  if (!store) return false;

  const meta = await store.readJSON<Pick<ProjectMeta, "sourceProjectName" | "targetLanguage">>(paths.projectMeta());
  return meta?.sourceProjectName === sourceProjectName && meta?.targetLanguage === targetLanguage;
}

export async function createTranslationProject(
  opts: CreateTranslationOpts,
): Promise<ProjectStorage> {
  const { sourceStorage, sourceMeta, targetLanguage, chapterIndices, onProgress } = opts;
  const progress = onProgress ?? (() => {});

  // Guard: never create nested mirrors like *_EN_RU or *_RU_EN
  // Source project for translation must be the original project.
  if (sourceMeta.sourceProjectName || sourceMeta.targetLanguage || /_(EN|RU)$/i.test(sourceStorage.projectName)) {
    throw new Error("Invalid translation source project");
  }

  // 1. Derive project name
  const langSuffix = targetLanguage.toUpperCase();
  const projectName = `${sourceStorage.projectName}_${langSuffix}`;

  progress("Creating project…", 0);

  // 2. Create OPFS project
  const store = await OPFSStorage.openOrCreate(projectName);

  // 3. Write project.json with translation metadata
  progress("Writing metadata…", 0.05);
  const translationMeta: ProjectMeta & { layoutVersion: number } = {
    version: PROJECT_META_VERSION,
    bookId: sourceMeta.bookId, // same bookId for cross-reference
    title: `${sourceMeta.title} [${langSuffix}]`,
    userId: sourceMeta.userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    language: targetLanguage,
    sourceProjectName: sourceStorage.projectName,
    targetLanguage,
    layoutVersion: 2,
  };
  await store.writeJSON(paths.projectMeta(), translationMeta);
  await readSceneIndex(store);

  // 3b. Write back-link in source project.json (translationProject field)
  try {
    const srcMeta = (await sourceStorage.readJSON<Record<string, unknown>>(paths.projectMeta())) ?? {};
    srcMeta.translationProject = {
      projectName,
      targetLanguage,
      createdAt: translationMeta.createdAt,
    };
    srcMeta.updatedAt = new Date().toISOString();
    await sourceStorage.writeJSON(paths.projectMeta(), srcMeta);
  } catch (e) {
    console.warn("[translationProject] Failed to write back-link to source:", e);
  }

  // 4. Copy structure/toc.json
  progress("Copying structure…", 0.1);
  const toc = await sourceStorage.readJSON<{ toc: TocChapter[]; parts: unknown[] }>(
    paths.structureToc(),
  );
  if (toc) {
    await store.writeJSON(paths.structureToc(), toc);
  }

  // 5. Copy structure/chapters.json (chapterIndex→uuid map)
  const chaptersMap = await sourceStorage.readJSON(paths.structureChapters());
  if (chaptersMap) {
    await store.writeJSON(paths.structureChapters(), chaptersMap);
  }

  // 6. Copy characters.json (for later name/description translation)
  progress("Copying characters…", 0.15);
  const characters = await sourceStorage.readJSON(paths.characterIndex());
  if (characters) {
    await store.writeJSON(paths.characterIndex(), characters);
  }

  // 7. Copy scene_index.json — filtered to selected chapters only
  progress("Copying scene index…", 0.2);
  const sceneIndex = await sourceStorage.readJSON<SceneIndexData>(paths.sceneIndex());
  if (sceneIndex) {
    const selectedIndices = new Set(chapterIndices);
    const filteredEntries: SceneIndexData["entries"] = {};
    const filteredStoryboarded: string[] = [];

    for (const [sceneId, entry] of Object.entries(sceneIndex.entries)) {
      if (selectedIndices.has(entry.chapterIndex)) {
        filteredEntries[sceneId] = entry;
        if (sceneIndex.storyboarded.includes(sceneId)) {
          filteredStoryboarded.push(sceneId);
        }
      }
    }

    const translationIndex: SceneIndexData = {
      version: 2,
      updatedAt: new Date().toISOString(),
      entries: filteredEntries,
      storyboarded: filteredStoryboarded,
      characterMapped: [], // fresh start for translation
      dirtyScenes: [],
    };
    await store.writeJSON(paths.sceneIndex(), translationIndex);
  }

  // 8. Copy chapter content + storyboard structure
  const chapterIdMapRaw = chaptersMap as Record<string, string> | null;
  if (!chapterIdMapRaw) return store;

  const totalChapters = chapterIndices.length;
  for (let ci = 0; ci < totalChapters; ci++) {
    const chapterIdx = chapterIndices[ci];
    const chapterId = chapterIdMapRaw[String(chapterIdx)];
    if (!chapterId) continue;

    const frac = 0.25 + (ci / totalChapters) * 0.7;
    progress(`Chapter ${ci + 1}/${totalChapters}…`, frac);

    // Copy content.json (scene structure)
    const content = await sourceStorage.readJSON(paths.chapterContent(chapterId));
    if (content) {
      await store.writeJSON(paths.chapterContent(chapterId), content);
    }

    // Copy storyboard data for each scene (segment structure only, audio cleared)
    if (!sceneIndex) continue;
    const sceneIds = Object.entries(sceneIndex.entries)
      .filter(([, e]) => e.chapterId === chapterId)
      .map(([id]) => id);

    for (const sceneId of sceneIds) {
      const sbPath = `chapters/${chapterId}/scenes/${sceneId}/storyboard.json`;
      const sb = await sourceStorage.readJSON<LocalStoryboardData>(sbPath);
      if (!sb) continue;

      // Clone storyboard: keep segment structure + original text for bilingual view
      const translationSb: LocalStoryboardData = {
        ...sb,
        updatedAt: new Date().toISOString(),
        segments: sb.segments.map((seg) => ({
          ...seg,
          phrases: seg.phrases.map((ph) => ({
            ...ph,
            text: ph.text, // original stays for bilingual view
          })),
        })),
        // Clear audio status — translation needs its own TTS
        audioStatus: {},
      };
      await store.writeJSON(sbPath, translationSb);

      // Copy scene-level character map if exists
      const charMapPath = `chapters/${chapterId}/scenes/${sceneId}/characters.json`;
      const charMap = await sourceStorage.readJSON(charMapPath);
      if (charMap) {
        await store.writeJSON(charMapPath, charMap);
      }
    }
  }

  progress("Done", 1);
  return store;
}
