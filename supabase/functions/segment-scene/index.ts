import { splitPhrases } from "../_shared/splitPhrases.ts";
import { logAiUsage, getUserIdFromAuth } from "../_shared/logAiUsage.ts";
import { resolveAiEndpoint } from "../_shared/providerRouting.ts";
import { resolveTaskPromptWithOverrides } from "../_shared/taskPrompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SEGMENT_TYPES = [
  "epigraph",
  "narrator",
  "first_person",
  "inner_thought",
  "dialogue",
  "monologue",
  "lyric",
  "footnote",
  "telephone",
  "remark",
] as const;

type SegmentType = (typeof SEGMENT_TYPES)[number];

interface InlineNarration {
  text: string;
  insert_after: string;
}

interface AISegment {
  type: SegmentType;
  speaker?: string;
  text: string;
  inline_narrations?: InlineNarration[];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u00a0\s]+/g, " ")
    .replace(/[«»"'„“”()\[\]{}.,!?;:—–-]+/g, "")
    .trim();
}

/**
 * Ordered word coverage: how much of the source survives in the returned
 * segments while preserving the original sequence.
 *
 * This stays tolerant to re-splitting into different blocks/paragraphs, but
 * rejects the dangerous "bag of words" behavior where a short fragment with
 * common words could look artificially valid.
 */
function getOrderedCoverageFromSource(sourceNorm: string, segments: AISegment[]): number {
  if (!sourceNorm) return 0;

  const sourceWords = sourceNorm.split(/\s+/).filter(Boolean);
  if (sourceWords.length === 0) return 0;

  const segmentWords = normalizeText(segments.map((s) => s.text || "").join(" "))
    .split(/\s+/)
    .filter(Boolean);
  if (segmentWords.length === 0) return 0;

  let sourceIndex = 0;
  let segmentIndex = 0;
  let matched = 0;

  while (sourceIndex < sourceWords.length && segmentIndex < segmentWords.length) {
    if (sourceWords[sourceIndex] === segmentWords[segmentIndex]) {
      matched++;
      segmentIndex++;
    }
    sourceIndex++;
  }

  return matched / sourceWords.length;
}

function getNormalizedLengthCoverage(sourceNorm: string, segments: AISegment[]): number {
  if (!sourceNorm) return 0;
  const segmentNorm = normalizeText(segments.map((s) => s.text || "").join(" "));
  if (!segmentNorm) return 0;
  return segmentNorm.length / sourceNorm.length;
}

function buildFallbackSegments(content: string, lang: "ru" | "en"): AISegment[] {
  const phrases = splitPhrases(content).filter(Boolean);
  if (phrases.length === 0) {
    return [{ type: lang === "ru" ? "inner_thought" : "narrator", text: content }];
  }

  const segments: AISegment[] = [];
  const chunkSize = 4;
  for (let i = 0; i < phrases.length; i += chunkSize) {
    const text = phrases.slice(i, i + chunkSize).join(" ").trim();
    if (!text) continue;
    segments.push({
      type: lang === "ru" && /\b(я|мне|меня|мной|мною|моего|моей|моему|моим|моими|моих|моё|мое|мои)\b/i.test(text)
        ? "first_person"
        : "narrator",
      text,
    });
  }

  return segments.length > 0 ? segments : [{ type: "narrator", text: content }];
}

/**
 * Repair a truncated JSON array by finding the last complete object and closing the array.
 * Returns parsed array or null if repair fails.
 */
function repairTruncatedJsonArray(raw: string): AISegment[] | null {
  // Find positions of all complete "}" that close a top-level object in the array
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastCompleteObjectEnd = -1;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      // depth=1 means we just closed a top-level object inside the array
      if (depth === 1 && ch === '}') {
        lastCompleteObjectEnd = i;
      }
    }
  }

  if (lastCompleteObjectEnd < 0) return null;

  // Slice up to and including the last complete object, close the array
  const repaired = raw.slice(0, lastCompleteObjectEnd + 1) + "]";
  try {
    const parsed = JSON.parse(repaired);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* still broken */ }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { scene_id, content: bodyContent, language, model: clientModel, provider, apiKey, user_api_key, openrouter_api_key } = await req.json();
    if (!scene_id) {
      return new Response(
        JSON.stringify({ error: "scene_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 🚫 К3: NEVER read content from DB — OPFS is the only source of truth.
    // Content MUST be provided by the client from local storage.
    const content = bodyContent;

    if (!content) {
      return new Response(
        JSON.stringify({ error: "No content found for this scene" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lang = language === "ru" ? "ru" : "en";

    // ── AI segmentation ──────────────────────────────────
    const usedModel = clientModel || "google/gemini-2.5-flash";
    const effectiveApiKey = apiKey || user_api_key || null;
    const resolved = resolveAiEndpoint(usedModel, effectiveApiKey, openrouter_api_key);

    if (!resolved.apiKey) {
      return new Response(JSON.stringify({ error: "AI key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = await getUserIdFromAuth(authHeader);
    const aiStart = Date.now();

    const systemPrompt = (await resolveTaskPromptWithOverrides("screenwriter:segment_scene", lang)) || "You are a literary text analyst.";

    const userPrompt = lang === "ru"
      ? `Сегментируй следующую сцену. ВАЖНО: разбей ВЕСЬ текст от начала до конца на отдельные блоки по типу (диалог, повествование, мысли, монолог и т.д.). Определи говорящего для каждой реплики. НЕ сливай текст в один блок.\nВерни ТОЛЬКО JSON-массив объектов: [{"type":"...","speaker":"...","text":"...","inline_narrations":[]}]\nБез markdown, без пояснений.\n\n${content}`
      : `Segment the following scene. IMPORTANT: split the ENTIRE text from start to finish into separate blocks by type (dialogue, narration, thoughts, monologue, etc.). Identify the speaker for each spoken line. Do NOT merge text into a single block.\nReturn ONLY a JSON array of segment objects: [{"type":"...","speaker":"...","text":"...","inline_narrations":[]}]\nNo markdown, no explanations.\n\n${content}`;

    // max_tokens is a ceiling, not a reservation — you only pay for actually generated tokens.
    const maxTokens = 65536;

    // Use max_completion_tokens for newer models, max_tokens for others
    const isNewModel = /gpt-5|o1|o3|o4/i.test(resolved.model);
    const tokenParam = isNewModel
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };

    // Helper to call AI and parse segments
    async function callAiForSegments(): Promise<{ segments: AISegment[]; usage: any; latency: number }> {
      const start = Date.now();
      // Some models (e.g. openai/gpt-5-mini, gpt-5) reject non-default temperature
      const supportsTemperature = !/gpt-5/i.test(resolved.model);
      const bodyObj: Record<string, unknown> = {
        model: resolved.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        ...(supportsTemperature ? { temperature: 0.1 } : {}),
        ...tokenParam,
      };

      const res = await fetch(resolved.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resolved.apiKey}`,
        },
        body: JSON.stringify(bodyObj),
      });

      const lat = Date.now() - start;

      if (!res.ok) {
        const errText = await res.text();
        console.error("AI gateway error:", res.status, errText);
        if (userId) {
          logAiUsage({ userId, modelId: usedModel, requestType: "segment-scene", status: "error", latencyMs: lat, errorMessage: `AI error: ${res.status}` });
        }
        const statusCode = (res.status === 402 || res.status === 429) ? res.status : 502;
        throw Object.assign(new Error(`AI error: ${res.status}`), { statusCode });
      }

      const data = await res.json();
      let raw = data.choices?.[0]?.message?.content || "";
      raw = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

      // Try to extract JSON array from the response
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Try to find a JSON array in the text
        const arrMatch = raw.match(/\[[\s\S]*\]/);
        if (arrMatch) {
          try {
            parsed = JSON.parse(arrMatch[0]);
          } catch {
            // Attempt to repair truncated JSON array
            const repaired = repairTruncatedJsonArray(arrMatch[0]);
            if (repaired) {
              console.warn("Repaired truncated JSON array, recovered segments");
              parsed = repaired;
            } else {
              console.error("Failed to parse extracted array, raw (first 500 chars):", raw.slice(0, 500));
              throw new Error("Unparseable");
            }
          }
        } else {
          // Maybe the entire response is a truncated array (no closing ])
          const truncMatch = raw.match(/\[[\s\S]*/);
          if (truncMatch) {
            const repaired = repairTruncatedJsonArray(truncMatch[0]);
            if (repaired) {
              console.warn("Repaired truncated JSON (no closing bracket), recovered segments");
              parsed = repaired;
            } else {
              console.error("No parseable JSON in AI response, raw (first 500 chars):", raw.slice(0, 500));
              throw new Error("Unparseable");
            }
          } else {
            // Try to find { "segments": [...] } wrapper
            const objMatch = raw.match(/\{[\s\S]*"segments"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
            if (objMatch) {
              const obj = JSON.parse(objMatch[0]);
              parsed = obj.segments;
            } else {
              console.error("No JSON structure found in AI response, raw (first 500 chars):", raw.slice(0, 500));
              throw new Error("Unparseable");
            }
          }
        }
      }

      // Handle { segments: [...] } wrapper
      const segs = Array.isArray(parsed) ? parsed : (parsed as any)?.segments;
      if (!Array.isArray(segs)) {
        console.error("Parsed result is not an array, type:", typeof parsed, "keys:", parsed && typeof parsed === 'object' ? Object.keys(parsed as object) : 'N/A');
        throw new Error("Unparseable");
      }

      return { segments: segs, usage: data.usage, latency: lat };
    }

    let segments: AISegment[];
    let usage: any;
    let aiLatency: number;
    let usedFallbackSegmentation = false;

    try {
      const r = await callAiForSegments();
      segments = r.segments; usage = r.usage; aiLatency = r.latency;
    } catch (e: any) {
      if (e.statusCode === 402 || e.statusCode === 429) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: e.statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("AI segmentation failed, using fallback segmentation:", e.message);
      segments = buildFallbackSegments(content, lang);
      usage = null;
      aiLatency = Date.now() - aiStart;
      usedFallbackSegmentation = true;
    }

    // ── Validation: ensure segments belong to this source text ──
    const sourceNorm = normalizeText(content);
    const coverageRatio = getNormalizedLengthCoverage(sourceNorm, segments);
    const sourceCoverage = getOrderedCoverageFromSource(sourceNorm, segments);

    // Coverage thresholds: AI must cover a reasonable portion of source text.
    // Too strict thresholds (e.g. 80%) discard good AI results (74% with 23 segments)
    // and replace them with crude paragraph fallback, losing speaker/type info.
    const COVERAGE_THRESHOLD = 0.60;
    const SOURCE_COVERAGE_THRESHOLD = 0.55;

    if (!usedFallbackSegmentation && (coverageRatio < COVERAGE_THRESHOLD || sourceCoverage < SOURCE_COVERAGE_THRESHOLD)) {
      console.warn(`Insufficient segmentation coverage. Length=${Math.round(coverageRatio * 100)}%, source=${Math.round(sourceCoverage * 100)}%, segments=${segments.length}, contentLen=${content.length}`);
      if (userId) {
        logAiUsage({
          userId,
          modelId: usedModel,
          requestType: "segment-scene",
          status: "error",
          latencyMs: aiLatency,
          tokensInput: usage?.prompt_tokens,
          tokensOutput: usage?.completion_tokens,
          errorMessage: `Truncated segmentation: len=${Math.round(coverageRatio * 100)}% source=${Math.round(sourceCoverage * 100)}%`,
        });
      }
      segments = buildFallbackSegments(content, lang);
      usedFallbackSegmentation = true;
    }

    // ── Post-process: detect first-person narration by pronouns ──
    const FIRST_PERSON_RU = /\b(я|мне|меня|мной|мною|моего|моей|моему|моим|моими|моих|моё|мое|мои)\b/i;
    const FIRST_PERSON_EN = /\b(I|me|my|mine|myself)\b/;
    const fpRegex = lang === "ru" ? FIRST_PERSON_RU : FIRST_PERSON_EN;

    for (const seg of segments) {
      if (seg.type === "narrator" && fpRegex.test(seg.text)) {
        seg.type = "first_person";
      }
    }

    // ── Post-process: dialogue vs monologue classification ──
    // A speech block is "dialogue" only if it has adjacent speech neighbors;
    // otherwise it's a standalone "monologue".
    const SPEECH_TYPES = new Set(["dialogue", "monologue"]);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!SPEECH_TYPES.has(seg.type)) continue;

      const prevSpeech = i > 0 && SPEECH_TYPES.has(segments[i - 1].type);
      const nextSpeech = i < segments.length - 1 && SPEECH_TYPES.has(segments[i + 1].type);
      const hasAdjacentSpeech = prevSpeech || nextSpeech;

      if (hasAdjacentSpeech) {
        seg.type = "dialogue";
      } else {
        seg.type = "monologue";
      }
    }

    // Log successful AI call (skip if already logged as error due to coverage failure)
    if (userId && !usedFallbackSegmentation) {
      logAiUsage({ userId, modelId: usedModel, requestType: "segment-scene", status: "success", latencyMs: aiLatency, tokensInput: usage?.prompt_tokens, tokensOutput: usage?.completion_tokens });
    }

    // ── K3: NEVER persist to DB from edge function ─────
    // All DB writes happen via client-side pushToDb() before TTS or "Save to Server".
    // Return light result with client-generated IDs.
    const lightResult = segments.map((seg: AISegment, i: number) => ({
      segment_id: crypto.randomUUID(),
      segment_number: i + 1,
      segment_type: SEGMENT_TYPES.includes(seg.type as SegmentType) ? seg.type : "narrator",
      speaker: seg.speaker || null,
      phrases: splitPhrases(seg.text, lang).map((t: string, j: number) => ({
        phrase_id: crypto.randomUUID(),
        phrase_number: j + 1,
        text: t,
      })),
      inline_narrations: seg.inline_narrations,
    }));

    // Include coverage metrics so client can independently verify
    return new Response(JSON.stringify({
      segments: lightResult,
      coverage: {
        lengthPct: Math.round(coverageRatio * 100),
        sourcePct: Math.round(sourceCoverage * 100),
        usedFallback: usedFallbackSegmentation,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("segment-scene error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
