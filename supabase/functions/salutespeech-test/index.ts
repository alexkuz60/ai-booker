import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Cache token in memory (edge function instance lifetime) */
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(authKey: string): Promise<string> {
  // Reuse if still valid (with 60s margin)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const rquid = crypto.randomUUID().replace(/-/g, "");

  const res = await fetch(
    "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        RqUID: rquid,
        Authorization: `Basic ${authKey}`,
      },
      body: "scope=SALUTE_SPEECH_PERS",
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const token = data.access_token as string;
  // expires_at is in milliseconds
  const expiresAt = data.expires_at
    ? Number(data.expires_at)
    : Date.now() + 29 * 60 * 1000;

  cachedToken = { token, expiresAt };
  return token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
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
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } =
      await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const salutKey = Deno.env.get("SALUTESPEECH_AUTH_KEY");
    if (!salutKey) {
      return new Response(
        JSON.stringify({ error: "SALUTESPEECH_AUTH_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { action } = await req.json().catch(() => ({ action: "token" }));

    // Step 1: Get access token
    const t0 = Date.now();
    const accessToken = await getAccessToken(salutKey);
    const tokenMs = Date.now() - t0;

    if (action === "token") {
      return new Response(
        JSON.stringify({
          ok: true,
          tokenObtained: true,
          latencyMs: tokenMs,
          tokenPreview: accessToken.slice(0, 20) + "...",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Step 2: Test synthesis
    if (action === "synthesize") {
      const text = "Привет! Это тестовый синтез речи через SaluteSpeech.";
      const voice = "Nec_24000"; // Наталья

      const t1 = Date.now();
      const synthRes = await fetch(
        "https://smartspeech.sber.ru/rest/v1/text:synthesize?" +
          new URLSearchParams({ format: "opus", voice }),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/text",
          },
          body: text,
        },
      );

      if (!synthRes.ok) {
        const errText = await synthRes.text();
        return new Response(
          JSON.stringify({
            ok: false,
            error: `Synthesis failed (${synthRes.status}): ${errText}`,
          }),
          {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const audioBytes = await synthRes.arrayBuffer();
      const synthMs = Date.now() - t1;

      return new Response(
        JSON.stringify({
          ok: true,
          tokenLatencyMs: tokenMs,
          synthLatencyMs: synthMs,
          audioSizeBytes: audioBytes.byteLength,
          voice,
          text,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action. Use "token" or "synthesize"' }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("salutespeech-test error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
