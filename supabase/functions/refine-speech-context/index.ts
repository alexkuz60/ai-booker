/**
 * Scene-level speech refinement for a character.
 * Analyzes how a character speaks in a specific scene and returns speech_context
 * to be stored in scene_segments.metadata.speech_context.
 *
 * Input: { scene_id, character_name, segments_text, character_profile, lang, model, apiKey }
 * Output: { speech_context: { emotion, tempo, volume_hint, manner, tts_instructions } }
 */

import { resolveAiEndpoint, extractProviderFields } from "../_shared/providerRouting.ts";
import { logAiUsage, getUserIdFromAuth } from "../_shared/logAiUsage.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const {
      scene_id,
      character_name,
      segments_text,
      character_profile,
      lang = "ru",
    } = body as {
      scene_id: string;
      character_name: string;
      segments_text: string[];
      character_profile?: {
        description?: string;
        temperament?: string;
        speech_style?: string;
        speech_tags?: string[];
        psycho_tags?: string[];
      };
      lang?: string;
    };

    if (!scene_id || !character_name || !segments_text?.length) {
      return new Response(JSON.stringify({ error: "scene_id, character_name, segments_text required" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { model, apiKey, openrouterApiKey } = extractProviderFields(body);
    const { endpoint, model: resolvedModel, apiKey: resolvedKey } = resolveAiEndpoint(model, apiKey, openrouterApiKey);

    // Build prompt
    const isRu = lang === "ru";
    const profileBlock = character_profile
      ? `\n${isRu ? "Профайл персонажа" : "Character profile"}:\n` +
        (character_profile.description ? `- ${character_profile.description}\n` : "") +
        (character_profile.temperament ? `- ${isRu ? "Темперамент" : "Temperament"}: ${character_profile.temperament}\n` : "") +
        (character_profile.speech_style ? `- ${isRu ? "Стиль речи" : "Speech style"}: ${character_profile.speech_style}\n` : "") +
        (character_profile.speech_tags?.length ? `- ${isRu ? "Манера" : "Manner"}: ${character_profile.speech_tags.join(", ")}\n` : "") +
        (character_profile.psycho_tags?.length ? `- ${isRu ? "Психотип" : "Psychotype"}: ${character_profile.psycho_tags.join(", ")}\n` : "")
      : "";

    const systemPrompt = isRu
      ? `Ты — речевой аналитик аудиокниги. Проанализируй, КАК персонаж «${character_name}» говорит В ДАННОЙ КОНКРЕТНОЙ СЦЕНЕ. Учитывай контекст сцены (эмоции, напряжение, отношения с собеседниками).${profileBlock}

Верни JSON (без markdown-блоков):
{
  "emotion": "основная эмоция в этой сцене (1-2 слова)",
  "tempo": "slow|normal|fast|variable",
  "volume_hint": "whisper|quiet|normal|loud|shouting",
  "manner": "краткое описание манеры в этой сцене (10-20 слов)",
  "tts_instructions_ru": "конкретные инструкции для TTS-движка на русском (20-40 слов)",
  "tts_instructions_en": "same instructions in English"
}`
      : `You are an audiobook speech analyst. Analyze HOW the character "${character_name}" speaks IN THIS SPECIFIC SCENE. Consider scene context (emotions, tension, relationships).${profileBlock}

Return JSON (no markdown fences):
{
  "emotion": "primary emotion in this scene (1-2 words)",
  "tempo": "slow|normal|fast|variable",
  "volume_hint": "whisper|quiet|normal|loud|shouting",
  "manner": "brief description of manner in this scene (10-20 words)",
  "tts_instructions_ru": "specific TTS engine instructions in Russian (20-40 words)",
  "tts_instructions_en": "same instructions in English"
}`;

    const userContent = `${isRu ? "Реплики персонажа в сцене" : "Character lines in scene"}:\n\n${segments_text.join("\n---\n")}`;

    const t0 = Date.now();
    const aiRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resolvedKey}` },
      body: JSON.stringify({
        model: resolvedModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    const latencyMs = Date.now() - t0;

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI error:", aiRes.status, errText);
      const errStatus = aiRes.status === 429 ? 429 : aiRes.status === 402 ? 402 : 502;
      return new Response(JSON.stringify({ error: `AI ${aiRes.status}` }), {
        status: errStatus,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiRes.json();
    const raw = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let speech_context: Record<string, unknown>;
    try {
      const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      speech_context = JSON.parse(cleaned);
    } catch {
      // Try to find JSON object in text
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        speech_context = JSON.parse(match[0]);
      } else {
        return new Response(JSON.stringify({ error: "Failed to parse AI response", raw }), {
          status: 502, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
    }

    // Log usage
    const authHeader = req.headers.get("authorization") || "";
    const userId = await getUserIdFromAuth(authHeader);
    if (userId) {
      const usage = aiData.usage;
      logAiUsage({
        userId,
        modelId: resolvedModel,
        requestType: "refine_speech_context",
        status: "success",
        latencyMs,
        tokensInput: usage?.prompt_tokens ?? null,
        tokensOutput: usage?.completion_tokens ?? null,
      });
    }

    return new Response(JSON.stringify({
      speech_context,
      usedModel: resolvedModel,
    }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("refine-speech-context error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
