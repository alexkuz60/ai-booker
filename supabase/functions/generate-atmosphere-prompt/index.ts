import { createClient } from "npm:@supabase/supabase-js@2";

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Params ──
    const { scene_id, lang } = await req.json();
    const isRu = lang === "ru";

    if (!scene_id) {
      return new Response(
        JSON.stringify({ error: isRu ? "scene_id обязателен" : "scene_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Load scene metadata ──
    const { data: scene, error: sceneErr } = await supabase
      .from("book_scenes")
      .select("id, title, mood, scene_type, bpm, content, silence_sec")
      .eq("id", scene_id)
      .single();

    if (sceneErr || !scene) {
      return new Response(
        JSON.stringify({ error: isRu ? "Сцена не найдена" : "Scene not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build a brief content summary (first 500 chars)
    const contentSummary = scene.content
      ? scene.content.slice(0, 500).replace(/\s+/g, " ").trim()
      : "";

    // ── AI prompt generation ──
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const promptLang = isRu ? "Russian" : "English";
    const systemPrompt = `You are a sound designer for audiobook production. Given scene metadata, generate atmospheric sound layer descriptions for ElevenLabs Sound Effects and Music APIs.

Rules:
- Return a JSON array of 1-3 layers
- Each layer: { "layer_type": "ambience"|"music"|"sfx", "prompt": "...", "duration_seconds": N, "volume": 0.0-1.0, "fade_in_ms": N, "fade_out_ms": N }
- "ambience" = continuous environmental sound (rain, forest, city, room tone). Duration 10-22 sec (will be looped). Volume 0.2-0.4.
- "music" = background score matching mood. Duration 30-60 sec. Volume 0.15-0.3.
- "sfx" = optional single accent sound effect. Duration 2-8 sec. Volume 0.3-0.5. Only include if the scene clearly suggests a specific sound event.
- Prompts must be in ${promptLang}, detailed, cinematic. Describe the sound, not the visual.
- Keep ambience present in every response. Music is optional. SFX is optional.
- Fade-in: 500-2000ms. Fade-out: 1000-3000ms.
- Match the mood and BPM closely.

Return ONLY the JSON array, no markdown, no explanation.`;

    const userPrompt = `Scene: "${scene.title}"
Mood: ${scene.mood || "neutral"}
Type: ${scene.scene_type || "mixed"}
BPM: ${scene.bpm || 80}
Content excerpt: ${contentSummary || "(no content available)"}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
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
    const rawContent = aiData.choices?.[0]?.message?.content || "[]";

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
