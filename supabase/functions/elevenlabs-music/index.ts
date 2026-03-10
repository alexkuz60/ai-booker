import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    const { data, error: claimsErr } = await supabase.auth.getUser(token);
    if (claimsErr || !data?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Params ──
    const { prompt, duration_seconds, lang } = await req.json();
    const isRu = lang === "ru";

    if (!prompt || typeof prompt !== "string" || prompt.length > 2000) {
      return new Response(
        JSON.stringify({
          error: isRu
            ? "Описание музыки обязательно (до 2000 символов)."
            : "Music description is required (up to 2000 chars).",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Resolve API key: user's personal key first, then server key ──
    let apiKey: string | undefined;
    try {
      const { data: apiKeys, error: rpcErr } = await supabase.rpc("get_my_api_keys");
      if (!rpcErr) {
        const key = (apiKeys as Record<string, string> | null)?.elevenlabs?.trim();
        if (key) apiKey = key;
      }
    } catch {}
    if (!apiKey) {
      apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    }

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: isRu ? "API-ключ ElevenLabs не настроен." : "ElevenLabs API key not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Generate Music ──
    const body: Record<string, unknown> = { prompt };
    if (duration_seconds && duration_seconds > 0) body.duration_seconds = Math.min(300, duration_seconds);

    const response = await fetch("https://api.elevenlabs.io/v1/music", {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("ElevenLabs Music error:", response.status, errText);
      const fallback = isRu ? "Не удалось сгенерировать музыку." : "Failed to generate music.";
      return new Response(
        JSON.stringify({ error: fallback, status: response.status }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioBuffer = await response.arrayBuffer();

    return new Response(audioBuffer, {
      headers: { ...corsHeaders, "Content-Type": "audio/mpeg" },
    });
  } catch (e) {
    console.error("Music error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
