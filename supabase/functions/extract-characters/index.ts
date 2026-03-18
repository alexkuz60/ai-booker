import { createClient } from "npm:@supabase/supabase-js@2";
import { logAiUsage, getUserIdFromAuth } from "../_shared/logAiUsage.ts";
import { resolveTaskPromptWithOverrides } from "../_shared/taskPrompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ExtractedCharacter {
  name: string;
  aliases: string[];
  gender: "male" | "female" | "unknown";
  scene_numbers: number[];
}

// ── ProxyAPI model mapping ─────────────────────────────────
const PROXYAPI_MODEL_MAP: Record<string, string> = {
  'proxyapi/gpt-5': 'openai/gpt-5',
  'proxyapi/gpt-5-mini': 'openai/gpt-5-mini',
  'proxyapi/gpt-5.2': 'openai/gpt-5.2',
  'proxyapi/gpt-4o': 'openai/gpt-4o',
  'proxyapi/gpt-4o-mini': 'openai/gpt-4o-mini',
  'proxyapi/claude-sonnet-4': 'anthropic/claude-sonnet-4-20250514',
  'proxyapi/claude-opus-4': 'anthropic/claude-opus-4-6',
  'proxyapi/claude-3-5-sonnet': 'anthropic/claude-3-5-sonnet-20241022',
  'proxyapi/gemini-3-pro-preview': 'gemini/gemini-3-pro-preview',
  'proxyapi/gemini-3-flash-preview': 'gemini/gemini-3-flash-preview',
  'proxyapi/gemini-2.5-pro': 'gemini/gemini-2.5-pro',
  'proxyapi/gemini-2.5-flash': 'gemini/gemini-2.5-flash',
  'proxyapi/deepseek-chat': 'deepseek/deepseek-chat',
  'proxyapi/deepseek-reasoner': 'deepseek/deepseek-reasoner',
};

// ── Provider routing ───────────────────────────────────────
function getEndpointAndModel(
  userModel: string,
  userApiKey: string | null,
): { endpoint: string; model: string; apiKey: string } {
  // Detect provider from model prefix
  if (userModel.startsWith("proxyapi/") && userApiKey) {
    const realModel = PROXYAPI_MODEL_MAP[userModel] || userModel.replace("proxyapi/", "");
    return {
      endpoint: "https://openai.api.proxyapi.ru/v1/chat/completions",
      model: realModel,
      apiKey: userApiKey,
    };
  }

  if (userModel.startsWith("openrouter/") && userApiKey) {
    const realModel = userModel.replace("openrouter/", "");
    return {
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      model: realModel,
      apiKey: userApiKey,
    };
  }

  if (userModel.startsWith("dotpoint/") && userApiKey) {
    const realModel = userModel.replace("dotpoint/", "");
    return {
      endpoint: "https://llms.dotpoin.com/v1/chat/completions",
      model: realModel,
      apiKey: userApiKey,
    };
  }

  // Lovable AI gateway (admin-only — gated by client)
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  return {
    endpoint: "https://ai.gateway.lovable.dev/v1/chat/completions",
    model: userModel || "google/gemini-2.5-flash",
    apiKey: LOVABLE_API_KEY || "",
  };
}

/** Check if user has admin role */
async function checkIsAdmin(authHeader: string): Promise<boolean> {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    return !!data;
  } catch {
    return false;
  }
}

// ── Prompt ──────────────────────────────────────────────────

function buildPrompt(scenes: { scene_number: number; text: string }[], lang: "ru" | "en") {
  const isRu = lang === "ru";

  const systemPrompt = (await resolveTaskPromptWithOverrides("profiler:extract_characters", lang))
    || "You are a literary analyst. Find all characters in the provided scenes.";

  const scenesText = scenes
    .map((s) => `── Сцена ${s.scene_number} ──\n${s.text.slice(0, 6000)}`)
    .join("\n\n");

  const userPrompt = isRu
    ? `Проанализируй следующие сцены и найди всех персонажей:\n\n${scenesText}`
    : `Analyze the following scenes and find all characters:\n\n${scenesText}`;

  return { systemPrompt, userPrompt };
}

