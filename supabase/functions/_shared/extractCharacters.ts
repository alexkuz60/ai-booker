import { createClient } from "npm:@supabase/supabase-js@2";

// ── Character extraction helper ──────────────────────────
export async function extractCharacters(
  supabase: ReturnType<typeof createClient>,
  sceneId: string,
  segments: Array<{ segment_id: string; segment_type: string; speaker: string | null }>
) {
  const { data: scene } = await supabase
    .from("book_scenes")
    .select("chapter_id")
    .eq("id", sceneId)
    .single();
  if (!scene) return;

  const { data: chapter } = await supabase
    .from("book_chapters")
    .select("book_id")
    .eq("id", scene.chapter_id)
    .single();
  if (!chapter) return;

  const bookId = chapter.book_id;

  const speakerSegments = new Map<string, string[]>();
  for (const seg of segments) {
    if (seg.speaker && ["dialogue", "monologue", "first_person", "remark"].includes(seg.segment_type)) {
      const name = seg.speaker.trim();
      if (!name) continue;
      const ids = speakerSegments.get(name) || [];
      ids.push(seg.segment_id);
      speakerSegments.set(name, ids);
    }
  }

  if (speakerSegments.size === 0) return;

  // Pre-load ALL book characters once to match by name OR aliases
  const { data: allChars } = await supabase
    .from("book_characters")
    .select("id, name, aliases")
    .eq("book_id", bookId);

  const bookChars = allChars || [];

  function findCharacterByNameOrAlias(speakerName: string) {
    const lower = speakerName.toLowerCase();
    const byName = bookChars.find(c => c.name.toLowerCase() === lower);
    if (byName) return byName;
    return bookChars.find(c =>
      (c.aliases || []).some((a: string) => a.toLowerCase() === lower)
    ) || null;
  }

  for (const [name, segmentIds] of speakerSegments) {
    const existing = findCharacterByNameOrAlias(name);

    let characterId: string;
    if (existing) {
      characterId = existing.id;
    } else {
      const { data: inserted, error } = await supabase
        .from("book_characters")
        .insert({ book_id: bookId, name })
        .select("id, name, aliases")
        .single();
      if (error || !inserted) {
        console.error("Failed to insert character:", name, error);
        continue;
      }
      characterId = inserted.id;
      bookChars.push(inserted);
    }

    const { error: appErr } = await supabase
      .from("character_appearances")
      .upsert(
        {
          character_id: characterId,
          scene_id: sceneId,
          role_in_scene: "speaker",
          segment_ids: segmentIds,
        },
        { onConflict: "character_id,scene_id" }
      );
    if (appErr) console.error("Failed to upsert appearance:", appErr);
  }

  // ── Auto-link Narrator/Commentator characters to scene (standard speakers) ──
  const NARRATION_DEFS = [
    { names: ["Рассказчик", "Narrator"], types: ["narrator", "epigraph", "lyric"], sort_order: -2 },
    { names: ["Комментатор", "Commentator"], types: ["footnote"], sort_order: -1 },
  ];

  for (const def of NARRATION_DEFS) {
    const matchingSegIds = segments
      .filter(seg => def.types.includes(seg.segment_type))
      .map(seg => seg.segment_id);
    if (matchingSegIds.length === 0) continue;

    let narChar = bookChars.find(c =>
      def.names.some(n => n.toLowerCase() === c.name.toLowerCase())
    );

    if (!narChar) {
      const { data: inserted, error } = await supabase
        .from("book_characters")
        .insert({
          book_id: bookId,
          name: def.names[0],
          sort_order: def.sort_order,
          description: def.names[0] === "Рассказчик" || def.names[0] === "Narrator"
            ? "Third-person narration voice"
            : "Footnote and commentary voice",
        })
        .select("id, name, aliases")
        .single();
      if (error || !inserted) {
        console.error("Failed to create character:", def.names[0], error);
        continue;
      }
      narChar = inserted;
      bookChars.push(inserted);
    }

    await supabase
      .from("character_appearances")
      .upsert(
        {
          character_id: narChar.id,
          scene_id: sceneId,
          role_in_scene: "speaker",
          segment_ids: matchingSegIds,
        },
        { onConflict: "character_id,scene_id" }
      );
  }
}
