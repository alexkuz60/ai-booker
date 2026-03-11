import { createClient } from "npm:@supabase/supabase-js@2";
import { logAiUsage, getUserIdFromAuth } from "../_shared/logAiUsage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface InlineNarration {
  text: string;
  insert_after: string;
}

interface DetectionResult {
  segment_id: string;
  inline_narrations: InlineNarration[];
  clean_text: string; // dialogue text with narrator parts removed
}

/**
 * Batch-detect inline narrator insertions within existing dialogue segments.
 * Input: { scene_id: string, language?: string }
 * Works on already-segmented scenes — no re-segmentation needed.
 */
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

    const { scene_id, language } = await req.json();
    if (!scene_id) {
      return new Response(JSON.stringify({ error: "scene_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lang = language === "ru" ? "ru" : "en";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user owns the scene
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: sceneCheck, error: sceneErr } = await userClient
      .from("book_scenes")
      .select("id")
      .eq("id", scene_id)
      .maybeSingle();

    if (sceneErr || !sceneCheck) {
      return new Response(JSON.stringify({ error: "Scene not found or access denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Load dialogue segments only
    const { data: segments, error: segErr } = await supabase
      .from("scene_segments")
      .select("id, segment_number, segment_type, speaker, metadata")
      .eq("scene_id", scene_id)
      .in("segment_type", ["dialogue"])
      .order("segment_number");

    if (segErr) throw segErr;
    if (!segments || segments.length === 0) {
      return new Response(JSON.stringify({ detected: 0, results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load phrases for these segments
    const segIds = segments.map(s => s.id);
    const { data: phrases } = await supabase
      .from("segment_phrases")
      .select("id, segment_id, phrase_number, text")
      .in("segment_id", segIds)
      .order("phrase_number");

    // Build full text per segment
    const textBySegment = new Map<string, string>();
    for (const p of phrases ?? []) {
      const prev = textBySegment.get(p.segment_id) ?? "";
      textBySegment.set(p.segment_id, prev ? `${prev} ${p.text}` : p.text);
    }

    // Build batch for AI — only segments that have text and no existing inline_narrations
    const batch: Array<{ segment_id: string; speaker: string | null; text: string }> = [];
    for (const seg of segments) {
      const text = textBySegment.get(seg.id);
      if (!text?.trim()) continue;
      // Skip if already has inline_narrations detected
      const meta = (seg.metadata ?? {}) as Record<string, unknown>;
      if (Array.isArray(meta.inline_narrations) && meta.inline_narrations.length > 0) continue;
      batch.push({ segment_id: seg.id, speaker: seg.speaker, text });
    }

    if (batch.length === 0) {
      return new Response(JSON.stringify({ detected: 0, results: [], message: lang === "ru" ? "Все диалоги уже проверены" : "All dialogues already checked" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // AI detection
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are a literary text analyst specializing in detecting narrator/author insertions within character dialogue.

Given a list of dialogue segments, detect any embedded narrator commentary (author's words) inside the speech.

Common patterns (Russian literature):
— «Родя, — тихо позвал он, — ты не умирай» → narrator: "тихо позвал он"
— «Идём, — сказал он, вставая. — Пора» → narrator: "сказал он, вставая"
— «Нет!» — крикнул он → narrator: "крикнул он" (after the speech)
— «Ну, — он помолчал, — ладно» → narrator: "он помолчал"

For each segment, return:
- "segment_id": the original segment_id
- "inline_narrations": array of detected narrator insertions:
  - "text": the narrator's text (e.g. "тихо позвал он")
  - "insert_after": the last piece of character speech BEFORE this narrator insertion
- "clean_text": the dialogue text with ALL narrator parts removed (character's words only)

If a segment has NO narrator insertions, return it with empty inline_narrations array and unchanged clean_text.

Return ONLY a JSON array. No markdown, no explanation.`;

    const userContent = batch.map((b, i) => 
      `[${i + 1}] segment_id: "${b.segment_id}"\nspeaker: ${b.speaker || "unknown"}\ntext: ${b.text}`
    ).join("\n\n");

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
          { role: "user", content: `Analyze these ${batch.length} dialogue segments (language: ${lang}):\n\n${userContent}` },
        ],
        temperature: 0.1,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, errText);
      return new Response(JSON.stringify({ error: `AI error: ${aiRes.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiRes.json();
    let raw = aiData.choices?.[0]?.message?.content || "";
    raw = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let detections: DetectionResult[];
    try {
      detections = JSON.parse(raw);
    } catch {
      console.error("Failed to parse AI response:", raw);
      return new Response(JSON.stringify({ error: "AI returned unstructured response" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Apply detections to DB
    let detectedCount = 0;
    const results: Array<{ segment_id: string; narrations_count: number }> = [];

    for (const det of detections) {
      if (!det.inline_narrations || det.inline_narrations.length === 0) continue;

      // Validate segment_id exists in our batch
      const batchItem = batch.find(b => b.segment_id === det.segment_id);
      if (!batchItem) continue;

      // Update segment metadata with inline_narrations
      const seg = segments.find(s => s.id === det.segment_id);
      const existingMeta = ((seg?.metadata ?? {}) as Record<string, unknown>);
      const updatedMeta = {
        ...existingMeta,
        inline_narrations: det.inline_narrations,
      };

      await supabase
        .from("scene_segments")
        .update({ metadata: updatedMeta })
        .eq("id", det.segment_id);

      // Update phrases with clean text (narrator removed)
      if (det.clean_text && det.clean_text !== batchItem.text) {
        // Re-split into phrases
        const newPhrases = splitPhrases(det.clean_text);

        // Delete old phrases and insert new ones
        await supabase.from("segment_phrases").delete().eq("segment_id", det.segment_id);
        const phraseRows = newPhrases.map((text, j) => ({
          segment_id: det.segment_id,
          phrase_number: j + 1,
          text,
        }));
        await supabase.from("segment_phrases").insert(phraseRows);
      }

      detectedCount += det.inline_narrations.length;
      results.push({ segment_id: det.segment_id, narrations_count: det.inline_narrations.length });
    }

    console.log(`Detected ${detectedCount} inline narrations in ${results.length} segments for scene ${scene_id}`);

    return new Response(JSON.stringify({
      detected: detectedCount,
      segments_updated: results.length,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("detect-inline-narrations error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Split text into sentences
function splitPhrases(text: string): string[] {
  const raw = text.match(/[^.!?…]+[.!?…]+[")»\\]]*|[^.!?…]+$/g);
  if (!raw) return [text.trim()].filter(Boolean);
  return raw.map((s) => s.trim()).filter(Boolean);
}
