/**
 * contentHash — FNV-1a 32-bit hash for scene text fingerprinting.
 *
 * Two distinct roles:
 * 1. PARSER (buildSceneIndex): computed on structure sync, stored in scene_index.json.
 *    If hash changed for a storyboarded scene → sets explicit dirtyScenes flag.
 * 2. STUDIO (BatchSegmentation/BackgroundAnalysis): computed at analysis time,
 *    stored in storyboard.json to record which text version was analyzed.
 *
 * NOT used for runtime dirty comparison. Dirty detection uses explicit flags only.
 */

export function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}
