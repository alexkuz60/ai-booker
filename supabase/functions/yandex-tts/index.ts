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
    // ── Auth guard ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Parse request ──
    const { text, voice, lang, speed } = await req.json();
    const isRu = lang === "ru";

    if (!text || typeof text !== "string" || text.length > 5000) {
      return new Response(
        JSON.stringify({ error: isRu ? "Текст обязателен и должен быть до 5000 символов." : "Text is required and must be under 5000 characters." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Get user's Yandex SpeechKit API key from profile ──
    const { data: keysData, error: keysErr } = await supabase.rpc("get_my_api_keys");
    if (keysErr) {
      console.error("Failed to get API keys:", keysErr);
      return new Response(
        JSON.stringify({ error: isRu ? "Не удалось получить API-ключи." : "Failed to retrieve API keys." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = (keysData as Record<string, string>)?.yandex_speechkit;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: isRu ? "API-ключ Yandex SpeechKit не найден в профиле." : "Yandex SpeechKit API key not found in profile." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Call Yandex SpeechKit v1 ──
    const selectedVoice = voice || "alena";
    const selectedSpeed = speed || "1.0";

    const params = new URLSearchParams();
    params.append("text", text);
    params.append("lang", "ru-RU");
    params.append("voice", selectedVoice);
    params.append("speed", selectedSpeed);
    params.append("format", "mp3");
    params.append("sampleRateHertz", "48000");

    const response = await fetch(
      "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize",
      {
        method: "POST",
        headers: {
          "Authorization": apiKey,
        },
        body: params,
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Yandex SpeechKit error:", response.status, errText);

      const msgs: Record<number, { ru: string; en: string }> = {
        401: {
          ru: "Yandex SpeechKit: неверный API-ключ. Проверьте ключ в профиле.",
          en: "Yandex SpeechKit: invalid API key. Check the key in your profile.",
        },
        403: {
          ru: "Yandex SpeechKit: доступ запрещён. Проверьте права и folder ID.",
          en: "Yandex SpeechKit: access forbidden. Check permissions and folder ID.",
        },
        429: {
          ru: "Yandex SpeechKit: превышен лимит запросов. Попробуйте позже.",
          en: "Yandex SpeechKit: rate limit exceeded. Try again later.",
        },
      };
      const fallback = isRu ? "Не удалось сгенерировать аудио через Yandex SpeechKit." : "Failed to generate audio via Yandex SpeechKit.";
      const userMessage = msgs[response.status]?.[isRu ? "ru" : "en"] || fallback;

      return new Response(
        JSON.stringify({ error: userMessage, status: response.status }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioBuffer = await response.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
      },
    });
  } catch (e) {
    console.error("Yandex TTS error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
