import { logAiUsage, getUserIdFromAuth } from "../_shared/logAiUsage.ts";
import { resolveTaskPromptWithOverrides } from "../_shared/taskPrompts.ts";

import { temperatureParam } from "../_shared/modelParams.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface AtmosphereLayer {
  layer_type: "ambience" | "music" | "sfx";
  prompt: string;
  duration_seconds: number;
  volume: number;
  fade_in_ms: number;
  fade_out_ms: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = await getUserIdFromAuth(authHeader);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Params ──
    // 🚫 К3: NEVER read from DB — client sends scene metadata from OPFS
    const { scene_id, lang, model: clientModel, scene_meta } = await req.json();
    const isRu = lang === "ru";

    if (!scene_id) {
      return new Response(
        JSON.stringify({ error: isRu ? "scene_id обязателен" : "scene_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!scene_meta) {
      return new Response(
        JSON.stringify({ error: "scene_meta required — send scene metadata from OPFS" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const title = String(scene_meta.title || "");
    const mood = String(scene_meta.mood || "neutral");
    const sceneType = String(scene_meta.scene_type || "mixed");
    const bpm = Number(scene_meta.bpm) || 80;
    const contentSummary = String(scene_meta.content_summary || "").slice(0, 500);

    // ── AI prompt generation ──
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const usedModel = clientModel || "google/gemini-3-flash-preview";
    const aiStart = Date.now();

    const promptLang = isRu ? "Russian" : "English";
    const basePrompt = (await resolveTaskPromptWithOverrides("sound_engineer:generate_atmosphere", isRu ? "ru" : "en"))
      || "You are a sound designer for audiobook production.";
    const systemPrompt = `${basePrompt}\n\n- Prompts must be in ${promptLang}.`;

    const userPrompt = `Scene: "${title}"
Mood: ${mood}
Type: ${sceneType}
BPM: ${bpm}
Content excerpt: ${contentSummary || "(no content available)"}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: usedModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        ...temperatureParam(usedModel, 0.7),
      }),
    });

    const aiLatency = Date.now() - aiStart;

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      logAiUsage({ userId, modelId: usedModel, requestType: "generate-atmosphere", status: "error", latencyMs: aiLatency, errorMessage: `AI error: ${status}` });
      if (status === 429) {
        return new Response(
          JSON.stringify({ error: isRu ? "Превышен лимит запросов, попробуйте позже" : "Rate limit exceeded, try again later" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: isRu ? "Требуется пополнение баланса AI" : "AI credits required" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", status, errText);
      return new Response(
        JSON.stringify({ error: isRu ? "Ошибка AI-генерации" : "AI generation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse.json();
    const usage = aiData.usage;
    const rawContent = aiData.choices?.[0]?.message?.content || "[]";

    // Log successful AI call
    logAiUsage({ userId, modelId: usedModel, requestType: "generate-atmosphere", status: "success", latencyMs: aiLatency, tokensInput: usage?.prompt_tokens, tokensOutput: usage?.completion_tokens });

    // Parse JSON from AI response (strip markdown fences if present)
    let layers: AtmosphereLayer[];
    try {
      const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      layers = JSON.parse(cleaned);
      if (!Array.isArray(layers)) layers = [];
    } catch {
      console.error("Failed to parse AI response:", rawContent);
      layers = [];
    }

    // Validate and sanitize
    layers = layers
      .filter((l: any) => l.layer_type && l.prompt)
      .map((l: any) => ({
        layer_type: ["ambience", "music", "sfx"].includes(l.layer_type) ? l.layer_type : "ambience",
        prompt: String(l.prompt).slice(0, 2000),
        duration_seconds: Math.min(
          l.layer_type === "music" ? 120 : 22,
          Math.max(2, Number(l.duration_seconds) || 10)
        ),
        volume: Math.max(0, Math.min(1, Number(l.volume) || 0.3)),
        fade_in_ms: Math.max(0, Math.min(5000, Number(l.fade_in_ms) || 500)),
        fade_out_ms: Math.max(0, Math.min(5000, Number(l.fade_out_ms) || 1000)),
      }));

    return new Response(JSON.stringify({ layers, scene_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-atmosphere-prompt error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
