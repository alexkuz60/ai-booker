/**
 * translate-literal — Faithful, word-by-word translation of storyboard segments.
 *
 * Input:  { segments: [{text, type, speaker}], sourceLang, targetLang, model, apiKey, ... }
 * Output: { translations: [{original, translation}], usedModel }
 *
 * Uses art_translator:translate_literal task prompt.
 * Supports batch (multiple segments in one call) for efficiency.
 */

import { resolveAiEndpoint, extractProviderFields } from "../_shared/providerRouting.ts";
import { logAiUsage, getUserIdFromAuth } from "../_shared/logAiUsage.ts";
import { resolveTaskPromptWithOverrides } from "../_shared/taskPrompts.ts";
import { modelParams } from "../_shared/modelParams.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SegmentInput {
  text: string;
  type?: string;
  speaker?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      segments,
      sourceLang = "ru",
      targetLang = "en",
      lang,
    } = body as {
      segments: SegmentInput[];
      sourceLang?: string;
      targetLang?: string;
      lang?: "ru" | "en";
    };

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return new Response(
        JSON.stringify({ error: "segments[] is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Provider routing
    const { model, apiKey, openrouterApiKey } = extractProviderFields(body);
    const resolved = resolveAiEndpoint(model, apiKey, openrouterApiKey);

    // System prompt
    const promptLang = lang || (sourceLang === "ru" ? "ru" : "en");
    const systemPrompt =
      (await resolveTaskPromptWithOverrides("art_translator:translate_literal", promptLang)) ||
      "Translate the following text faithfully, preserving structure and markers.";

    // Build user content — batch all segments
    const segmentTexts = segments.map((s, i) => {
      const meta = [s.type, s.speaker].filter(Boolean).join(", ");
      const prefix = meta ? `[${meta}] ` : "";
      return `--- Segment ${i + 1} ---\n${prefix}${s.text}`;
    });

    const userContent = [
      `Source language: ${sourceLang}`,
      `Target language: ${targetLang}`,
      `Total segments: ${segments.length}`,
      "",
      ...segmentTexts,
      "",
      `Return exactly ${segments.length} translated segments, separated by "--- Segment N ---" markers. No explanations.`,
    ].join("\n");

    const start = Date.now();

    const response = await fetch(resolved.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify({
        model: resolved.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        ...modelParams(resolved.model, { maxTokens: 8192, temperature: 0.3 }),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      const latencyMs = Date.now() - start;

      // Log failure
      const authHeader = req.headers.get("authorization") || "";
      const userId = await getUserIdFromAuth(authHeader);
      if (userId) {
        await logAiUsage({
          userId,
          modelId: model || resolved.model,
          requestType: "translate_literal",
          status: "error",
          latencyMs,
          errorMessage: errText.slice(0, 500),
        });
      }

      return new Response(
        JSON.stringify({ error: `AI provider error: ${response.status}`, details: errText.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    const latencyMs = Date.now() - start;
    const content = data.choices?.[0]?.message?.content || "";
    const tokensInput = data.usage?.prompt_tokens ?? null;
    const tokensOutput = data.usage?.completion_tokens ?? null;

    // Parse response — split by segment markers
    const translations = parseSegmentedResponse(content, segments);

    // Log success
    const authHeader = req.headers.get("authorization") || "";
    const userId = await getUserIdFromAuth(authHeader);
    if (userId) {
      await logAiUsage({
        userId,
        modelId: model || resolved.model,
        requestType: "translate_literal",
        status: "success",
        latencyMs,
        tokensInput,
        tokensOutput,
      });
    }

    return new Response(
      JSON.stringify({
        translations,
        usedModel: resolved.model,
        latencyMs,
        tokensInput,
        tokensOutput,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("translate-literal error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/**
 * Parse AI response split by "--- Segment N ---" markers.
 * Falls back to splitting by double newlines if markers not found.
 */
function parseSegmentedResponse(
  content: string,
  originalSegments: SegmentInput[],
): { original: string; translation: string }[] {
  // Try marker-based split
  const markerParts = content.split(/---\s*Segment\s*\d+\s*---/i).filter((s) => s.trim());

  if (markerParts.length >= originalSegments.length) {
    return originalSegments.map((seg, i) => ({
      original: seg.text,
      translation: cleanTranslation(markerParts[i]),
    }));
  }

  // Fallback: if only one segment, return whole response
  if (originalSegments.length === 1) {
    return [{ original: originalSegments[0].text, translation: cleanTranslation(content) }];
  }

  // Fallback: split by double newlines
  const parts = content.split(/\n{2,}/).filter((s) => s.trim());
  return originalSegments.map((seg, i) => ({
    original: seg.text,
    translation: cleanTranslation(parts[i] || ""),
  }));
}

function cleanTranslation(text: string): string {
  return text
    .replace(/^\[.*?\]\s*/, "") // remove [type, speaker] prefix if echoed
    .trim();
}
