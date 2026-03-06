import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── IAM Token (Service Account JWT → IAM exchange) ───────────────

async function getIamToken(): Promise<string> {
  const keyId = Deno.env.get("YANDEX_SA_KEY_ID")!;
  const serviceAccountId = Deno.env.get("YANDEX_SA_SERVICE_ACCOUNT_ID")!;
  const privateKeyPem = Deno.env.get("YANDEX_SA_PRIVATE_KEY")!;

  const now = Math.floor(Date.now() / 1000);
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

  // Normalize PEM
  let rawKey = privateKeyPem.trim();
  if (rawKey.startsWith("{")) {
    try {
      const parsed = JSON.parse(rawKey);
      if (typeof parsed?.private_key === "string") rawKey = parsed.private_key;
    } catch { /* keep original */ }
  }
  const pemBody = rawKey
    .replace(/^"|"$/g, "")
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/-+BEGIN[^-]*PRIVATE\s*KEY-+/gi, "")
    .replace(/-+END[^-]*PRIVATE\s*KEY-+/gi, "")
    .replace(/[\s\r\n]/g, "");

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryDer, { name: "RSA-PSS", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign(
    { name: "RSA-PSS", saltLength: 32 }, cryptoKey, new TextEncoder().encode(signingInput)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwt = `${signingInput}.${sigB64}`;
  const resp = await fetch("https://iam.api.cloud.yandex.net/iam/v1/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jwt }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`IAM token failed: ${resp.status} ${errText}`);
  }
  return (await resp.json()).iamToken;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getCachedIamToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 5 * 60 * 1000) return cachedToken.token;
  const token = await getIamToken();
  cachedToken = { token, expiresAt: now + 3600 * 1000 };
  return token;
}

// ─── V1 Synthesis (REST, form-urlencoded) ─────────────────────────

interface TtsParams {
  text: string;
  voice: string;
  lang: string;
  speed: number;
  emotion?: string;   // v1 only (role alias)
  role?: string;      // v3 only
  pitchShift?: number; // v3 only, Hz [-1000..1000]
  volume?: number;     // v3 only
  apiVersion?: "v1" | "v3";
}

async function synthesizeV1(
  iamToken: string,
  params: TtsParams,
): Promise<{ audio: Uint8Array; contentType: string }> {
  const folderId = Deno.env.get("YANDEX_FOLDER_ID")!;
  const form = new URLSearchParams();
  form.append("text", params.text);
  form.append("lang", params.lang);
  form.append("voice", params.voice);
  form.append("folderId", folderId);
  form.append("format", "mp3");
  form.append("sampleRateHertz", "48000");
  form.append("speed", String(params.speed));
  if (params.emotion) form.append("emotion", params.emotion);

  const response = await fetch(
    "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize",
    { method: "POST", headers: { Authorization: `Bearer ${iamToken}` }, body: form },
  );
  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 401) cachedToken = null;
    throw new YandexTtsError(response.status, errText);
  }
  return { audio: new Uint8Array(await response.arrayBuffer()), contentType: "audio/mpeg" };
}

// ─── V3 Synthesis (REST JSON, utteranceSynthesis) ─────────────────

