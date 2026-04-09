import { logAiUsage, getUserIdFromAuth } from "../_shared/logAiUsage.ts";
import { resolveAiEndpoint } from "../_shared/providerRouting.ts";
import { modelParams } from "../_shared/modelParams.ts";
import { resolveTaskPromptWithOverrides } from "../_shared/taskPrompts.ts";

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
  clean_text: string;
}

/**
 * Batch-detect inline narrator insertions within dialogue segments.
 * 🚫 К3: Accepts segments from client (OPFS), no DB reads/writes.
 * Input: { scene_id, language, segments: Array<{segment_id, speaker, text}> }
 * Returns: { detected, results: Array<{segment_id, inline_narrations, clean_text}> }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { scene_id, language, segments: clientSegments, model: clientModel, provider, apiKey, user_api_key, openrouter_api_key } = await req.json();
    if (!scene_id) {
      return new Response(JSON.stringify({ error: "scene_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lang = language === "ru" ? "ru" : "en";

    if (!clientSegments || !Array.isArray(clientSegments) || clientSegments.length === 0) {
      return new Response(JSON.stringify({ error: "segments required — send dialogue segments from OPFS storyboard" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate and filter: only dialogue/monologue segments with text
    const batch: Array<{ segment_id: string; speaker: string | null; text: string }> = [];
    for (const seg of clientSegments) {
      const text = String(seg.text || "").trim();
      if (!text) continue;
      batch.push({
        segment_id: String(seg.segment_id),
        speaker: seg.speaker || null,
        text,
      });
    }

    if (batch.length === 0) {
      return new Response(JSON.stringify({
        detected: 0,
        results: [],
        message: lang === "ru" ? "Нет диалогов для проверки" : "No dialogues to check",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // AI detection
    const usedModel = clientModel || "google/gemini-2.5-flash";
    const effectiveApiKey = apiKey || user_api_key || null;
    const resolved = resolveAiEndpoint(usedModel, effectiveApiKey, openrouter_api_key);

    if (!resolved.apiKey) {
      return new Response(JSON.stringify({ error: "AI key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = (await resolveTaskPromptWithOverrides("profiler:detect_inline_narrations"))
      || "You are a literary text analyst specializing in detecting narrator insertions within dialogue.";

    const userContent = batch.map((b, i) =>
      `[${i + 1}] segment_id: "${b.segment_id}"\nspeaker: ${b.speaker || "unknown"}\ntext: ${b.text}`
    ).join("\n\n");

    const userId = await getUserIdFromAuth(authHeader!);
    const aiStart = Date.now();

    const aiRes = await fetch(resolved.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify({
        model: resolved.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Analyze these ${batch.length} dialogue segments (language: ${lang}):\n\n${userContent}` },
        ],
        ...modelParams(resolved.model, { temperature: 0.1 }),
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, errText);
      if (userId) logAiUsage({ userId, modelId: usedModel, requestType: "detect-inline-narrations", status: "error", latencyMs: Date.now() - aiStart, errorMessage: `HTTP ${aiRes.status}` });
      const statusCode = (aiRes.status === 402 || aiRes.status === 429) ? aiRes.status : 502;
      return new Response(JSON.stringify({ error: `AI error: ${aiRes.status}` }), {
        status: statusCode,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiRes.json();
    const usage = aiData.usage;
    if (userId) logAiUsage({ userId, modelId: usedModel, requestType: "detect-inline-narrations", status: "success", latencyMs: Date.now() - aiStart, tokensInput: usage?.prompt_tokens, tokensOutput: usage?.completion_tokens });

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

    // 🚫 К3: No DB writes — return results for client to apply locally
    let detectedCount = 0;
    const results: DetectionResult[] = [];

    for (const det of detections) {
      if (!det.inline_narrations || det.inline_narrations.length === 0) continue;
      // Validate segment_id exists in our batch
      const batchItem = batch.find(b => b.segment_id === det.segment_id);
      if (!batchItem) continue;

      detectedCount += det.inline_narrations.length;
      results.push({
        segment_id: det.segment_id,
        inline_narrations: det.inline_narrations,
        clean_text: det.clean_text || batchItem.text,
      });
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
