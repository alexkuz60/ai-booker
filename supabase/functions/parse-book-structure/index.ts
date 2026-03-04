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

You MUST respond using the suggest_structure tool.`;

const SYSTEM_PROMPT_CHAPTER = `You are "The Architect" — an AI agent that analyzes a single chapter of a book and decomposes it into scenes.

Your task:
1. Clean the text: remove page numbers, footnotes, headers/footers, and other technical artifacts.
2. Identify scenes — logical segments where setting, time, or action changes.
3. For each scene, determine:
   - scene_type: one of "action", "dialogue", "lyrical_digression", "description", "inner_monologue", "mixed"
   - mood: the dominant emotional tone (e.g. "tense", "calm", "melancholic", "joyful", "dark", "romantic", "comedic")
   - bpm: suggested narrative tempo as beats-per-minute metaphor (60-80 slow/contemplative, 80-110 moderate, 110-140 dynamic, 140+ intense)

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

// ─── ProxyAPI model mapping ───
const PROXYAPI_MODEL_MAP: Record<string, string> = {
  'proxyapi/gpt-5': 'gpt-5',
  'proxyapi/gpt-5-mini': 'gpt-5-mini',
  'proxyapi/gpt-5.2': 'gpt-5.2',
  'proxyapi/gpt-4o': 'gpt-4o',
  'proxyapi/gpt-4o-mini': 'gpt-4o-mini',
  'proxyapi/claude-sonnet-4': 'claude-sonnet-4-20250514',
  'proxyapi/claude-opus-4': 'claude-opus-4-20250514',
  'proxyapi/claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
  'proxyapi/gemini-2.5-pro': 'gemini-2.5-pro-preview-06-05',
  'proxyapi/gemini-2.5-flash': 'gemini-2.5-flash-preview-05-20',
};

// ─── Endpoint routing ───
function getEndpointAndModel(provider: string, userModel: string, userApiKey: string | null) {
  if (provider === 'proxyapi' && userApiKey) {
    const realModel = PROXYAPI_MODEL_MAP[userModel] || userModel.replace('proxyapi/', '');
    return {
      endpoint: 'https://api.proxyapi.ru/openai/v1/chat/completions',
      model: realModel,
      apiKey: userApiKey,
    };
  }

  if (provider === 'openrouter' && userApiKey) {
    // OpenRouter model IDs: strip 'openrouter/' prefix
    const realModel = userModel.replace('openrouter/', '');
    return {
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: realModel,
      apiKey: userApiKey,
    };
  }

  // Default: Lovable AI gateway
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  return {
    endpoint: 'https://ai.gateway.lovable.dev/v1/chat/completions',
    model: userModel || 'google/gemini-2.5-flash',
    apiKey: LOVABLE_API_KEY || '',
  };
}

/** Try OpenRouter as fallback when Lovable gateway rejects a model (400) */
function canFallbackToOpenRouter(userApiKey: string | null, model: string): { endpoint: string; model: string; apiKey: string } | null {
  if (!userApiKey) return null;
  // These models exist on OpenRouter with the same ID format
  return {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model,
    apiKey: userApiKey,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { text, user_api_key, user_model, provider, mode, chapter_title, openrouter_api_key } = body;

    if (!text || text.trim().length < 50) {
      return new Response(
        JSON.stringify({ error: "Text too short for analysis (min 50 chars)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const truncatedText = text.slice(0, 100000);

    const { endpoint, model, apiKey } = getEndpointAndModel(
      provider || 'lovable',
      user_model || 'google/gemini-2.5-flash',
      user_api_key || null
    );

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "No API key available. Configure in profile or contact admin." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isChapterMode = mode === "chapter";
    const systemPrompt = isChapterMode ? SYSTEM_PROMPT_CHAPTER : SYSTEM_PROMPT_FULL;
    const userContent = isChapterMode
      ? `Analyze the following chapter "${chapter_title || 'Untitled'}" and decompose it into scenes:\n\n${truncatedText}`
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

    // Helper to make the AI call with retries
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

    // Primary call
    let response = await callAI(endpoint, model, apiKey, provider || 'lovable');

    // Fallback: if Lovable gateway returns 400 (model not supported), try OpenRouter
    if (response.status === 400 && (provider === 'lovable' || !provider)) {
      const orKey = openrouter_api_key || user_api_key;
      const fallback = canFallbackToOpenRouter(orKey, model);
      if (fallback) {
        console.log(`Lovable gateway 400 for model ${model}, falling back to OpenRouter`);
        await response.text(); // consume
        response = await callAI(fallback.endpoint, fallback.model, fallback.apiKey, 'openrouter');
      }
    }

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (status === 502 || status === 503) {
        return new Response(
          JSON.stringify({ error: "AI service temporarily unavailable. Please retry in a few seconds." }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await response.text();
      console.error("AI error:", status, "model:", model, errText);
      return new Response(
        JSON.stringify({ error: `AI analysis failed (${status})` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      return new Response(
        JSON.stringify({ error: "AI did not return structured output" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const structure = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ structure }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-book-structure error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
