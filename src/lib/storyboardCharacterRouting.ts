import type { CharacterIndex } from "@/pages/parser/types";
import type { Segment } from "@/components/studio/storyboard/types";
import type { LocalTypeMappingEntry } from "@/lib/storyboardSync";

type CharacterLike = Pick<CharacterIndex, "id" | "name"> & {
  aliases?: string[];
};

const SYSTEM_CHARACTER_DEFS = [
  { names: ["рассказчик", "narrator"], types: ["narrator", "epigraph", "lyric"] },
  { names: ["комментатор", "commentator"], types: ["footnote"] },
] as const;

const MAPPED_SEGMENT_TYPES = new Set([
  "narrator",
  "first_person",
  "inner_thought",
  "epigraph",
  "lyric",
  "footnote",
]);

function normalizeName(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

export function buildCharacterNameMap(characters: CharacterLike[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const character of characters) {
    const name = normalizeName(character.name);
    if (name) map.set(name, character.id);

    for (const alias of character.aliases ?? []) {
      const normalizedAlias = normalizeName(alias);
      if (normalizedAlias) map.set(normalizedAlias, character.id);
    }
  }

  return map;
}

export function deriveStoryboardTypeMappings(
  segments: Segment[],
  characters: CharacterLike[],
  persistedTypeMappings: LocalTypeMappingEntry[] = [],
  inlineNarrationSpeaker?: string | null,
): LocalTypeMappingEntry[] {
  const nameMap = buildCharacterNameMap(characters);
  const charById = new Map(characters.map((character) => [character.id, character]));
  const mappings: LocalTypeMappingEntry[] = [];
  const seen = new Set<string>();
  const presentSegmentTypes = new Set(segments.map((segment) => segment.segment_type));

  for (const segment of segments) {
    const speakerId = nameMap.get(normalizeName(segment.speaker));
    if (!speakerId || !MAPPED_SEGMENT_TYPES.has(segment.segment_type) || seen.has(segment.segment_type)) continue;

    const character = charById.get(speakerId);
    if (!character) continue;

    mappings.push({
      segmentType: segment.segment_type,
      characterId: speakerId,
      characterName: character.name,
    });
    seen.add(segment.segment_type);
  }

  for (const persistedMapping of persistedTypeMappings) {
    if (
      persistedMapping.segmentType === "inline_narration" ||
      seen.has(persistedMapping.segmentType) ||
      !presentSegmentTypes.has(persistedMapping.segmentType) ||
      !charById.has(persistedMapping.characterId)
    ) {
      continue;
    }

    mappings.push({
      segmentType: persistedMapping.segmentType,
      characterId: persistedMapping.characterId,
      characterName: charById.get(persistedMapping.characterId)?.name ?? persistedMapping.characterName,
    });
    seen.add(persistedMapping.segmentType);
  }

  const inlineSpeakerId = nameMap.get(normalizeName(inlineNarrationSpeaker));
  if (inlineSpeakerId) {
    const inlineCharacter = charById.get(inlineSpeakerId);
    if (inlineCharacter) {
      mappings.push({
        segmentType: "inline_narration",
        characterId: inlineSpeakerId,
        characterName: inlineCharacter.name,
      });
    }
  } else {
    const persistedInline = persistedTypeMappings.find((mapping) => mapping.segmentType === "inline_narration");
    if (persistedInline && charById.has(persistedInline.characterId)) {
      mappings.push({
        segmentType: persistedInline.segmentType,
        characterId: persistedInline.characterId,
        characterName: charById.get(persistedInline.characterId)?.name ?? persistedInline.characterName,
      });
    }
  }

  return mappings;
}

export function deriveStoryboardCharacterIds(
  segments: Segment[],
  characters: CharacterLike[],
  typeMappings: LocalTypeMappingEntry[] = [],
): Set<string> {
  const ids = new Set<string>();
  const nameMap = buildCharacterNameMap(characters);

  for (const segment of segments) {
    const speakerId = nameMap.get(normalizeName(segment.speaker));
    if (speakerId) ids.add(speakerId);
  }

  for (const mapping of typeMappings) {
    ids.add(mapping.characterId);
  }

  const segmentTypes = new Set(segments.map((segment) => segment.segment_type));
  for (const systemDef of SYSTEM_CHARACTER_DEFS) {
    if (!systemDef.types.some((type) => segmentTypes.has(type))) continue;

    const systemCharId = systemDef.names
      .map((name) => nameMap.get(name))
      .find(Boolean);

    if (systemCharId) ids.add(systemCharId);
  }

  return ids;
}