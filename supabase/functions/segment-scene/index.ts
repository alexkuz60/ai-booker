import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SEGMENT_TYPES = [
  "epigraph",
  "narrator",
  "first_person",
  "inner_thought",
  "dialogue",
  "lyric",
  "footnote",
] as const;

type SegmentType = (typeof SEGMENT_TYPES)[number];

interface AISegment {
  type: SegmentType;
  speaker?: string;
  text: string;
}

// Split text into sentences using punctuation rules
function splitPhrases(text: string): string[] {
  // Split on sentence-ending punctuation, keeping the delimiter
  const raw = text.match(/[^.!?…]+[.!?…]+[")»\\]]*|[^.!?…]+$/g);
  if (!raw) return [text.trim()].filter(Boolean);
  return raw.map((s) => s.trim()).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { scene_id, content, language } = await req.json();
    if (!scene_id || !content) {
      return new Response(
        JSON.stringify({ error: "scene_id and content are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lang = language === "ru" ? "ru" : "en";

    // ── AI segmentation ──────────────────────────────────
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are a literary text analyst. Given a scene text, split it into structural segments.
Each segment must have:
- "type": one of ${SEGMENT_TYPES.join(", ")}
- "speaker": string or null (only for dialogue / first_person)
- "text": the exact text of the segment (preserve original wording)

Rules:
- "narrator" = third-person narration, descriptions, action
- "first_person" = narration from a character's perspective (I/me)
- "inner_thought" = character's internal thoughts, reflections
- "dialogue" = spoken lines; set "speaker" to the character name if identifiable
- "lyric" = songs, poems, verses
- "epigraph" = epigraphs, quotes at the start
- "footnote" = footnotes, author comments
- Inline sound markers like [gunshot] should remain in the text as-is

Return ONLY a JSON array of segments. No markdown, no explanation.`;

    const userPrompt = `Analyze this scene (language: ${lang}):\n\n${content}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, errText);
      return new Response(
        JSON.stringify({ error: `AI error: ${aiRes.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiRes.json();
    let raw = aiData.choices?.[0]?.message?.content || "";
    // Strip markdown fences if present
    raw = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let segments: AISegment[];
    try {
      segments = JSON.parse(raw);
    } catch (e) {
      console.error("Failed to parse AI response:", raw);
      return new Response(
        JSON.stringify({ error: "AI returned an unstructured response. Please retry." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Save to DB ───────────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user owns this scene (use user's token)
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: sceneCheck, error: sceneErr } = await userClient
      .from("book_scenes")
      .select("id")
      .eq("id", scene_id)
      .maybeSingle();

    if (sceneErr || !sceneCheck) {
      return new Response(
        JSON.stringify({ error: "Scene not found or access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Delete existing segments for this scene
    await supabase.from("segment_phrases").delete().in(
      "segment_id",
      (await supabase.from("scene_segments").select("id").eq("scene_id", scene_id)).data?.map(
        (s: { id: string }) => s.id
      ) || []
    );
    await supabase.from("scene_segments").delete().eq("scene_id", scene_id);

    // Insert segments and phrases
    const result: Array<{
      segment_id: string;
      segment_number: number;
      segment_type: string;
      speaker: string | null;
      phrases: Array<{ phrase_id: string; phrase_number: number; text: string }>;
    }> = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segType = SEGMENT_TYPES.includes(seg.type as SegmentType) ? seg.type : "narrator";

      const { data: inserted, error: segErr } = await supabase
        .from("scene_segments")
        .insert({
          scene_id,
          segment_number: i + 1,
          segment_type: segType,
          speaker: seg.speaker || null,
        })
        .select("id")
        .single();

      if (segErr || !inserted) {
        console.error("Failed to insert segment:", segErr);
        continue;
      }

      const phrases = splitPhrases(seg.text);
      const phraseRows = phrases.map((text, j) => ({
        segment_id: inserted.id,
        phrase_number: j + 1,
        text,
      }));

      const { data: insertedPhrases, error: pErr } = await supabase
        .from("segment_phrases")
        .insert(phraseRows)
        .select("id, phrase_number, text");

      if (pErr) console.error("Failed to insert phrases:", pErr);

      result.push({
        segment_id: inserted.id,
        segment_number: i + 1,
        segment_type: segType,
        speaker: seg.speaker || null,
        phrases: (insertedPhrases || []).map((p) => ({
          phrase_id: p.id,
          phrase_number: p.phrase_number,
          text: p.text,
        })),
      });
    }

    return new Response(JSON.stringify({ segments: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("segment-scene error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
