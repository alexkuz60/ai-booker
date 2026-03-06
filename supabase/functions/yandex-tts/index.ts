import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Generate a JWT signed with the service account's RSA private key,
 * then exchange it for an IAM token via Yandex Cloud API.
 */
async function getIamToken(): Promise<string> {
  const keyId = Deno.env.get("YANDEX_SA_KEY_ID")!;
  const serviceAccountId = Deno.env.get("YANDEX_SA_SERVICE_ACCOUNT_ID")!;
  const privateKeyPem = Deno.env.get("YANDEX_SA_PRIVATE_KEY")!;

  const now = Math.floor(Date.now() / 1000);

  // JWT header & payload
  const header = { alg: "PS256", typ: "JWT", kid: keyId };
  const payload = {
    iss: serviceAccountId,
    aud: "https://iam.api.cloud.yandex.net/iam/v1/tokens",
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: unknown) => {
    const json = new TextEncoder().encode(JSON.stringify(obj));
    return btoa(String.fromCharCode(...json))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  };

  const headerB64 = enc(header);
  const payloadB64 = enc(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import RSA private key
  // Normalize PEM: handle literal \n, escaped \\n, and various header formats
  const normalizedPem = privateKeyPem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/g, "")
    .replace(/-----END (RSA )?PRIVATE KEY-----/g, "")
    .replace(/[\s\r\n]/g, "");

  console.log("PEM body length after cleanup:", normalizedPem.length, "first 20 chars:", normalizedPem.substring(0, 20));

  let binaryDer: Uint8Array;
  try {
    binaryDer = Uint8Array.from(atob(normalizedPem), (c) => c.charCodeAt(0));
  } catch (e) {
    console.error("Base64 decode failed. PEM preview:", normalizedPem.substring(0, 50), "...", normalizedPem.substring(normalizedPem.length - 20));
    throw new Error("Failed to decode private key PEM. Ensure YANDEX_SA_PRIVATE_KEY contains a valid PEM-encoded RSA key.");
  }

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Sign
  const signature = await crypto.subtle.sign(
    { name: "RSA-PSS", saltLength: 32 },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${signingInput}.${sigB64}`;

  // Exchange JWT for IAM token
  const resp = await fetch("https://iam.api.cloud.yandex.net/iam/v1/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jwt }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("IAM token error:", resp.status, errText);
    throw new Error(`Failed to get IAM token: ${resp.status} ${errText}`);
  }

  const data = await resp.json();
  return data.iamToken;
}

// Simple in-memory IAM token cache
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getCachedIamToken(): Promise<string> {
  const now = Date.now();
  // Refresh 5 min before expiry
  if (cachedToken && cachedToken.expiresAt > now + 5 * 60 * 1000) {
    return cachedToken.token;
  }
  const token = await getIamToken();
  cachedToken = { token, expiresAt: now + 3600 * 1000 };
  return token;
}

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

    // ── Get IAM token from service account ──
    const iamToken = await getCachedIamToken();

    // ── Call Yandex SpeechKit v1 ──
    const selectedVoice = voice || "alena";
    const selectedSpeed = speed || "1.0";
    const selectedLang = isRu ? "ru-RU" : "en-US";

    const folderId = Deno.env.get("YANDEX_FOLDER_ID")!;

    const formData = new URLSearchParams();
    formData.append("text", text);
    formData.append("lang", selectedLang);
    formData.append("voice", selectedVoice);
    formData.append("folderId", folderId);
    formData.append("format", "mp3");
    formData.append("sampleRateHertz", "48000");
    formData.append("speed", selectedSpeed);

    console.log("Yandex TTS request:", {
      voice: selectedVoice,
      lang: selectedLang,
      speed: selectedSpeed,
      textLen: text.length,
      authType: "IAM token (service account)",
    });

    const response = await fetch(
      "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${iamToken}`,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Yandex SpeechKit error:", response.status, errText);

      // If 401, invalidate cached token
      if (response.status === 401) {
        cachedToken = null;
      }

      const msgs: Record<number, { ru: string; en: string }> = {
        401: {
          ru: "Yandex SpeechKit: ошибка авторизации. Проверьте сервисный аккаунт.",
          en: "Yandex SpeechKit: auth error. Check service account.",
        },
        403: {
          ru: "Yandex SpeechKit: доступ запрещён. Проверьте права сервисного аккаунта.",
          en: "Yandex SpeechKit: access forbidden. Check service account permissions.",
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

    const audioBytes = new Uint8Array(await response.arrayBuffer());

    return new Response(audioBytes, {
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
