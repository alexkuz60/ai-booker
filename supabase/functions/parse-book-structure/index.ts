import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT_FULL = `You are "The Architect" — an AI agent that analyzes book text and decomposes it into a structured screenplay format.

Your task:
1. Clean the text: remove page numbers, footnotes, headers/footers, and other technical artifacts.
2. Identify and segment the text into chapters. If chapters are not explicitly marked, infer logical chapter boundaries.
3. Within each chapter, identify scenes — logical segments where setting, time, or action changes.
4. For each scene, determine:
   - scene_type: one of "action", "dialogue", "lyrical_digression", "description", "inner_monologue", "mixed"
   - mood: the dominant emotional tone (e.g. "tense", "calm", "melancholic", "joyful", "dark", "romantic", "comedic")
   - bpm: suggested narrative tempo as beats-per-minute metaphor (60-80 slow/contemplative, 80-110 moderate, 110-140 dynamic, 140+ intense)
   - content: the COMPLETE text of the scene, preserving original wording exactly. Do NOT truncate or abbreviate.

You MUST respond using the suggest_structure tool.`;

const SYSTEM_PROMPT_CHAPTER = `You are "The Architect" — an AI agent that analyzes a single chapter of a book and decomposes it into scenes.

Your task:
1. Clean the text: remove page numbers, footnotes, headers/footers, and other technical artifacts.
2. Identify scenes — logical segments where setting, time, or action changes.
3. For each scene, determine:
   - scene_type: one of "action", "dialogue", "lyrical_digression", "description", "inner_monologue", "mixed"
   - mood: the dominant emotional tone (e.g. "tense", "calm", "melancholic", "joyful", "dark", "romantic", "comedic")
   - bpm: suggested narrative tempo as beats-per-minute metaphor (60-80 slow/contemplative, 80-110 moderate, 110-140 dynamic, 140+ intense)
   - content: the COMPLETE text of the scene, preserving original wording exactly. Do NOT truncate or abbreviate.

You MUST respond using the suggest_scenes tool.`;

const fullStructureTool = {
  type: "function",
  function: {
    name: "suggest_structure",
    description: "Return the structured decomposition of the book into chapters and scenes",
    parameters: {
      type: "object",
      properties: {
        book_title: { type: "string", description: "Detected or inferred book title" },
        chapters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              chapter_number: { type: "integer" },
              title: { type: "string" },
              scenes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    scene_number: { type: "integer" },
                    title: { type: "string", description: "Brief scene title" },
                    content_preview: { type: "string", description: "First 200 chars of scene" },
                    scene_type: {
                      type: "string",
                      enum: ["action", "dialogue", "lyrical_digression", "description", "inner_monologue", "mixed"],
                    },
                    mood: { type: "string" },
                    bpm: { type: "integer" },
                  },
                  required: ["scene_number", "title", "scene_type", "mood", "bpm"],
                  additionalProperties: false,
                },
              },
            },
            required: ["chapter_number", "title", "scenes"],
            additionalProperties: false,
          },
        },
      },
      required: ["book_title", "chapters"],
      additionalProperties: false,
    },
  },
};

const chapterScenesTool = {
  type: "function",
  function: {
    name: "suggest_scenes",
    description: "Return scene decomposition for a single chapter",
    parameters: {
      type: "object",
      properties: {
        scenes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              scene_number: { type: "integer" },
              title: { type: "string", description: "Brief scene title" },
              content_preview: { type: "string", description: "First 200 chars of scene" },
              scene_type: {
                type: "string",
                enum: ["action", "dialogue", "lyrical_digression", "description", "inner_monologue", "mixed"],
              },
              mood: { type: "string" },
              bpm: { type: "integer" },
            },
            required: ["scene_number", "title", "scene_type", "mood", "bpm"],
            additionalProperties: false,
          },
        },
      },
      required: ["scenes"],
      additionalProperties: false,
    },
  },
};

// ─── ProxyAPI model mapping (universal endpoint with provider prefix, synced with Hydra) ───
const PROXYAPI_MODEL_MAP: Record<string, string> = {
  'proxyapi/gpt-4o': 'openai/gpt-4o',
  'proxyapi/gpt-4o-mini': 'openai/gpt-4o-mini',
  'proxyapi/gpt-5': 'openai/gpt-5',
  'proxyapi/gpt-5-mini': 'openai/gpt-5-mini',
  'proxyapi/gpt-5.2': 'openai/gpt-5.2',
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

// ─── DotPoint config ───
const DOTPOINT_BASE_URL = 'https://llms.dotpoin.com/v1';

// ─── Endpoint routing ───
function getEndpointAndModel(provider: string, userModel: string, userApiKey: string | null) {
  if (provider === 'proxyapi' && userApiKey) {
    const realModel = PROXYAPI_MODEL_MAP[userModel] || userModel.replace('proxyapi/', '');
    return {
      endpoint: 'https://openai.api.proxyapi.ru/v1/chat/completions',
      model: realModel,
      apiKey: userApiKey,
    };
  }

  if (provider === 'openrouter' && userApiKey) {
    const realModel = userModel.replace('openrouter/', '');
    return {
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: realModel,
      apiKey: userApiKey,
    };
  }

  if (provider === 'dotpoint' && userApiKey) {
    const realModel = userModel.replace('dotpoint/', '');
    return {
      endpoint: `${DOTPOINT_BASE_URL}/chat/completions`,
      model: realModel,
      apiKey: userApiKey,
    };
  }

  // Lovable AI gateway (admin-only, gated in handler)
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  return {
    endpoint: 'https://ai.gateway.lovable.dev/v1/chat/completions',
    model: userModel || 'google/gemini-2.5-flash',
    apiKey: LOVABLE_API_KEY || '',
  };
}

/** Check if user has admin role */
async function isAdmin(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    return !!data;
  } catch {
    return false;
  }
}
function canFallbackToOpenRouter(userApiKey: string | null, model: string): { endpoint: string; model: string; apiKey: string } | null {
  if (!userApiKey) return null;
  return {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model,
    apiKey: userApiKey,
  };
}

