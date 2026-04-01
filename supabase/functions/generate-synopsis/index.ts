/**
 * generate-synopsis — AI generation of chapter/scene synopses from content.
 *
 * Input:
 *   { level: "chapter" | "scene", content: string, lang: "ru"|"en",
 *     model, apiKey, openrouter_api_key?, characters?: [...] }
 *
 * For "chapter": content = concatenated scene texts of the chapter.
 * For "scene": content = storyboard text of the scene, characters = profiles.
 *
 * Output:
 *   For chapter: { summary, tone, keyThemes: string[] }
 *   For scene:   { events, mood, setting }
 */

import { resolveAiEndpoint, extractProviderFields } from "../_shared/providerRouting.ts";
import { logAiUsage, getUserIdFromAuth } from "../_shared/logAiUsage.ts";
import { modelParams } from "../_shared/modelParams.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { level, content, lang = "ru", characters } = body as {
      level: "chapter" | "scene";
      content: string;
      lang?: "ru" | "en";
      characters?: Array<{ name: string; gender: string; temperament?: string; speech_style?: string }>;
    };

    if (!level || !content) {
      return new Response(JSON.stringify({ error: "level and content required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { model, apiKey, openrouterApiKey } = extractProviderFields(body);
    const resolved = resolveAiEndpoint(model, apiKey, openrouterApiKey);

    const authHeader = req.headers.get("Authorization") || "";
    const userId = await getUserIdFromAuth(authHeader);

    const isRu = lang === "ru";
    const systemPrompt = level === "chapter"
      ? buildChapterSystemPrompt(isRu)
      : buildSceneSystemPrompt(isRu, characters);

    const userPrompt = content.slice(0, 48000); // generous limit for full chapters

    const startMs = Date.now();
    const aiResp = await fetch(resolved.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify({
        model: resolved.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        ...modelParams(resolved.model),
        response_format: { type: "json_object" },
      }),
    });

    const latencyMs = Date.now() - startMs;

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      if (userId) {
        await logAiUsage({ userId, modelId: model, requestType: "generate-synopsis", status: "error", latencyMs, errorMessage: errText });
      }
      return new Response(JSON.stringify({ error: errText }), {
        status: aiResp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    const raw = data.choices?.[0]?.message?.content || "{}";

    if (userId) {
      await logAiUsage({
        userId,
        modelId: model,
        requestType: `generate-synopsis-${level}`,
        status: "success",
        latencyMs,
        tokensInput: data.usage?.prompt_tokens,
        tokensOutput: data.usage?.completion_tokens,
      });
    }

    // Parse AI response
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Try to extract JSON from markdown fences
      const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      parsed = match ? JSON.parse(match[1]) : {};
    }

    return new Response(JSON.stringify({ ...parsed, usedModel: resolved.model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-synopsis error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Prompt builders ────────────────────────────────────────────────

function buildChapterSystemPrompt(isRu: boolean): string {
  if (isRu) {
    return `Ты — литературный аналитик. Проанализируй текст главы и верни JSON:
{
  "summary": "Краткий синопсис главы (3-5 предложений): основные события, конфликты, повороты сюжета",
  "tone": "Общий тон главы (1-2 слова, например: 'мрачный, напряжённый')",
  "keyThemes": ["тема1", "тема2", "тема3"]
}

Синопсис должен быть достаточно информативным, чтобы переводчик, не читавший главу,
понимал контекст каждой сцены. Обязательно отметь ключевые эмоциональные переломы.
Ответ — ТОЛЬКО JSON, без пояснений.`;
  }
  return `You are a literary analyst. Analyze the chapter text and return JSON:
{
  "summary": "Brief chapter synopsis (3-5 sentences): main events, conflicts, plot turns",
  "tone": "Overall tone (1-2 words, e.g. 'dark, tense')",
  "keyThemes": ["theme1", "theme2", "theme3"]
}

The synopsis must be informative enough for a translator unfamiliar with the chapter
to understand each scene's context. Highlight key emotional turning points.
Return ONLY JSON, no explanations.`;
}

function buildSceneSystemPrompt(
  isRu: boolean,
  characters?: Array<{ name: string; gender: string; temperament?: string; speech_style?: string }>,
): string {
  const charBlock = characters?.length
    ? (isRu ? "\n\nПерсонажи сцены:\n" : "\n\nScene characters:\n") +
      characters.map((c) => `- ${c.name} (${c.gender}${c.temperament ? `, ${c.temperament}` : ""}${c.speech_style ? `, ${c.speech_style}` : ""})`).join("\n")
    : "";

  if (isRu) {
    return `Ты — литературный аналитик. Проанализируй текст сцены и верни JSON:
{
  "events": "Что происходит в сцене (2-4 предложения): действия, диалоги, повороты",
  "mood": "Настроение сцены (1-2 слова)",
  "setting": "Место и время действия (1 предложение)"
}
${charBlock}

Будь точен и лаконичен. Ответ — ТОЛЬКО JSON.`;
  }
  return `You are a literary analyst. Analyze the scene text and return JSON:
{
  "events": "What happens in the scene (2-4 sentences): actions, dialogues, turns",
  "mood": "Scene mood (1-2 words)",
  "setting": "Location and time (1 sentence)"
}
${charBlock}

Be precise and concise. Return ONLY JSON.`;
}
