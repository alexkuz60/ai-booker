import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are "The Architect" — an AI agent that analyzes book text and decomposes it into a structured screenplay format.

Your task:
1. Clean the text: remove page numbers, footnotes, headers/footers, and other technical artifacts.
2. Identify and segment the text into chapters. If chapters are not explicitly marked, infer logical chapter boundaries.
3. Within each chapter, identify scenes — logical segments where setting, time, or action changes.
4. For each scene, determine:
   - scene_type: one of "action", "dialogue", "lyrical_digression", "description", "inner_monologue", "mixed"
   - mood: the dominant emotional tone (e.g. "tense", "calm", "melancholic", "joyful", "dark", "romantic", "comedic")
   - bpm: suggested narrative tempo as beats-per-minute metaphor (60-80 slow/contemplative, 80-110 moderate, 110-140 dynamic, 140+ intense)

You MUST respond using the suggest_structure tool.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, user_api_key, user_model } = await req.json();

    if (!text || text.trim().length < 100) {
      return new Response(
        JSON.stringify({ error: "Text too short for analysis (min 100 chars)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Truncate to ~100k chars to fit context window
    const truncatedText = text.slice(0, 100000);

    // Determine API key and endpoint
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const apiKey = user_api_key || LOVABLE_API_KEY;
    
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "No API key available. Configure in profile or contact admin." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isLovableAI = !user_api_key;
    const endpoint = isLovableAI
      ? "https://ai.gateway.lovable.dev/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";

    const model = user_model || (isLovableAI ? "google/gemini-2.5-flash" : "gpt-4o");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Analyze the following book text and decompose it into chapters and scenes:\n\n${truncatedText}`,
          },
        ],
        tools: [
          {
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
          },
        ],
        tool_choice: { type: "function", function: { name: "suggest_structure" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: `AI analysis failed (${response.status})` }),
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
