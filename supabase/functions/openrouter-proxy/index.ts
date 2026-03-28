import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    const body = await req.json();
    const { action, model_id, input } = body;
    const { data: apiKeys } = await supabase.rpc("get_my_api_keys");
    const openrouterKey = (apiKeys as any)?.openrouter;

    if (!openrouterKey) {
      return new Response(JSON.stringify({ error: "OpenRouter key not configured" }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── Ping / Key info ──
    if (action === "ping") {
      const start = Date.now();
      try {
        const resp = await fetch("https://openrouter.ai/api/v1/key", {
          headers: { Authorization: `Bearer ${openrouterKey}` },
          signal: AbortSignal.timeout(15_000),
        });
        const latency = Date.now() - start;
        if (resp.ok) {
          const json = await resp.json();
          return new Response(JSON.stringify({ status: "online", latency_ms: latency, key_info: json.data }), {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ status: "error", latency_ms: latency, error: `HTTP ${resp.status}` }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ status: "timeout", latency_ms: Date.now() - start, error: String(err) }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    // ── Test model ──
    if (action === "test" && model_id) {
      const start = Date.now();
      try {
        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openrouterKey}`,
            "HTTP-Referer": "https://booker-studio.lovable.app",
            "X-Title": "BookerStudio",
          },
          body: JSON.stringify({ model: model_id, messages: [{ role: "user", content: "Say ok" }], max_tokens: 5 }),
          signal: AbortSignal.timeout(30_000),
        });
        const latency = Date.now() - start;

        if (resp.ok) {
          const json = await resp.json();
          const usage = json.usage;
          const tokensIn = usage?.prompt_tokens || 0;
          const tokensOut = usage?.completion_tokens || 0;
          await supabase.from("proxy_api_logs").insert({
            user_id: user.id, model_id, provider: "openrouter",
            request_type: "test", status: "success", latency_ms: latency,
            tokens_input: tokensIn, tokens_output: tokensOut,
          });
          return new Response(JSON.stringify({
            status: "success", latency_ms: latency,
            tokens: { input: tokensIn, output: tokensOut },
          }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        } else if (resp.status === 404) {
          await supabase.from("proxy_api_logs").insert({
            user_id: user.id, model_id, provider: "openrouter",
            request_type: "test", status: "gone", latency_ms: latency, error_message: "HTTP 404",
          });
          return new Response(JSON.stringify({ status: "gone", latency_ms: latency, error: "Not found (404)" }), {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }
        const errText = await resp.text();
        await supabase.from("proxy_api_logs").insert({
          user_id: user.id, model_id, provider: "openrouter",
          request_type: "test", status: "error", latency_ms: latency,
          error_message: `${resp.status}: ${errText.slice(0, 500)}`,
        });
        return new Response(JSON.stringify({ status: "error", latency_ms: latency, error: `HTTP ${resp.status}` }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      } catch (err) {
        const latency = Date.now() - start;
        await supabase.from("proxy_api_logs").insert({
          user_id: user.id, model_id, provider: "openrouter",
          request_type: "test", status: "timeout", latency_ms: latency, error_message: String(err),
        });
        return new Response(JSON.stringify({ status: "timeout", latency_ms: latency }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    // ── Embeddings ──
    if (action === "embeddings" && model_id) {
      const { input } = await req.json().catch(() => ({ input: undefined }));
      const body = await (async () => {
        // body was already parsed above, re-read from the original request is not possible
        // so we accept input from the same JSON body
        return { input: input || "test", model: model_id };
      })();

      const start = Date.now();
      try {
        const resp = await fetch("https://openrouter.ai/api/v1/embeddings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openrouterKey}`,
            "HTTP-Referer": "https://booker-studio.lovable.app",
            "X-Title": "BookerStudio",
          },
          body: JSON.stringify({ model: model_id, input: body.input }),
          signal: AbortSignal.timeout(30_000),
        });
        const latency = Date.now() - start;

        if (resp.ok) {
          const json = await resp.json();
          const dims = json.data?.[0]?.embedding?.length || 0;
          const tokensIn = json.usage?.prompt_tokens || 0;
          await supabase.from("proxy_api_logs").insert({
            user_id: user.id, model_id, provider: "openrouter",
            request_type: "embeddings", status: "success", latency_ms: latency,
            tokens_input: tokensIn, tokens_output: 0,
          });
          return new Response(JSON.stringify({
            status: "success", latency_ms: latency, dimensions: dims,
            data: json.data, usage: json.usage,
          }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        }
        const errText = await resp.text();
        await supabase.from("proxy_api_logs").insert({
          user_id: user.id, model_id, provider: "openrouter",
          request_type: "embeddings", status: "error", latency_ms: latency,
          error_message: `${resp.status}: ${errText.slice(0, 500)}`,
        });
        return new Response(JSON.stringify({ status: "error", latency_ms: latency, error: `HTTP ${resp.status}` }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      } catch (err) {
        const latency = Date.now() - start;
        return new Response(JSON.stringify({ status: "timeout", latency_ms: latency, error: String(err) }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    // ── Models catalog (public, no key needed) ──
    if (action === "models") {
      try {
        const resp = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) return new Response(JSON.stringify({ error: `HTTP ${resp.status}` }), {
          status: resp.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
        const json = await resp.json();
        const models = (json.data || []).map((m: any) => ({
          id: m.id, name: m.name || m.id, pricing: m.pricing, context_length: m.context_length,
        }));
        return new Response(JSON.stringify({ models, total: models.length }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