async function synthesizeV3(
  iamToken: string,
  params: TtsParams,
): Promise<{ audio: Uint8Array; contentType: string }> {
  const folderId = Deno.env.get("YANDEX_FOLDER_ID")!;

  // Build hints array — each hint is a single-key object
  const hints: Record<string, unknown>[] = [
    { voice: params.voice },
    { speed: params.speed },
  ];
  if (params.role) hints.push({ role: params.role });
  if (params.pitchShift !== undefined && params.pitchShift !== 0) {
    hints.push({ pitch_shift: params.pitchShift });
  }
  if (params.volume !== undefined) {
    hints.push({ volume: params.volume });
  }

  const body = {
    text: params.text,
    hints,
    output_audio_spec: {
      container_audio: { container_audio_type: "MP3" },
    },
    loudness_normalization_type: "LUFS",
    unsafe_mode: true,  // auto-split long texts
  };

  console.log("Yandex TTS v3 request:", {
    voice: params.voice,
    role: params.role,
    speed: params.speed,
    pitchShift: params.pitchShift,
    volume: params.volume,
    textLen: params.text.length,
  });

  const response = await fetch(
    "https://tts.api.cloud.yandex.net:443/tts/v3/utteranceSynthesis",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${iamToken}`,
        "x-folder-id": folderId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 401) cachedToken = null;
    throw new YandexTtsError(response.status, errText);
  }

  // V3 REST returns newline-delimited JSON, each with result.audioChunk.data (base64)
  const responseText = await response.text();
  const audioChunks: Uint8Array[] = [];

  for (const line of responseText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const b64 = parsed?.result?.audioChunk?.data;
      if (b64) {
        audioChunks.push(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      }
    } catch {
      // skip non-JSON lines
    }
  }

  // Concatenate all audio chunks
  const totalLen = audioChunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of audioChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return { audio: combined, contentType: "audio/mpeg" };
}

// ─── Error helper ─────────────────────────────────────────────────

class YandexTtsError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

function errorMessage(status: number, isRu: boolean): string {
  const msgs: Record<number, { ru: string; en: string }> = {
    401: { ru: "Yandex SpeechKit: ошибка авторизации.", en: "Yandex SpeechKit: auth error." },
    403: { ru: "Yandex SpeechKit: доступ запрещён.", en: "Yandex SpeechKit: access forbidden." },
    429: { ru: "Yandex SpeechKit: лимит запросов.", en: "Yandex SpeechKit: rate limit." },
  };
  const fallback = isRu ? "Не удалось сгенерировать аудио." : "Failed to generate audio.";
  return msgs[status]?.[isRu ? "ru" : "en"] || fallback;
}

// ─── V3-only voices (not available in v1) ─────────────────────────

const V3_ONLY_VOICES = new Set([
  "dasha", "julia", "lera", "masha", "alexander", "kirill", "anton",
  "saule_ru", "zamira_ru", "zhanar_ru", "yulduz_ru",
  "naomi", "saule", "zhanar", "zamira", "yulduz",
]);

// ─── Main handler ─────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth guard
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

    // Admin-only guard
    const { data: roleData } = await supabase
      .from("user_roles").select("role")
      .eq("user_id", userData.user.id).eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: "Yandex TTS is available for admins only." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Parse request
    const body = await req.json();
    const {
      text, voice, lang, speed,
      emotion, role, pitchShift, pitch_shift, volume,
      apiVersion, api_version,
    } = body;

    const isRu = lang === "ru";
    if (!text || typeof text !== "string" || text.length > 5000) {
      return new Response(
        JSON.stringify({ error: isRu ? "Текст до 5000 символов." : "Text must be under 5000 chars." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const selectedVoice = voice || "alena";
    const selectedSpeed = parseFloat(speed) || 1.0;
    const selectedLang = isRu ? "ru-RU" : "en-US";
    const selectedRole = role || emotion || undefined;
    const selectedPitch = pitchShift ?? pitch_shift ?? undefined;
    const selectedVolume = volume ?? undefined;

    // Auto-detect API version:
    // - Explicit apiVersion/api_version wins
    // - v3 if pitch/volume/role requested, or voice is v3-only
    // - Otherwise v1
    let ver: "v1" | "v3" = (apiVersion || api_version) as "v1" | "v3" || "v1";
    const needsV3 =
      selectedPitch !== undefined ||
      selectedVolume !== undefined ||
      selectedRole !== undefined ||
      V3_ONLY_VOICES.has(selectedVoice);
    if (!apiVersion && !api_version && needsV3) ver = "v3";

    const params: TtsParams = {
      text,
      voice: selectedVoice,
      lang: selectedLang,
      speed: selectedSpeed,
      emotion: ver === "v1" ? selectedRole : undefined,
      role: ver === "v3" ? selectedRole : undefined,
      pitchShift: selectedPitch,
      volume: selectedVolume,
      apiVersion: ver,
    };

    console.log("Yandex TTS dispatch:", { ver, voice: selectedVoice, role: selectedRole, pitch: selectedPitch, volume: selectedVolume });

    const iamToken = await getCachedIamToken();
    const result = ver === "v3"
      ? await synthesizeV3(iamToken, params)
      : await synthesizeV1(iamToken, params);

    return new Response(result.audio, {
      headers: { ...corsHeaders, "Content-Type": result.contentType },
    });
  } catch (e) {
    console.error("Yandex TTS error:", e);
    const isRu = true; // fallback
    if (e instanceof YandexTtsError) {
      return new Response(
        JSON.stringify({ error: errorMessage(e.status, isRu), detail: e.message }),
        { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