// ── AI Call ─────────────────────────────────────────────────

async function callAI(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  userId: string,
  userApiKey: string | null,
): Promise<ExtractedCharacter[]> {
  const { endpoint, model: resolvedModel, apiKey } = getEndpointAndModel(model, userApiKey);

  if (!apiKey) throw new Error("No API key available for the selected model provider");

  const provider = model.startsWith("openrouter/") ? "openrouter"
    : model.startsWith("proxyapi/") ? "proxyapi"
    : model.startsWith("dotpoint/") ? "dotpoint"
    : "lovable";

  const t0 = Date.now();

  const body: Record<string, unknown> = {
    model: resolvedModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    tools: [
      {
        type: "function",
        function: {
          name: "report_characters",
          description: "Report all characters found in the chapter scenes.",
          parameters: {
            type: "object",
            properties: {
              characters: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Primary character name (nominative case)" },
                    aliases: {
                      type: "array",
                      items: { type: "string" },
                      description: "Alternative names, nicknames, diminutives",
                    },
                    gender: { type: "string", enum: ["male", "female", "unknown"] },
                    scene_numbers: {
                      type: "array",
                      items: { type: "integer" },
                      description: "Scene numbers where the character appears",
                    },
                  },
                  required: ["name", "aliases", "gender", "scene_numbers"],
                  additionalProperties: false,
                },
              },
            },
            required: ["characters"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "report_characters" } },
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  // OpenRouter requires HTTP-Referer
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://booker-studio.lovable.app";
    headers["X-Title"] = "AI Booker";
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const latencyMs = Date.now() - t0;

  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`AI error (${provider}):`, resp.status, errText);
    await logAiUsage({
      userId,
      modelId: resolvedModel,
      requestType: "extract-characters",
      status: "error",
      latencyMs,
      errorMessage: `${resp.status}: ${errText.slice(0, 200)}`,
    });
    if (resp.status === 429) throw new Error("rate_limited");
    if (resp.status === 402) throw new Error("payment_required");
    throw new Error(`AI ${provider} ${resp.status}`);
  }

  const json = await resp.json();
  const usage = json.usage;

  await logAiUsage({
    userId,
    modelId: resolvedModel,
    requestType: "extract-characters",
    status: "success",
    latencyMs,
    tokensInput: usage?.prompt_tokens ?? null,
    tokensOutput: usage?.completion_tokens ?? null,
  });

  // Extract from tool call response
  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    try {
      const parsed = JSON.parse(toolCall.function.arguments);
      return parsed.characters || [];
    } catch (e) {
      console.error("Failed to parse tool call arguments:", e);
    }
  }

  // Fallback: try to extract from content
  const content = json.choices?.[0]?.message?.content || "";
  try {
    const match = content.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
  } catch { /* ignore */ }

  return [];
}

// ── Handler ────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userId = await getUserIdFromAuth(authHeader);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { scenes, lang = "ru", model = "google/gemini-2.5-flash", apiKey = null } = await req.json();

    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      return new Response(
        JSON.stringify({ error: "scenes array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Gate Lovable AI to admins only
    const isLovableRoute = !model.startsWith("openrouter/") && !model.startsWith("proxyapi/") && !model.startsWith("dotpoint/");
    if (isLovableRoute && !apiKey) {
      const admin = await checkIsAdmin(authHeader);
      if (!admin) {
        // Try fallback to OpenRouter if user has a key
        return new Response(
          JSON.stringify({ error: "Lovable AI доступен только администраторам. Выберите модель внешнего провайдера." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const { systemPrompt, userPrompt } = buildPrompt(scenes, lang as "ru" | "en");
    const characters = await callAI(systemPrompt, userPrompt, model, userId, apiKey);

    return new Response(
      JSON.stringify({ characters }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg === "rate_limited" ? 429 : msg === "payment_required" ? 402 : 500;
    return new Response(
      JSON.stringify({ error: msg }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
