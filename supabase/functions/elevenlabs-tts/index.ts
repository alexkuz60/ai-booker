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
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── TTS logic ──
    const { text, voiceId, lang } = await req.json();
    const isRu = lang === 'ru';

    if (!text || typeof text !== "string" || text.length > 5000) {
      return new Response(
        JSON.stringify({ error: isRu ? "Текст обязателен и должен быть до 5000 символов." : "Text is required and must be under 5000 characters." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Try user's own API key first, fallback to server key
    let ELEVENLABS_API_KEY: string | undefined;
    try {
      const { data: apiKeys, error: rpcErr } = await supabase.rpc("get_my_api_keys");
      if (rpcErr) {
        console.error("RPC get_my_api_keys error:", rpcErr.message);
      } else {
        const keys = apiKeys as Record<string, string> | null;
        const rawKey = keys?.elevenlabs;
        if (rawKey) {
          ELEVENLABS_API_KEY = rawKey.trim();
          console.log("User ElevenLabs key found, length:", ELEVENLABS_API_KEY.length, "prefix:", ELEVENLABS_API_KEY.substring(0, 5));
        }
      }
    } catch (e) {
      console.error("RPC call failed:", e);
    }
    if (!ELEVENLABS_API_KEY) {
      ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
      console.log("Using server ElevenLabs key:", !!ELEVENLABS_API_KEY);
    }

    if (!ELEVENLABS_API_KEY) {
      return new Response(
        JSON.stringify({ error: isRu ? "API-ключ ElevenLabs не настроен." : "ElevenLabs API key not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const selectedVoice = voiceId || "JBFqnCBsd6RMkjVDRZzb";

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}?output_format=pcm_44100`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.6,
            similarity_boost: 0.75,
            style: 0.4,
            use_speaker_boost: true,
            speed: 0.95,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("ElevenLabs error:", response.status, errText);

      let parsed: any = {};
      try { parsed = JSON.parse(errText); } catch {}
      const detail = parsed?.detail;
      const isSignInRequired = detail?.code === "sign_in_required";

      const msgs: Record<number, { ru: string; en: string }> = {
        401: isSignInRequired
          ? {
              ru: "ElevenLabs: бесплатный тариф заблокирован из облачной среды. Войдите на elevenlabs.io и повторите попытку, или используйте платный план.",
              en: "ElevenLabs: free tier blocked from cloud environment. Sign in at elevenlabs.io and retry, or upgrade to a paid plan.",
            }
          : {
              ru: "ElevenLabs: неверный API-ключ. Проверьте ключ в профиле.",
              en: "ElevenLabs: invalid API key. Check your key in profile.",
            },
        403: {
          ru: "ElevenLabs: доступ запрещён. Проверьте права API-ключа.",
          en: "ElevenLabs: access forbidden. Check your API key permissions.",
        },
        429: {
          ru: "ElevenLabs: превышен лимит запросов. Попробуйте позже.",
          en: "ElevenLabs: rate limit exceeded. Please try again later.",
        },
      };
      const fallback = isRu ? "Не удалось сгенерировать аудио через ElevenLabs." : "Failed to generate audio from ElevenLabs.";
      const userMessage = msgs[response.status]?.[isRu ? 'ru' : 'en'] || fallback;

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
    console.error("TTS error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
