import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DOTPOINT_BASE_URL = "https://llms.dotpoin.com/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const { action, model_id } = await req.json();
    const { data: apiKeys } = await supabase.rpc("get_my_api_keys").single();
    const dotpointKey = (apiKeys as any)?.dotpoint;

    if (!dotpointKey) {
      return new Response(JSON.stringify({ error: "DotPoint key not configured" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    if (action === "ping") {
      const start = Date.now();
      try {
        const resp = await fetch(`${DOTPOINT_BASE_URL}/models`, {
          headers: { Authorization: `Bearer ${dotpointKey}` },
          signal: AbortSignal.timeout(20_000),
        });
        const latency = Date.now() - start;
        if (resp.ok) {
          const data = await resp.json();
          return new Response(JSON.stringify({ status: "online", latency_ms: latency, model_count: data?.data?.length || 0 }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        }
        const errText = await resp.text();
        await supabase.from("proxy_api_logs").insert({ user_id: user.id, model_id: "ping", provider: "dotpoint", request_type: "ping", status: "error", latency_ms: latency, error_message: `${resp.status}: ${errText.slice(0, 200)}` });
        return new Response(JSON.stringify({ status: "error", latency_ms: latency, error: `HTTP ${resp.status}` }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      } catch (err) {
        const latency = Date.now() - start;
        await supabase.from("proxy_api_logs").insert({ user_id: user.id, model_id: "ping", provider: "dotpoint", request_type: "ping", status: "timeout", latency_ms: latency, error_message: String(err) });
        return new Response(JSON.stringify({ status: "timeout", latency_ms: latency }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
    }

    if (action === "test" && model_id) {
      const realModel = model_id.replace("dotpoint/", "");
      const start = Date.now();
      try {
        const resp = await fetch(`${DOTPOINT_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${dotpointKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: realModel, messages: [{ role: "user", content: "Say hi." }], max_tokens: 30, stream: false }),
          signal: AbortSignal.timeout(60_000),
        });
        const latency = Date.now() - start;

        if (resp.ok) {
          const data = await resp.json();
          const content = data.choices?.[0]?.message?.content || "";
          const tokensIn = data.usage?.prompt_tokens || 0;
          const tokensOut = data.usage?.completion_tokens || 0;
          await supabase.from("proxy_api_logs").insert({ user_id: user.id, model_id, provider: "dotpoint", request_type: "test", status: "success", latency_ms: latency, tokens_input: tokensIn, tokens_output: tokensOut });
          return new Response(JSON.stringify({ status: "success", latency_ms: latency, content, tokens: { input: tokensIn, output: tokensOut } }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        } else if (resp.status === 410) {
          await supabase.from("proxy_api_logs").insert({ user_id: user.id, model_id, provider: "dotpoint", request_type: "test", status: "gone", latency_ms: latency, error_message: "HTTP 410 Gone" });
          return new Response(JSON.stringify({ status: "gone", latency_ms: latency, error: "Model permanently removed" }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        }
        const errText = await resp.text();
        await supabase.from("proxy_api_logs").insert({ user_id: user.id, model_id, provider: "dotpoint", request_type: "test", status: "error", latency_ms: latency, error_message: `${resp.status}: ${errText.slice(0, 500)}` });
        return new Response(JSON.stringify({ status: "error", latency_ms: latency, error: `HTTP ${resp.status}`, details: errText.slice(0, 500) }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      } catch (err) {
        const latency = Date.now() - start;
        await supabase.from("proxy_api_logs").insert({ user_id: user.id, model_id, provider: "dotpoint", request_type: "test", status: "timeout", latency_ms: latency, error_message: String(err) });
        return new Response(JSON.stringify({ status: "timeout", latency_ms: latency }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
    }

    if (action === "models") {
      try {
        const resp = await fetch(`${DOTPOINT_BASE_URL}/models`, { headers: { Authorization: `Bearer ${dotpointKey}` }, signal: AbortSignal.timeout(30_000) });
        if (!resp.ok) return new Response(JSON.stringify({ error: `HTTP ${resp.status}` }), { status: resp.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        const data = await resp.json();
        const models = (data?.data || []).map((m: any) => ({ id: m.id, owned_by: m.owned_by || "unknown", created: m.created }));
        return new Response(JSON.stringify({ models, total: models.length }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
