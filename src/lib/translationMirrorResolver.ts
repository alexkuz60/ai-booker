import { OPFSStorage, type ProjectMeta, type ProjectStorage } from "@/lib/projectStorage";
import { paths } from "@/lib/projectPaths";

export type TranslationTargetLanguage = "en" | "ru";

export const TRANSLATION_MIRROR_SUFFIX_RE = /^(.*?)(?:[_\s-])(EN|RU)$/i;

type TranslationMirrorCandidate = {
  bookId: string | null;
  isMirrorLike: boolean;
  projectName: string;
  sourceProjectName: string | null;
  targetLanguage: TranslationTargetLanguage | null;
};

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
  try {
    const store = await OPFSStorage.openExisting(projectName);
    if (!store) return null;

    const meta = await store.readJSON<ProjectMeta>(paths.projectMeta()).catch(() => null);
    const toc = !meta?.bookId
      ? await store.readJSON<{ bookId?: string }>(paths.structureToc()).catch(() => null)
      : null;
    const targetLanguage = meta?.targetLanguage ?? inferTranslationTargetLanguageFromName(projectName);

    if (!meta && !toc) return null;

    return {
      bookId: meta?.bookId ?? toc?.bookId ?? null,
      isMirrorLike: Boolean(meta?.sourceProjectName || meta?.targetLanguage || targetLanguage),
      projectName,
      sourceProjectName: meta?.sourceProjectName ?? null,
      targetLanguage,
    };
  } catch (err) {
    console.warn("[translationMirrorResolver] error reading candidate:", projectName, err);
    return null;
  }
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
    const isPreferredTarget = candidate.targetLanguage === preferredTargetLanguage;

    if (linkedToCurrentSource && isPreferredTarget) {
      return projectName;
    }

    if (!linkedCandidate && linkedToCurrentSource) {
      linkedCandidate = projectName;
    }

    if (!sameBookCandidate && sameBook && isPreferredTarget) {
      sameBookCandidate = projectName;
    }
  }

  return preferredNameCandidate ?? linkedCandidate ?? sameBookCandidate ?? preferredNameByPresence ?? null;
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