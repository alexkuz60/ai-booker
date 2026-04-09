/**
 * Build a voice_configs payload from OPFS characters.json for passing to synthesize-scene Edge Function.
 * This ensures the Edge Function uses the same voice settings the user configured locally (K4 contract).
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import { readCharacterIndex } from "@/lib/localCharacters";

/**
 * Returns a plain object { "name_lowercase": { provider, voice, role, speed, ... }, ... }
 * suitable for JSON serialization in the request body.
 */
export async function buildVoiceConfigsPayload(
  storage: ProjectStorage | null,
): Promise<Record<string, Record<string, unknown>> | undefined> {
  if (!storage) return undefined;

  try {
    const chars = await readCharacterIndex(storage);
    if (!chars.length) return undefined;

    const result: Record<string, Record<string, unknown>> = {};
    for (const c of chars) {
      const vc = (c.voice_config || {}) as Record<string, unknown>;
      // Only include characters with a voice configured
      if (!vc.voice && !vc.voice_id) continue;
      result[c.name.toLowerCase()] = vc;
      for (const alias of c.aliases ?? []) {
        if (alias) result[alias.toLowerCase()] = vc;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  } catch (err) {
    console.warn("[buildVoiceConfigsPayload] Failed to read characters:", err);
    return undefined;
  }
}
