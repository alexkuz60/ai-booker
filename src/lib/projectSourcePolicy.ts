export interface ProjectIdentityMeta {
  bookId?: string;
  sourceProjectName?: string;
  targetLanguage?: string;
}

export interface PreferredProjectCandidate {
  score: number;
  isLegacyMirror: boolean;
}

export function isLegacyMirrorMeta(
  meta: Pick<ProjectIdentityMeta, "sourceProjectName" | "targetLanguage"> | null | undefined,
): boolean {
  return typeof meta?.sourceProjectName === "string" || typeof meta?.targetLanguage === "string";
}

export function comparePreferredProjectCandidates<T extends PreferredProjectCandidate>(a: T, b: T): number {
  if (a.isLegacyMirror !== b.isLegacyMirror) {
    return a.isLegacyMirror ? 1 : -1;
  }
  return b.score - a.score;
}

export function pickPreferredProjectCandidate<T extends PreferredProjectCandidate>(
  candidates: T[],
): T | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort(comparePreferredProjectCandidates)[0] ?? null;
}