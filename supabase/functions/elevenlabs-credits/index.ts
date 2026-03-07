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
    // Auth guard
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

    // Get user's ElevenLabs API key from profile
    const { data: apiKeys } = await supabase.rpc("get_my_api_keys");
    const elevenLabsKey = (apiKeys as Record<string, string>)?.elevenlabs;

    if (!elevenLabsKey) {
      // Fall back to server key
      const serverKey = Deno.env.get("ELEVENLABS_API_KEY");
      if (!serverKey) {
        return new Response(
          JSON.stringify({ error: "No ElevenLabs API key configured" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const apiKey = elevenLabsKey || Deno.env.get("ELEVENLABS_API_KEY")!;

    const response = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": apiKey },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("ElevenLabs subscription error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: `ElevenLabs API error: ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sub = await response.json();

    return new Response(
      JSON.stringify({
        tier: sub.tier,
        character_count: sub.character_count,
        character_limit: sub.character_limit,
        can_extend: sub.can_extend_character_limit,
        next_reset_unix: sub.next_character_count_reset_unix,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Credits error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
