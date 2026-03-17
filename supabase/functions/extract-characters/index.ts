import { logAiUsage, getUserIdFromAuth } from "../_shared/logAiUsage.ts";

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

// ── Prompt ──────────────────────────────────────────────────

function buildPrompt(scenes: { scene_number: number; text: string }[], lang: "ru" | "en") {
  const isRu = lang === "ru";

  const systemPrompt = isRu
    ? `Ты — литературный аналитик. Твоя задача — найти ВСЕХ персонажей (людей, существ, 
говорящих животных) в предложенных сценах главы. 

Правила:
1. Персонаж — это ИМЕНОВАННАЯ сущность, которая действует, говорит или упоминается по имени.
2. Нарицательные слова (мужчина, старик, солдат) — НЕ персонажи, если у них нет имени.
3. Учитывай все падежные формы русского языка: «Бригадир/Бригадира/Бригадиру» — один персонаж.
4. Если персонажа называют по-разному (имя, фамилия, прозвище, сокращение), укажи основное 
   имя в поле "name" и все варианты в "aliases".
5. Определи пол персонажа по контексту (род глаголов, местоимения).
6. Укажи номера сцен, где персонаж появляется (действует, говорит или упоминается).
7. НЕ включай абстрактные понятия, топонимы, организации.
8. Слова вроде «Угу», «Сейчас», «Тихо» — это НЕ имена персонажей.`
    : `You are a literary analyst. Find ALL characters (people, creatures, talking animals) 
in the provided chapter scenes.

Rules:
1. A character is a NAMED entity that acts, speaks, or is mentioned by name.
2. Common nouns (man, old man, soldier) are NOT characters unless they have a name.
3. Account for all grammatical forms: "John/John's" = one character.
4. If a character is referred to differently (name, surname, nickname), put the primary 
   name in "name" and all variants in "aliases".
5. Determine gender from context (verb forms, pronouns).
6. List scene numbers where the character appears (acts, speaks, or is mentioned).
7. Do NOT include abstract concepts, place names, organizations.
8. Words like "Yeah", "Now", "Quiet" are NOT character names.`;

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
): Promise<ExtractedCharacter[]> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const t0 = Date.now();

  const body: Record<string, unknown> = {
    model,
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

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const latencyMs = Date.now() - t0;

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("AI gateway error:", resp.status, errText);
    await logAiUsage({
      userId,
      modelId: model,
      requestType: "extract-characters",
      status: "error",
      latencyMs,
      errorMessage: `${resp.status}: ${errText.slice(0, 200)}`,
    });
    if (resp.status === 429) throw new Error("rate_limited");
    if (resp.status === 402) throw new Error("payment_required");
    throw new Error(`AI gateway ${resp.status}`);
  }

  const json = await resp.json();
  const usage = json.usage;

  await logAiUsage({
    userId,
    modelId: model,
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

    let { scenes, lang = "ru", model = "google/gemini-2.5-flash" } = await req.json();
    // Strip provider prefixes (e.g. "openrouter/google/gemini-2.5-pro" → "google/gemini-2.5-pro")
    if (model && model.includes("/") && model.split("/").length > 2) {
      model = model.split("/").slice(-2).join("/");
    }

    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      return new Response(
        JSON.stringify({ error: "scenes array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { systemPrompt, userPrompt } = buildPrompt(scenes, lang as "ru" | "en");
    const characters = await callAI(systemPrompt, userPrompt, model, userId);

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