/** Core AI request handler */
async function handleAIRequest(
  truncatedText: string, endpoint: string, model: string, apiKey: string,
  provider: string, mode: string | undefined, chapterTitle: string | undefined,
  openrouterApiKey: string | null
): Promise<Response> {
  const isChapterMode = mode === "chapter";
  const systemPrompt = isChapterMode ? SYSTEM_PROMPT_CHAPTER : SYSTEM_PROMPT_FULL;
  const userContent = isChapterMode
    ? `Analyze the following chapter "${chapterTitle || 'Untitled'}" and decompose it into scenes:\n\n${truncatedText}`
    : `Analyze the following book text and decompose it into chapters and scenes:\n\n${truncatedText}`;
  const tools = isChapterMode ? [chapterScenesTool] : [fullStructureTool];
  const toolName = isChapterMode ? "suggest_scenes" : "suggest_structure";

  const requestBody: Record<string, unknown> = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    tools,
    tool_choice: { type: "function", function: { name: toolName } },
  };

  async function callAI(ep: string, mdl: string, key: string, prov: string): Promise<Response> {
    const hdrs: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    if (prov === 'openrouter') {
      hdrs["HTTP-Referer"] = "https://booker-studio.lovable.app";
      hdrs["X-Title"] = "BookerStudio Parser";
    }
    let resp: Response | null = null;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      resp = await fetch(ep, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ ...requestBody, model: mdl }),
      });
      if (resp.status !== 502 && resp.status !== 503) break;
      console.warn(`AI returned ${resp.status} (${prov}), attempt ${attempt + 1}/${MAX_RETRIES}`);
      await resp.text();
      if (attempt < MAX_RETRIES - 1) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
    return resp!;
  }

  let response = await callAI(endpoint, model, apiKey, provider);

  // Fallback: if Lovable gateway returns 400, try OpenRouter
  if (response.status === 400 && provider === 'lovable') {
    const fallback = canFallbackToOpenRouter(openrouterApiKey, model);
    if (fallback) {
      console.log(`Lovable gateway 400 for model ${model}, falling back to OpenRouter`);
      await response.text();
      response = await callAI(fallback.endpoint, fallback.model, fallback.apiKey, 'openrouter');
    }
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (status === 402) {
      return new Response(JSON.stringify({ error: "Payment required. Please add credits." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (status === 502 || status === 503) {
      return new Response(JSON.stringify({ error: "AI service temporarily unavailable. Please retry in a few seconds." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const errText = await response.text();
    console.error("AI error:", status, "model:", model, "provider:", provider, errText);
    return new Response(JSON.stringify({ error: `AI analysis failed (${status})` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

  if (!toolCall) {
    return new Response(JSON.stringify({ error: "AI did not return structured output" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const structure = JSON.parse(toolCall.function.arguments);
  return new Response(JSON.stringify({ structure }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { text, user_api_key, user_model, provider, mode, chapter_title, openrouter_api_key } = body;

    if (!text || text.trim().length < 50) {
      return new Response(JSON.stringify({ error: "Text too short for analysis (min 50 chars)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const truncatedText = text.slice(0, 100000);
    const effectiveProvider = provider || 'lovable';

    // Gate Lovable AI behind admin role
    if (effectiveProvider === 'lovable') {
      const authHeader = req.headers.get("Authorization");
      const admin = await isAdmin(authHeader);
      if (!admin) {
        if (openrouter_api_key) {
          const orModel = user_model || 'google/gemini-2.5-flash';
          console.log(`Non-admin, redirecting ${orModel} to OpenRouter`);
          return await handleAIRequest(
            truncatedText, 'https://openrouter.ai/api/v1/chat/completions',
            orModel, openrouter_api_key, 'openrouter', mode, chapter_title, null
          );
        }
        return new Response(
          JSON.stringify({ error: "Lovable AI доступен только администраторам. Настройте ключ OpenRouter или ProxyAPI в профиле." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const { endpoint, model, apiKey } = getEndpointAndModel(
      effectiveProvider, user_model || 'google/gemini-2.5-flash', user_api_key || null
    );

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "No API key available. Configure in profile or contact admin." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return await handleAIRequest(truncatedText, endpoint, model, apiKey, effectiveProvider, mode, chapter_title, openrouter_api_key);
  } catch (e) {
    console.error("parse-book-structure error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
