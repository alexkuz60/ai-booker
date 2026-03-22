/**
 * contentHash — FNV-1a 32-bit hash for content integrity checks.
 * Used to detect stale storyboards when scene text changes.
 */

export function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}
