export interface PreferredProjectCandidate {
  score: number;
  isLegacyMirror: boolean;
}

export function isLegacyMirrorMeta(
  meta: unknown,
): boolean {
  if (!meta || typeof meta !== "object") return false;
  const candidate = meta as Record<string, unknown>;
  return typeof candidate.sourceProjectName === "string" || typeof candidate.targetLanguage === "string";
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