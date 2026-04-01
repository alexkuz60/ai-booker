import { OPFSStorage, type ProjectMeta, type ProjectStorage } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";

export type TranslationTargetLanguage = "en" | "ru";

export const TRANSLATION_MIRROR_SUFFIX_RE = /^(.*?)(?:[_\s-])(EN|RU)$/i;
const TRANSLATION_LINK_STORAGE_PREFIX = "booker_translation_mirror";
const CANDIDATE_READ_RETRY_DELAYS_MS = [60, 180] as const;

type TranslationMirrorCandidate = {
  bookId: string | null;
  isMirrorLike: boolean;
  projectName: string;
  sourceProjectName: string | null;
  targetLanguage: TranslationTargetLanguage | null;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildPersistedTranslationLinkKeys(
  sourceProjectName: string,
  sourceBookId?: string | null,
): string[] {
  const keys = [`${TRANSLATION_LINK_STORAGE_PREFIX}:source:${sourceProjectName}`];
  if (sourceBookId) {
    keys.unshift(`${TRANSLATION_LINK_STORAGE_PREFIX}:book:${sourceBookId}`);
  }
  return keys;
}

export function readPersistedTranslationMirrorProjectName(opts: {
  sourceBookId?: string | null;
  sourceProjectName: string;
}): string | null {
  if (typeof localStorage === "undefined") return null;

  try {
    for (const key of buildPersistedTranslationLinkKeys(opts.sourceProjectName, opts.sourceBookId)) {
      const value = localStorage.getItem(key)?.trim();
      if (value) return value;
    }
  } catch {
    return null;
  }

  return null;
}

export function writePersistedTranslationMirrorProjectName(opts: {
  sourceBookId?: string | null;
  sourceProjectName: string;
  translationProjectName: string;
}): void {
  if (typeof localStorage === "undefined") return;

  const value = opts.translationProjectName.trim();
  if (!value) return;

  try {
    for (const key of buildPersistedTranslationLinkKeys(opts.sourceProjectName, opts.sourceBookId)) {
      localStorage.setItem(key, value);
    }
  } catch {
    // Non-fatal: persistence is only a resilience hint.
  }
}

export function inferTranslationTargetLanguageFromName(
  projectName: string,
): TranslationTargetLanguage | null {
  const match = projectName.match(TRANSLATION_MIRROR_SUFFIX_RE);
  if (!match) return null;
  return match[2].toLowerCase() === "en" ? "en" : "ru";
}

export function buildTranslationMirrorNames(
  sourceProjectName: string,
  targetLanguage: TranslationTargetLanguage,
  linkedProjectName?: string | null,
): string[] {
  const suffix = targetLanguage.toUpperCase();

  return Array.from(
    new Set(
      [
        linkedProjectName,
        `${sourceProjectName}_${suffix}`,
        `${sourceProjectName} ${suffix}`,
        `${sourceProjectName}-${suffix}`,
      ].filter((name): name is string => !!name),
    ),
  );
}

function matchesTargetBySuffix(
  projectName: string,
  targetLanguage: TranslationTargetLanguage,
): boolean {
  return inferTranslationTargetLanguageFromName(projectName) === targetLanguage;
}

async function readTranslationMirrorCandidate(
  projectName: string,
): Promise<TranslationMirrorCandidate | null> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= CANDIDATE_READ_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const store = await OPFSStorage.openExisting(projectName);
      if (!store) return null;

      const meta = await store.readJSON<ProjectMeta>(paths.projectMeta()).catch(() => null);
      const toc = !meta?.bookId
        ? await store.readJSON<{ bookId?: string }>(paths.structureToc()).catch(() => null)
        : null;
      const targetLanguage = meta?.targetLanguage ?? inferTranslationTargetLanguageFromName(projectName);

      if (meta || toc) {
        return {
          bookId: meta?.bookId ?? toc?.bookId ?? null,
          isMirrorLike: Boolean(meta?.sourceProjectName || meta?.targetLanguage || targetLanguage),
          projectName,
          sourceProjectName: meta?.sourceProjectName ?? null,
          targetLanguage,
        };
      }
    } catch (err) {
      lastError = err;
    }

    if (attempt < CANDIDATE_READ_RETRY_DELAYS_MS.length) {
      await wait(CANDIDATE_READ_RETRY_DELAYS_MS[attempt]);
    }
  }

  if (lastError) {
    console.warn("[translationMirrorResolver] error reading candidate:", projectName, lastError);
  }

  return null;
}

interface ResolveTranslationMirrorOptions {
  projects: string[];
  sourceMeta: Pick<ProjectMeta, "bookId" | "language" | "translationProject">;
  sourceStorage: Pick<ProjectStorage, "projectName">;
}

