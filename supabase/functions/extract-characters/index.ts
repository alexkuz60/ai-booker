import { createClient } from "npm:@supabase/supabase-js@2";
import { logAiUsage, getUserIdFromAuth } from "../_shared/logAiUsage.ts";
import { resolveTaskPromptWithOverrides } from "../_shared/taskPrompts.ts";
import { resolveAiEndpoint, extractProviderFields } from "../_shared/providerRouting.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ExtractedCharacter {
  name: string;
  aliases: string[];
  gender: "male" | "female" | "unknown";
  role: "speaking" | "mentioned" | "crowd";
  scene_numbers: number[];
  age_hint?: string;
  manner_hint?: string;
}

/** Detect provider label from model prefix */
function detectProvider(model: string): string {
  if (model.startsWith("openrouter/")) return "openrouter";
  if (model.startsWith("proxyapi/")) return "proxyapi";
  if (model.startsWith("dotpoint/")) return "dotpoint";
  return "lovable";
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

async function buildPrompt(scenes: { scene_number: number; text: string }[], lang: "ru" | "en") {
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

// ── Tool schema ─────────────────────────────────────────────

const characterToolSchema = {
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
              role: {
                type: "string",
                enum: ["speaking", "mentioned", "crowd"],
                description: "speaking = has direct speech; mentioned = only referenced/quoted by others; crowd = anonymous voice",
              },
              scene_numbers: {
                type: "array",
                items: { type: "integer" },
                description: "Scene numbers where the character appears",
              },
              age_hint: {
                type: "string",
                description: "Optional age hint extracted from context (e.g. 'старик', 'ребёнок', 'elder', 'child'). Especially useful for crowd/anonymous voices.",
              },
              manner_hint: {
                type: "string",
                description: "Optional speech manner or emotional hint from context (e.g. 'хрипло', 'визгливо', 'gruffly', 'shrilly'). Especially useful for crowd/anonymous voices.",
              },
            },
            required: ["name", "aliases", "gender", "role", "scene_numbers"],
            additionalProperties: false,
          },
        },
      },
      required: ["characters"],
      additionalProperties: false,
    },
  },
};

// ── AI Call ─────────────────────────────────────────────────

async function callAI(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  userId: string,
  userApiKey: string | null,
  openrouterApiKey?: string | null,
): Promise<ExtractedCharacter[]> {
  const { endpoint, model: resolvedModel, apiKey } = resolveAiEndpoint(model, userApiKey, openrouterApiKey);

  if (!apiKey) throw new Error("No API key available for the selected model provider");

  const provider = detectProvider(model);
  const t0 = Date.now();

  // Some models (e.g. o1, o3, deepseek-reasoner) don't support temperature
  const supportsTemperature = !/\b(o1|o3|o4|deepseek-reasoner)\b/i.test(resolvedModel);

  const body: Record<string, unknown> = {
    model: resolvedModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    ...(supportsTemperature ? { temperature: 0.3 } : {}),
    tools: [characterToolSchema],
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

  let resp = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  // Retry without tools on 400 (model doesn't support tool_choice)
  if (resp.status === 400 && body.tools) {
    console.warn(`[extract-characters] 400 with tools, retrying text-only mode for ${resolvedModel}`);
    const textBody = { ...body };
    delete textBody.tools;
    delete textBody.tool_choice;
    textBody.messages = [
      { role: "system", content: systemPrompt + "\n\nIMPORTANT: Return your answer as a JSON object with a single key \"characters\" containing an array. Do NOT wrap in markdown fences." },
      { role: "user", content: userPrompt },
    ];
    resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(textBody),
    });
  }

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

  // Fallback: try to extract from content (text mode or missing tool_calls)
  const content = json.choices?.[0]?.message?.content || "";
  try {
    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const obj = JSON.parse(cleaned);
    if (Array.isArray(obj)) return obj;
    if (obj.characters && Array.isArray(obj.characters)) return obj.characters;
  } catch { /* try regex */ }
  try {
    const match = content.match(/\{[\s\S]*"characters"\s*:\s*\[[\s\S]*\]\s*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return parsed.characters || [];
    }
    const arrMatch = content.match(/\[[\s\S]*\]/);
    if (arrMatch) return JSON.parse(arrMatch[0]);
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

    const rawBody = await req.json();
    const { scenes, lang = "ru" } = rawBody;
    const { model, apiKey, openrouterApiKey } = extractProviderFields(rawBody);
    const effectiveModel = model || "google/gemini-2.5-flash";

    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      return new Response(
        JSON.stringify({ error: "scenes array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Gate Lovable AI to admins only
    const isLovableRoute = detectProvider(effectiveModel) === "lovable";
    if (isLovableRoute && !apiKey) {
      const admin = await checkIsAdmin(authHeader);
      if (!admin) {
        return new Response(
          JSON.stringify({ error: "Lovable AI доступен только администраторам. Выберите модель внешнего провайдера." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const { systemPrompt, userPrompt } = await buildPrompt(scenes, lang as "ru" | "en");
    const characters = await callAI(systemPrompt, userPrompt, effectiveModel, userId, apiKey, openrouterApiKey);

    return new Response(
      JSON.stringify({ characters, usedModel: effectiveModel }),
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
