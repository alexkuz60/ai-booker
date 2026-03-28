/**
 * translate-literary — Artistic/literary translation refinement.
 *
 * Input:  { original, literal, type, speaker, speakerProfile, bpm, context, sourceLang, targetLang, model, apiKey, ... }
 * Output: { text, notes[], usedModel }
 *
 * Uses art_translator:translate_literary task prompt.
 * Takes the literal translation from translate-literal and refines it
 * into natural, expressive prose suitable for audiobook narration.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      original,
      literal,
      type: segType = "narrator",
      speaker,
      speakerProfile,
      bpm,
      context,
      sourceLang = "ru",
      targetLang = "en",
      lang,
    } = body as {
      original: string;
      literal: string;
      type?: string;
      speaker?: string;
      speakerProfile?: { name: string; psychoTags?: string[]; speechStyle?: string; temperament?: string };
      bpm?: number;
      context?: string;
      sourceLang?: string;
      targetLang?: string;
      lang?: "ru" | "en";
    };

    if (!original || !literal) {
      return new Response(
        JSON.stringify({ error: "original and literal are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Provider routing
    const { model, apiKey, openrouterApiKey } = extractProviderFields(body);
    const resolved = resolveAiEndpoint(model, apiKey, openrouterApiKey);

    // System prompt
    const promptLang = lang || (targetLang === "ru" ? "ru" : "en");
    const systemPrompt =
      (await resolveTaskPromptWithOverrides("art_translator:translate_literary", promptLang)) ||
      "Refine the literal translation into natural artistic prose.";

    // Build user content with full context
    const userParts: string[] = [
      `Source language: ${sourceLang}`,
      `Target language: ${targetLang}`,
      `Segment type: ${segType}`,
    ];

    if (speaker) userParts.push(`Speaker: ${speaker}`);
    if (bpm) userParts.push(`Target BPM: ${bpm}`);

    if (speakerProfile) {
      const profileLines = [`Character profile:`];
      profileLines.push(`  Name: ${speakerProfile.name}`);
      if (speakerProfile.temperament) profileLines.push(`  Temperament: ${speakerProfile.temperament}`);
      if (speakerProfile.speechStyle) profileLines.push(`  Speech style: ${speakerProfile.speechStyle}`);
      if (speakerProfile.psychoTags?.length) profileLines.push(`  Psycho tags: ${speakerProfile.psychoTags.join(", ")}`);
      userParts.push(profileLines.join("\n"));
    }

    if (context) {
      userParts.push(`\nSurrounding context:\n${context}`);
    }

    userParts.push(
      `\n--- Original (${sourceLang}) ---\n${original}`,
      `\n--- Literal translation (${targetLang}) ---\n${literal}`,
      `\nRefine the literal translation into natural, expressive ${targetLang} prose. Return JSON: { "text": "...", "notes": ["..."] }`,
    );

    const userContent = userParts.join("\n");
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
        ...modelParams(resolved.model, { maxTokens: 4096, temperature: 0.5 }),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      const latencyMs = Date.now() - start;

      const authHeader = req.headers.get("authorization") || "";
      const userId = await getUserIdFromAuth(authHeader);
      if (userId) {
        await logAiUsage({
          userId,
          modelId: model || resolved.model,
          requestType: "translate_literary",
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
    const rawContent = data.choices?.[0]?.message?.content || "";
    const tokensInput = data.usage?.prompt_tokens ?? null;
    const tokensOutput = data.usage?.completion_tokens ?? null;

    // Parse JSON response
    const result = parseTranslationResult(rawContent);

    // Log success
    const authHeader = req.headers.get("authorization") || "";
    const userId = await getUserIdFromAuth(authHeader);
    if (userId) {
      await logAiUsage({
        userId,
        modelId: model || resolved.model,
        requestType: "translate_literary",
        status: "success",
        latencyMs,
        tokensInput,
        tokensOutput,
      });
    }

    return new Response(
      JSON.stringify({
        text: result.text,
        notes: result.notes,
        usedModel: resolved.model,
        latencyMs,
        tokensInput,
        tokensOutput,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("translate-literary error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/**
 * Parse the AI response as JSON { text, notes }.
 * Falls back gracefully if response isn't valid JSON.
 */
function parseTranslationResult(raw: string): { text: string; notes: string[] } {
  // Strip markdown code fences
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      text: String(parsed.text || ""),
      notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
    };
  } catch {
    // Try to extract JSON from within the response
    const jsonMatch = cleaned.match(/\{[\s\S]*"text"\s*:\s*"[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          text: String(parsed.text || ""),
          notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
        };
      } catch { /* fall through */ }
    }

    // Last resort: treat entire response as translation text
    return { text: cleaned, notes: [] };
  }
}
