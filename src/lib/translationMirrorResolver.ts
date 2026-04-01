/**
 * translationMirrorResolver — helpers for linking source ↔ translation OPFS projects.
 *
 * Simple utilities: build canonical names, persist/read the link in localStorage.
 */

export type TranslationTargetLanguage = "en" | "ru";

export const TRANSLATION_MIRROR_SUFFIX_RE = /^(.*?)(?:[_\s-])(EN|RU)$/i;
const TRANSLATION_LINK_STORAGE_PREFIX = "booker_translation_mirror";

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
