import { createClient } from "npm:@supabase/supabase-js@2";
import { splitPhrases } from "../_shared/splitPhrases.ts";
import { extractCharacters } from "../_shared/extractCharacters.ts";
import { logAiUsage, getUserIdFromAuth } from "../_shared/logAiUsage.ts";
import { resolveAiEndpoint } from "../_shared/providerRouting.ts";
import { resolveTaskPromptWithOverrides } from "../_shared/taskPrompts.ts";

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
  "monologue",
  "lyric",
  "footnote",
  "telephone",
] as const;

type SegmentType = (typeof SEGMENT_TYPES)[number];

interface InlineNarration {
  text: string;
  insert_after: string;
}

interface AISegment {
  type: SegmentType;
  speaker?: string;
  text: string;
  inline_narrations?: InlineNarration[];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u00a0\s]+/g, " ")
    .replace(/[«»"'„“”()\[\]{}.,!?;:—–-]+/g, "")
    .trim();
}

function getCoverageFromSource(sourceNorm: string, segments: AISegment[]): number {
  if (!sourceNorm) return 0;
  const combined = normalizeText(segments.map((s) => s.text || "").join(" "));
  if (!combined) return 0;

  let matched = 0;
  for (const seg of segments) {
    const normalizedSeg = normalizeText(seg.text || "");
    if (!normalizedSeg) continue;
    if (sourceNorm.includes(normalizedSeg)) {
      matched += normalizedSeg.length;
    }
  }

  return Math.min(1, matched / Math.max(sourceNorm.length, 1));
}

function buildFallbackSegments(content: string, lang: "ru" | "en"): AISegment[] {
  const phrases = splitPhrases(content).filter(Boolean);
  if (phrases.length === 0) {
    return [{ type: lang === "ru" ? "inner_thought" : "narrator", text: content }];
  }

  const segments: AISegment[] = [];
  const chunkSize = 4;
  for (let i = 0; i < phrases.length; i += chunkSize) {
    const text = phrases.slice(i, i + chunkSize).join(" ").trim();
    if (!text) continue;
    segments.push({
      type: lang === "ru" && /\b(я|мне|меня|мной|мною|моего|моей|моему|моим|моими|моих|моё|мое|мои)\b/i.test(text)
        ? "first_person"
        : "narrator",
      text,
    });
  }

  return segments.length > 0 ? segments : [{ type: "narrator", text: content }];
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

    const { scene_id, content: bodyContent, language, model: clientModel, provider, apiKey, user_api_key, openrouter_api_key } = await req.json();
    if (!scene_id) {
      return new Response(
        JSON.stringify({ error: "scene_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Read content from DB if not provided in body
    let content = bodyContent;
    if (!content) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const svc = createClient(supabaseUrl, svcKey);
      const { data: sceneRow } = await svc
        .from("book_scenes")
        .select("content")
        .eq("id", scene_id)
        .maybeSingle();
      content = sceneRow?.content;
    }

    if (!content) {
      return new Response(
        JSON.stringify({ error: "No content found for this scene" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lang = language === "ru" ? "ru" : "en";

    // ── AI segmentation ──────────────────────────────────
    const usedModel = clientModel || "google/gemini-2.5-flash";
    const effectiveApiKey = apiKey || user_api_key || null;
    const resolved = resolveAiEndpoint(usedModel, effectiveApiKey, openrouter_api_key);

    if (!resolved.apiKey) {
      return new Response(JSON.stringify({ error: "AI key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = await getUserIdFromAuth(authHeader);
    const aiStart = Date.now();

    const systemPrompt = (await resolveTaskPromptWithOverrides("screenwriter:segment_scene", lang)) || "You are a literary text analyst.";

    const userPrompt = `Analyze this scene (language: ${lang}). IMPORTANT: segment the ENTIRE text from start to finish, do not skip any part.\nReturn ONLY a JSON array of segment objects: [{"type":"...","speaker":"...","text":"..."}]\nDo NOT return plain text or explanations.\n\n${content}`;

    // Estimate required output tokens: ~1.5x input chars (JSON overhead) / 3 chars per token
    const estimatedOutputTokens = Math.max(4096, Math.ceil((content.length * 1.5) / 3));
    const maxTokens = Math.min(estimatedOutputTokens, 16384);

    // Use max_completion_tokens for newer models, max_tokens for others
    const isNewModel = /gpt-5|o1|o3|o4/i.test(resolved.model);
    const tokenParam = isNewModel
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };

    // Helper to call AI and parse segments
    async function callAiForSegments(useJsonFormat: boolean): Promise<{ segments: AISegment[]; usage: any; latency: number }> {
      const start = Date.now();
      const bodyObj: Record<string, unknown> = {
        model: resolved.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        ...tokenParam,
      };
      if (useJsonFormat) {
        bodyObj.response_format = { type: "json_object" };
      }

      const res = await fetch(resolved.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resolved.apiKey}`,
        },
        body: JSON.stringify(bodyObj),
      });

      const lat = Date.now() - start;

      if (!res.ok) {
        const errText = await res.text();
        console.error("AI gateway error:", res.status, errText);
        if (userId) {
          logAiUsage({ userId, modelId: usedModel, requestType: "segment-scene", status: "error", latencyMs: lat, errorMessage: `AI error: ${res.status}` });
        }
        const statusCode = (res.status === 402 || res.status === 429) ? res.status : 502;
        throw Object.assign(new Error(`AI error: ${res.status}`), { statusCode });
      }

      const data = await res.json();
      let raw = data.choices?.[0]?.message?.content || "";
      raw = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

      // Try to extract JSON array from the response
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Try to find a JSON array in the text
        const arrMatch = raw.match(/\[[\s\S]*\]/);
        if (arrMatch) {
          parsed = JSON.parse(arrMatch[0]);
        } else {
          // Try to find { "segments": [...] } wrapper
          const objMatch = raw.match(/\{[\s\S]*"segments"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
          if (objMatch) {
            const obj = JSON.parse(objMatch[0]);
            parsed = obj.segments;
          } else {
            throw new Error("Unparseable");
          }
        }
      }

      // Handle { segments: [...] } wrapper
      const segs = Array.isArray(parsed) ? parsed : (parsed as any)?.segments;
      if (!Array.isArray(segs)) throw new Error("Unparseable");

      return { segments: segs, usage: data.usage, latency: lat };
    }

    let segments: AISegment[];
    let usage: any;
    let aiLatency: number;
    let usedFallbackSegmentation = false;

    try {
      // First attempt: with response_format json
      const r = await callAiForSegments(true);
      segments = r.segments; usage = r.usage; aiLatency = r.latency;
    } catch (e: any) {
      if (e.statusCode === 402 || e.statusCode === 429) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: e.statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Retry without response_format (some models don't support it)
      console.warn("First attempt failed, retrying without response_format:", e.message);
      try {
        const r = await callAiForSegments(false);
        segments = r.segments; usage = r.usage; aiLatency = r.latency;
      } catch (e2: any) {
        console.error("AI segmentation failed, using fallback segmentation:", e2.message);
        segments = buildFallbackSegments(content, lang);
        usage = null;
        aiLatency = Date.now() - aiStart;
        usedFallbackSegmentation = true;
      }
    }

    // ── Validation: ensure segments belong to this source text ──
    const sourceNorm = normalizeText(content);
    const segmentTextTotal = segments.reduce((sum, s) => sum + (s.text?.length || 0), 0);
    const coverageRatio = segmentTextTotal / content.length;
    const sourceCoverage = getCoverageFromSource(sourceNorm, segments);

    if (!usedFallbackSegmentation && (coverageRatio < 0.5 || sourceCoverage < 0.55)) {
      console.warn(`Invalid segmentation. Length coverage=${Math.round(coverageRatio * 100)}%, source coverage=${Math.round(sourceCoverage * 100)}%, segments=${segments.length}`);
      if (userId) {
        logAiUsage({
          userId,
          modelId: usedModel,
          requestType: "segment-scene",
          status: "error",
          latencyMs: aiLatency,
          tokensInput: usage?.prompt_tokens,
          tokensOutput: usage?.completion_tokens,
          errorMessage: `Invalid segmentation: len=${Math.round(coverageRatio * 100)}% source=${Math.round(sourceCoverage * 100)}%`,
        });
      }
      segments = buildFallbackSegments(content, lang);
      usedFallbackSegmentation = true;
    }

    // ── Post-process: detect first-person narration by pronouns ──
    const FIRST_PERSON_RU = /\b(я|мне|меня|мной|мною|моего|моей|моему|моим|моими|моих|моё|мое|мои)\b/i;
    const FIRST_PERSON_EN = /\b(I|me|my|mine|myself)\b/;
    const fpRegex = lang === "ru" ? FIRST_PERSON_RU : FIRST_PERSON_EN;

    for (const seg of segments) {
      if (seg.type === "narrator" && fpRegex.test(seg.text)) {
        seg.type = "first_person";
      }
    }

    // ── Post-process: dialogue vs monologue classification ──
    // A speech block is "dialogue" only if it has adjacent speech neighbors;
    // otherwise it's a standalone "monologue".
    const SPEECH_TYPES = new Set(["dialogue", "monologue"]);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!SPEECH_TYPES.has(seg.type)) continue;

      const prevSpeech = i > 0 && SPEECH_TYPES.has(segments[i - 1].type);
      const nextSpeech = i < segments.length - 1 && SPEECH_TYPES.has(segments[i + 1].type);
      const hasAdjacentSpeech = prevSpeech || nextSpeech;

      if (hasAdjacentSpeech) {
        seg.type = "dialogue";
      } else {
        seg.type = "monologue";
      }
    }

    // Log successful AI call
    if (userId) {
      logAiUsage({ userId, modelId: usedModel, requestType: "segment-scene", status: "success", latencyMs: aiLatency, tokensInput: usage?.prompt_tokens, tokensOutput: usage?.completion_tokens });
    }

    // ── Save to DB ───────────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user owns this scene
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
    await supabase.from("character_appearances").delete().eq("scene_id", scene_id);

    // Insert segments and phrases
    const result: Array<{
      segment_id: string;
      segment_number: number;
      segment_type: string;
      speaker: string | null;
      phrases: Array<{ phrase_id: string; phrase_number: number; text: string }>;
      inline_narrations?: InlineNarration[];
    }> = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segType = SEGMENT_TYPES.includes(seg.type as SegmentType) ? seg.type : "narrator";

      const metadata: Record<string, unknown> = {};
      if (seg.inline_narrations && seg.inline_narrations.length > 0) {
        metadata.inline_narrations = seg.inline_narrations;
      }
      // Mark lyric segments for special TTS handling
      if (segType === "lyric") {
        metadata.is_verse = true;
      }

      const { data: inserted, error: segErr } = await supabase
        .from("scene_segments")
        .insert({
          scene_id,
          segment_number: i + 1,
          segment_type: segType,
          speaker: seg.speaker || null,
          metadata: Object.keys(metadata).length > 0 ? metadata : null,
        })
        .select("id")
        .single();

      if (segErr || !inserted) {
        console.error("Failed to insert segment:", segErr);
        continue;
      }

      const phrases = splitPhrases(seg.text);
      // For lyric segments, auto-annotate each phrase with "slow" spanning full text
      const phraseRows = phrases.map((text, j) => {
        const row: { segment_id: string; phrase_number: number; text: string; metadata?: Record<string, unknown> } = {
          segment_id: inserted.id,
          phrase_number: j + 1,
          text,
        };
        if (segType === "lyric") {
          row.metadata = {
            annotations: [
              { type: "slow", start: 0, end: text.length, rate: 0.9 },
            ],
          };
        }
        return row;
      });

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
        inline_narrations: seg.inline_narrations,
      });
    }

    // ── Extract characters (non-fatal) ──
    try {
      await extractCharacters(supabase, scene_id, result);
    } catch (charErr) {
      console.error("Character extraction error (non-fatal):", charErr);
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
