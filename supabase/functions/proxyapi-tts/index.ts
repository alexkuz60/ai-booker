import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ProxyAPI TTS models and their capabilities
const VALID_MODELS = new Set(["gpt-4o-mini-tts", "tts-1", "tts-1-hd"]);
const BASE_VOICES = new Set(["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"]);
const EXTENDED_VOICES = new Set(["ballad", "verse", "marin", "cedar"]); // gpt-4o-mini-tts only
const ALL_VOICES = new Set([...BASE_VOICES, ...EXTENDED_VOICES]);
const VALID_FORMATS = new Set(["mp3", "opus", "aac", "flac", "wav", "pcm"]);

// Only gpt-4o-mini-tts supports instructions
const INSTRUCTIONS_MODELS = new Set(["gpt-4o-mini-tts"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth guard ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Get ProxyAPI key ──
    let PROXYAPI_KEY: string | undefined;
    try {
      const { data: apiKeys } = await supabase.rpc("get_my_api_keys");
      const keys = apiKeys as Record<string, string> | null;
      PROXYAPI_KEY = keys?.proxyapi?.trim();
    } catch (e) {
      console.error("RPC get_my_api_keys failed:", e);
    }

    if (!PROXYAPI_KEY) {
      return new Response(
        JSON.stringify({ error: "ProxyAPI key not configured. Add it in Profile → API Routers." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Parse request ──
    const body = await req.json();
    const {
      text,
      model = "gpt-4o-mini-tts",
      voice = "alloy",
      instructions,
      response_format = "mp3",
      speed = 1.0,
      lang,
    } = body;

    const isRu = lang === "ru";

    if (!text || typeof text !== "string" || text.length > 8000) {
      return new Response(
        JSON.stringify({ error: isRu ? "Текст обязателен (до 8000 символов)." : "Text required (max 8000 chars)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!VALID_MODELS.has(model)) {
      return new Response(
        JSON.stringify({ error: `Invalid model. Use: ${[...VALID_MODELS].join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!VALID_VOICES.has(voice)) {
      return new Response(
        JSON.stringify({ error: `Invalid voice. Use: ${[...VALID_VOICES].join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build request payload
    const payload: Record<string, unknown> = {
      model,
      input: text,
      voice,
      response_format,
      speed: Math.max(0.25, Math.min(4.0, Number(speed) || 1.0)),
    };

    // Only gpt-4o-mini-tts supports instructions
    if (instructions && INSTRUCTIONS_MODELS.has(model)) {
      payload.instructions = instructions;
    }

    console.log("ProxyAPI TTS request:", { model, voice, format: response_format, speed: payload.speed, textLen: text.length, hasInstructions: !!instructions });

    const response = await fetch("https://api.proxyapi.ru/openai/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PROXYAPI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("ProxyAPI TTS error:", response.status, errText);

      const msgs: Record<number, { ru: string; en: string }> = {
        401: { ru: "ProxyAPI: неверный API-ключ.", en: "ProxyAPI: invalid API key." },
        402: { ru: "ProxyAPI: недостаточно средств на балансе.", en: "ProxyAPI: insufficient balance." },
        429: { ru: "ProxyAPI: лимит запросов превышен.", en: "ProxyAPI: rate limit exceeded." },
      };
      const fallback = isRu ? "Ошибка синтеза через ProxyAPI." : "ProxyAPI TTS failed.";
      const userMessage = msgs[response.status]?.[isRu ? "ru" : "en"] || fallback;

      return new Response(
        JSON.stringify({ error: userMessage, status: response.status, detail: errText }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const audioBuffer = await response.arrayBuffer();
    console.log("ProxyAPI TTS success:", { model, voice, audioBytes: audioBuffer.byteLength });

    // Determine content type based on format
    const contentTypes: Record<string, string> = {
      mp3: "audio/mpeg",
      opus: "audio/opus",
      aac: "audio/aac",
      flac: "audio/flac",
      wav: "audio/wav",
      pcm: "audio/pcm",
    };

    return new Response(audioBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": contentTypes[response_format] || "audio/mpeg",
      },
    });
  } catch (e) {
    console.error("ProxyAPI TTS error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