export async function resolveTranslationMirrorProjectName(
  opts: ResolveTranslationMirrorOptions,
): Promise<string | null> {
  const { projects, sourceMeta, sourceStorage } = opts;
  const projectSet = new Set(projects);
  const preferredTargetLanguage: TranslationTargetLanguage = sourceMeta.language === "en" ? "ru" : "en";
  const linkedProjectName = sourceMeta.translationProject?.projectName ?? null;
  const preferredNames = buildTranslationMirrorNames(
    sourceStorage.projectName,
    preferredTargetLanguage,
    linkedProjectName,
  );

  let preferredNameCandidate: string | null = null;
  let preferredNameByPresence: string | null = null;
  let linkedCandidate: string | null = null;
  let sameBookCandidate: string | null = null;
  let sameBookMirrorCandidate: string | null = null;

  for (const projectName of preferredNames) {
    if (projectName === sourceStorage.projectName || !projectSet.has(projectName)) continue;

    if (!preferredNameByPresence && (
      projectName === linkedProjectName ||
      matchesTargetBySuffix(projectName, preferredTargetLanguage)
    )) {
      preferredNameByPresence = projectName;
    }

    const candidate = await readTranslationMirrorCandidate(projectName);
    if (!candidate) {
      // OPFS read may fail transiently under concurrent writes; trust explicit backlink name if present.
      if (projectName === linkedProjectName) {
        console.warn("[translationMirrorResolver] using linked project by name fallback:", projectName);
        return projectName;
      }
      continue;
    }

    const sameBook = !candidate.bookId || candidate.bookId === sourceMeta.bookId;
    const sameTarget = !candidate.targetLanguage || candidate.targetLanguage === preferredTargetLanguage;

    if (sameBook && sameTarget && (candidate.isMirrorLike || projectName === linkedProjectName)) {
      return projectName;
    }

    if (!preferredNameCandidate && sameBook && sameTarget) {
      preferredNameCandidate = projectName;
    }
  }

  for (const projectName of projects) {
    if (projectName === sourceStorage.projectName) continue;

    const candidate = await readTranslationMirrorCandidate(projectName);
    if (!candidate?.isMirrorLike) continue;

    const sameBook = candidate.bookId === sourceMeta.bookId;
    const linkedToCurrentSource =
      candidate.sourceProjectName === sourceStorage.projectName || projectName === linkedProjectName;
    const matchesPreferredTarget = !candidate.targetLanguage || candidate.targetLanguage === preferredTargetLanguage;

    if (linkedToCurrentSource && matchesPreferredTarget) {
      return projectName;
    }

    if (!linkedCandidate && linkedToCurrentSource) {
      linkedCandidate = projectName;
    }

    if (!sameBookCandidate && sameBook && matchesPreferredTarget) {
      sameBookCandidate = projectName;
    }

    if (!sameBookMirrorCandidate && sameBook) {
      sameBookMirrorCandidate = projectName;
    }
  }

  return preferredNameCandidate
    ?? sameBookCandidate
    ?? linkedCandidate
    ?? sameBookMirrorCandidate
    ?? preferredNameByPresence
    ?? null;
}

interface TranslationMirrorProjectExistsOptions {
  linkedProjectName?: string | null;
  sourceBookId?: string | null;
  sourceProjectName: string;
  targetLanguage: TranslationTargetLanguage;
}

export async function translationMirrorProjectExists(
  opts: TranslationMirrorProjectExistsOptions,
): Promise<boolean> {
  const persistedProjectName = readPersistedTranslationMirrorProjectName({
    sourceBookId: opts.sourceBookId,
    sourceProjectName: opts.sourceProjectName,
  });
  if (persistedProjectName) {
    const persistedStore = await OPFSStorage.openExisting(persistedProjectName);
    if (persistedStore) return true;
  }

  const projects = await OPFSStorage.listProjects();
  const resolvedProjectName = await resolveTranslationMirrorProjectName({
    projects,
    sourceMeta: {
      bookId: opts.sourceBookId ?? "",
      language: opts.targetLanguage === "en" ? "ru" : "en",
      translationProject: opts.linkedProjectName
        ? {
            createdAt: "",
            projectName: opts.linkedProjectName,
            targetLanguage: opts.targetLanguage,
          }
        : undefined,
    },
    sourceStorage: { projectName: opts.sourceProjectName },
  });

  if (!resolvedProjectName) return false;

  if (!opts.sourceBookId) {
    return buildTranslationMirrorNames(
      opts.sourceProjectName,
      opts.targetLanguage,
      opts.linkedProjectName,
    ).includes(resolvedProjectName);
  }

  return true;
}