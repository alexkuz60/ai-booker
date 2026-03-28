import { createClient } from "npm:@supabase/supabase-js@2";
import { PROXYAPI_MODEL_MAP, resolveProxyApiModel, detectModelType, getFullUrlForType, stripProviderPrefix, buildTestPayload, type ProxyModelType } from "../_shared/proxyapi.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const proxyapiKey = (apiKeys as any)?.proxyapi;

    if (!proxyapiKey) {
      return new Response(JSON.stringify({ error: "ProxyAPI key not configured" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    if (action === "ping") {
      const start = Date.now();
      try {
        const resp = await fetch("https://openai.api.proxyapi.ru/v1/models", {
          headers: { Authorization: `Bearer ${proxyapiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        const latency = Date.now() - start;
        if (resp.ok) {
          const data = await resp.json();
          return new Response(JSON.stringify({ status: "online", latency_ms: latency, model_count: data?.data?.length || 0 }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        }
        const errText = await resp.text();
        await supabase.from("proxy_api_logs").insert({ user_id: user.id, model_id: "ping", provider: "proxyapi", request_type: "ping", status: "error", latency_ms: latency, error_message: `${resp.status}: ${errText.slice(0, 200)}` });
        return new Response(JSON.stringify({ status: "error", latency_ms: latency, error: `HTTP ${resp.status}` }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      } catch (err) {
        const latency = Date.now() - start;
        await supabase.from("proxy_api_logs").insert({ user_id: user.id, model_id: "ping", provider: "proxyapi", request_type: "ping", status: "timeout", latency_ms: latency, error_message: String(err) });
        return new Response(JSON.stringify({ status: "timeout", latency_ms: latency }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
    }

    if (action === "test" && model_id) {
      const realModel = resolveProxyApiModel(model_id);
      const modelType = detectModelType(model_id);
      if (modelType === "stt" || modelType === "image_edit") {
        return new Response(JSON.stringify({ status: "skipped", model_type: modelType, message: "Manual testing required" }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }

      const testUrl = getFullUrlForType(modelType);
      const apiModel = modelType === "chat" ? realModel : stripProviderPrefix(realModel);
      const payload = buildTestPayload(apiModel, modelType);
      const start = Date.now();

      try {
        const resp = await fetch(testUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${proxyapiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });
        const latency = Date.now() - start;

        if (resp.ok) {
          let content = "", tokensIn = 0, tokensOut = 0;
          if (modelType === "tts") { await resp.arrayBuffer(); content = "[audio]"; }
          else if (modelType === "image") { const data = await resp.json(); content = data.data?.[0]?.url ? "[image]" : "[ok]"; }
          else if (modelType === "embedding") { const data = await resp.json(); content = `[embedding ${data.data?.[0]?.embedding?.length}d]`; tokensIn = data.usage?.prompt_tokens || 0; }
          else { const data = await resp.json(); content = data.choices?.[0]?.message?.content || ""; tokensIn = data.usage?.prompt_tokens || 0; tokensOut = data.usage?.completion_tokens || 0; }

          await supabase.from("proxy_api_logs").insert({ user_id: user.id, model_id, provider: "proxyapi", request_type: "test", status: "success", latency_ms: latency, tokens_input: tokensIn, tokens_output: tokensOut });
          return new Response(JSON.stringify({ status: "success", latency_ms: latency, content, model_type: modelType, tokens: { input: tokensIn, output: tokensOut } }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        } else if (resp.status === 410) {
          await supabase.from("proxy_api_logs").insert({ user_id: user.id, model_id, provider: "proxyapi", request_type: "test", status: "gone", latency_ms: latency, error_message: "HTTP 410 Gone" });
          return new Response(JSON.stringify({ status: "gone", latency_ms: latency, error: "Model permanently removed" }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        }
        const errText = await resp.text();
        await supabase.from("proxy_api_logs").insert({ user_id: user.id, model_id, provider: "proxyapi", request_type: "test", status: "error", latency_ms: latency, error_message: `${resp.status}: ${errText.slice(0, 500)}` });
        return new Response(JSON.stringify({ status: "error", latency_ms: latency, error: `HTTP ${resp.status}`, details: errText.slice(0, 500) }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      } catch (err) {
        const latency = Date.now() - start;
        await supabase.from("proxy_api_logs").insert({ user_id: user.id, model_id, provider: "proxyapi", request_type: "test", status: "timeout", latency_ms: latency, error_message: String(err) });
        return new Response(JSON.stringify({ status: "timeout", latency_ms: latency }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
    }

    // ── Embeddings ──
    if (action === "embeddings" && model_id) {
      const realModel = stripProviderPrefix(resolveProxyApiModel(model_id));
      const testUrl = getFullUrlForType("embedding");
      const start = Date.now();
      try {
        const bodyJson = await req.json().catch(() => ({}));
        const input = bodyJson.input || "test";
        const resp = await fetch(testUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${proxyapiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: realModel, input }),
          signal: AbortSignal.timeout(30_000),
        });
        const latency = Date.now() - start;
        if (resp.ok) {
          const json = await resp.json();
          const dims = json.data?.[0]?.embedding?.length || 0;
          const tokensIn = json.usage?.prompt_tokens || 0;
          await supabase.from("proxy_api_logs").insert({
            user_id: user.id, model_id, provider: "proxyapi",
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
          user_id: user.id, model_id, provider: "proxyapi",
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

    if (action === "models") {
      try {
        const resp = await fetch("https://openai.api.proxyapi.ru/v1/models", { headers: { Authorization: `Bearer ${proxyapiKey}` }, signal: AbortSignal.timeout(15_000) });
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
