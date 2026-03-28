/**
 * critique-translation — Quality Radar assessment of a translation.
 *
 * Input:  { original, translation, type, speaker, bpm, sourceLang, targetLang,
 *           embeddingDeltas?, model, apiKey, ... }
 * Output: { scores: {semantic,sentiment,rhythm,phonetics,cultural},
 *           overall, verdict, issues[], summary, usedModel }
 *
 * Uses translation_critic:critique_translation task prompt.
 * The critic evaluates translation quality across 5 axes (0–100 each)
 * and returns structured issues with specific text fragments.
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

interface CritiqueScores {
  semantic: number;
  sentiment: number;
  rhythm: number;
  phonetics: number;
  cultural: number;
}

interface CritiqueIssue {
  axis: string;
  severity: "low" | "medium" | "high";
  fragment_original: string;
  fragment_translation: string;
  suggestion: string;
}

interface CritiqueResult {
  scores: CritiqueScores;
  overall: number;
  verdict: "good" | "acceptable" | "needs_revision";
  issues: CritiqueIssue[];
  summary: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      original,
      translation,
      type: segType = "narrator",
      speaker,
      bpm,
      sourceLang = "ru",
      targetLang = "en",
      lang,
      embeddingDeltas,
    } = body as {
      original: string;
      translation: string;
      type?: string;
      speaker?: string;
      bpm?: number;
      sourceLang?: string;
      targetLang?: string;
      lang?: "ru" | "en";
      embeddingDeltas?: { semantic?: number; rhythm?: number; phonetic?: number };
    };

    if (!original || !translation) {
      return new Response(
        JSON.stringify({ error: "original and translation are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Provider routing
    const { model, apiKey, openrouterApiKey } = extractProviderFields(body);
    const resolved = resolveAiEndpoint(model, apiKey, openrouterApiKey);

    // System prompt
    const promptLang = lang || (sourceLang === "ru" ? "ru" : "en");
    const systemPrompt =
      (await resolveTaskPromptWithOverrides("translation_critic:critique_translation", promptLang)) ||
      "Evaluate translation quality across 5 axes.";

    // Build user content
    const userParts: string[] = [
      `Source language: ${sourceLang}`,
      `Target language: ${targetLang}`,
      `Segment type: ${segType}`,
    ];

    if (speaker) userParts.push(`Speaker: ${speaker}`);
    if (bpm) userParts.push(`Target BPM: ${bpm}`);

    // Include programmatic embedding deltas if available
    if (embeddingDeltas) {
      const deltaLines = ["Programmatic analysis (pre-computed):"];
      if (embeddingDeltas.semantic != null) {
        deltaLines.push(`  Semantic embedding similarity: ${(embeddingDeltas.semantic * 100).toFixed(1)}%`);
      }
      if (embeddingDeltas.rhythm != null) {
        deltaLines.push(`  Rhythmic similarity: ${(embeddingDeltas.rhythm * 100).toFixed(1)}%`);
      }
      if (embeddingDeltas.phonetic != null) {
        deltaLines.push(`  Phonetic texture similarity: ${(embeddingDeltas.phonetic * 100).toFixed(1)}%`);
      }
      userParts.push(deltaLines.join("\n"));
    }

    userParts.push(
      `\n--- Original (${sourceLang}) ---\n${original}`,
      `\n--- Translation (${targetLang}) ---\n${translation}`,
      `\nEvaluate the translation quality. Return JSON with scores, verdict, issues, and summary.`,
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
        ...modelParams(resolved.model, { maxTokens: 4096, temperature: 0.3 }),
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
          requestType: "critique_translation",
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

    // Parse critique result
    const result = parseCritiqueResult(rawContent);

    // Log success
    const authHeader = req.headers.get("authorization") || "";
    const userId = await getUserIdFromAuth(authHeader);
    if (userId) {
      await logAiUsage({
        userId,
        modelId: model || resolved.model,
        requestType: "critique_translation",
        status: "success",
        latencyMs,
        tokensInput,
        tokensOutput,
      });
    }

    return new Response(
      JSON.stringify({
        ...result,
        usedModel: resolved.model,
        latencyMs,
        tokensInput,
        tokensOutput,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("critique-translation error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/**
 * Parse AI response as CritiqueResult JSON.
 * Robust: handles markdown fences, partial JSON, and malformed responses.
 */
function parseCritiqueResult(raw: string): CritiqueResult {
  const defaultResult: CritiqueResult = {
    scores: { semantic: 0, sentiment: 0, rhythm: 0, phonetics: 0, cultural: 0 },
    overall: 0,
    verdict: "needs_revision",
    issues: [],
    summary: "",
  };

  // Strip markdown code fences
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return validateCritiqueResult(parsed);
  } catch {
    // Try to extract JSON block
    const jsonMatch = cleaned.match(/\{[\s\S]*"scores"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return validateCritiqueResult(parsed);
      } catch { /* fall through */ }
    }

    // Return default with raw summary
    return { ...defaultResult, summary: cleaned.slice(0, 500) };
  }
}

function validateCritiqueResult(parsed: Record<string, unknown>): CritiqueResult {
  const scores = parsed.scores as Record<string, number> | undefined;

  const validScores: CritiqueScores = {
    semantic: clampScore(scores?.semantic),
    sentiment: clampScore(scores?.sentiment),
    rhythm: clampScore(scores?.rhythm),
    phonetics: clampScore(scores?.phonetics),
    cultural: clampScore(scores?.cultural),
  };

  const overall = clampScore(parsed.overall as number | undefined) ||
    Math.round(Object.values(validScores).reduce((a, b) => a + b, 0) / 5);

  const verdict = (["good", "acceptable", "needs_revision"] as const).includes(
    parsed.verdict as "good" | "acceptable" | "needs_revision",
  )
    ? (parsed.verdict as "good" | "acceptable" | "needs_revision")
    : deriveVerdict(validScores, overall);

  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.map((iss: Record<string, unknown>) => ({
        axis: String(iss.axis || ""),
        severity: (["low", "medium", "high"].includes(String(iss.severity))
          ? String(iss.severity)
          : "medium") as "low" | "medium" | "high",
        fragment_original: String(iss.fragment_original || ""),
        fragment_translation: String(iss.fragment_translation || ""),
        suggestion: String(iss.suggestion || ""),
      }))
    : [];

  return {
    scores: validScores,
    overall,
    verdict,
    issues,
    summary: String(parsed.summary || ""),
  };
}

function clampScore(v: number | undefined): number {
  if (v == null || isNaN(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function deriveVerdict(
  scores: CritiqueScores,
  overall: number,
): "good" | "acceptable" | "needs_revision" {
  const vals = Object.values(scores);
  if (overall >= 85 && vals.every((v) => v >= 70)) return "good";
  if (overall >= 70 && vals.every((v) => v >= 50)) return "acceptable";
  return "needs_revision";
}
