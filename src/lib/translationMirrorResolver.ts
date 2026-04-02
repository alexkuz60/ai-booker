/**
 * translationMirrorResolver — translation mirror helpers.
 *
 * Runtime loading must use a single source of truth:
 * source project.json → translationProject.projectName.
 *
 * Suffix helpers remain only for mirror classification in library/source
 * project hygiene code. They must not be used to resolve translation loading.
 */

import type { ProjectMeta } from "@/lib/projectStorage";

export type TranslationTargetLanguage = "en" | "ru";

export const TRANSLATION_MIRROR_SUFFIX_RE = /^(.*?)(?:[_\s-])(EN|RU)$/i;

export function getLinkedTranslationProjectName(
  meta: Pick<ProjectMeta, "translationProject"> | null | undefined,
): string | null {
  const projectName = meta?.translationProject?.projectName?.trim();
  return projectName || null;
}

export function getExpectedTranslationProjectName(
  sourceProjectName: string,
  targetLanguage: TranslationTargetLanguage,
): string {
  return `${sourceProjectName}_${targetLanguage.toUpperCase()}`;
}

export function getTranslationMirrorSourceProjectName(projectName: string): string | null {
  const sourceProjectName = projectName.trim().match(TRANSLATION_MIRROR_SUFFIX_RE)?.[1]?.trim();
  return sourceProjectName || null;
}

export function isLikelyTranslationMirrorName(
  projectName: string,
  existingProjects?: Set<string>,
): boolean {
  const sourceProjectName = getTranslationMirrorSourceProjectName(projectName);
  if (!sourceProjectName) return false;
  if (existingProjects) return existingProjects.has(sourceProjectName);
  return true;
}
