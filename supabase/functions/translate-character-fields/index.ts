/**
 * translate-character-fields — Convert Russian character profile fields
 * (description, speech_style) into concise ENGLISH voice-design instructions
 * suitable for OmniVoice / OpenAI gpt-4o-mini-tts.
 *
 * Why English: gpt-4o-mini-tts (the model OmniVoice is built on) was trained
 * primarily on English instructions. English prompts give significantly more
 * stable and accurate results than Russian.
 *
 * Why structured output via tool calling: guarantees we get exactly two
 * fields back, never a wrapping markdown explanation.
 *
 * Auth: manual JWT validation (see /useful-context/).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a voice-direction translator for a text-to-speech engine.
You convert Russian character descriptions into SHORT, CONCRETE English
voice-design instructions that an inflection model can act on directly.

Rules:
- Output English ONLY. No Russian, no transliteration.
- Each field MUST be ≤80 characters.
- Focus on DELIVERY: tone, pace, register, energy, manner — not biography.
- Use vocabulary from voice direction: "warm", "raspy", "clipped", "drawling",
  "measured", "breathy", "tense", "low-pitched", "slight stutter", etc.
- Drop names, plot details, physical appearance. Keep only what affects HOW
  the voice sounds.
- If a field is empty or contains nothing voice-relevant, return an empty string.
- Never wrap output in quotes or markdown.`.trim();

interface TranslateRequest {
  description?: string | null;
  speech_style?: string | null;
}

interface TranslateResponse {
  description_en: string;
  speech_style_en: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimData, error: claimErr } = await supabase.auth.getClaims(token);
    if (claimErr || !claimData?.claims) {
      return json({ error: "Unauthorized" }, 401);
    }

    // ── Input ──
    let body: TranslateRequest;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const description = (body.description ?? "").trim();
    const speech_style = (body.speech_style ?? "").trim();

    // Both empty → short-circuit, no AI call
    if (!description && !speech_style) {
      return json<TranslateResponse>({ description_en: "", speech_style_en: "" }, 200);
    }

    // ── Call Lovable AI Gateway ──
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return json({ error: "LOVABLE_API_KEY not configured" }, 500);
    }

    const userPrompt = [
      "Translate these Russian character fields into concise English voice-design instructions.",
      "",
      `description (RU): ${description || "(empty)"}`,
      `speech_style (RU): ${speech_style || "(empty)"}`,
    ].join("\n");

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "emit_translation",
              description:
                "Return the two translated voice-design fields. Each ≤80 chars, English only.",
              parameters: {
                type: "object",
                properties: {
                  description_en: {
                    type: "string",
                    description:
                      "English voice description (≤80 chars). Focus on delivery, tone, register. Empty if input was empty or non-vocal.",
                  },
                  speech_style_en: {
                    type: "string",
                    description:
                      "English speech-style direction (≤80 chars). Focus on manner: pace, texture, disfluencies. Empty if input was empty.",
                  },
                },
                required: ["description_en", "speech_style_en"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "emit_translation" } },
      }),
    });

    if (aiRes.status === 429) {
      return json({ error: "Rate limited, please try again later." }, 429);
    }
    if (aiRes.status === 402) {
      return json({ error: "Lovable AI credits exhausted. Add funds in Settings → Workspace → Usage." }, 402);
    }
    if (!aiRes.ok) {
      const t = await aiRes.text().catch(() => "");
      console.error("[translate-character-fields] AI gateway error:", aiRes.status, t);
      return json({ error: `AI gateway error: ${aiRes.status}` }, 502);
    }

    const aiJson = await aiRes.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    const argsRaw = toolCall?.function?.arguments;
    if (!argsRaw) {
      console.error("[translate-character-fields] No tool call in response:", JSON.stringify(aiJson));
      return json({ error: "Model did not return structured output" }, 502);
    }

    let parsed: TranslateResponse;
    try {
      parsed = JSON.parse(argsRaw);
    } catch (e) {
      console.error("[translate-character-fields] Failed to parse tool args:", argsRaw);
      return json({ error: "Malformed structured output" }, 502);
    }

    // Defensive trimming + length cap
    const out: TranslateResponse = {
      description_en: clamp((parsed.description_en ?? "").trim(), 80),
      speech_style_en: clamp((parsed.speech_style_en ?? "").trim(), 80),
    };

    return json(out, 200);
  } catch (e) {
    console.error("[translate-character-fields] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json<T>(body: T, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trim();
}
