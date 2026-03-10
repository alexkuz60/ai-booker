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
    const { query, page = 1, page_size = 15, filter, sort, duration_min, duration_max } = await req.json();

    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "Query is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("FREESOUND_API_KEY");
    console.log("[freesound-search] API key present:", !!apiKey, "length:", apiKey?.length, "starts:", apiKey?.slice(0, 4));
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Freesound API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Build search URL ──
    const params = new URLSearchParams({
      query: query.trim(),
      page: String(page),
      page_size: String(Math.min(page_size, 30)),
      fields: "id,name,tags,description,duration,previews,images,avg_rating,num_ratings,username,license",
    });

    if (filter) params.set("filter", filter);
    if (sort) params.set("sort", sort);

    // Duration filter
    const durationFilters: string[] = [];
    if (duration_min && duration_min > 0) durationFilters.push(`duration:[${duration_min} TO *]`);
    if (duration_max && duration_max > 0) durationFilters.push(`duration:[* TO ${duration_max}]`);
    if (durationFilters.length > 0) {
      const existing = params.get("filter") || "";
      params.set("filter", [existing, ...durationFilters].filter(Boolean).join(" "));
    }

    const url = `https://freesound.org/apiv2/search/text/?${params.toString()}`;
    console.log("[freesound-search] Query:", query, "Page:", page);

    const response = await fetch(url, {
      headers: {
        "Authorization": `Token ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[freesound-search] Freesound error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: `Freesound API error: ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();

    // Return simplified response
    const sounds = (result.results || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      duration: s.duration,
      tags: (s.tags || []).slice(0, 8),
      description: (s.description || "").slice(0, 200),
      preview_url: s.previews?.["preview-hq-mp3"] || s.previews?.["preview-lq-mp3"] || "",
      waveform_url: s.images?.waveform_m || "",
      username: s.username,
      license: s.license,
      rating: s.avg_rating,
    }));

    return new Response(
      JSON.stringify({
        count: result.count || 0,
        page,
        page_size: Math.min(page_size, 30),
        results: sounds,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[freesound-search] Error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
