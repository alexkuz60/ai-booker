/**
 * profile-characters-local: Local-first character profiling.
 * Accepts character names + scene texts, returns psychological profiles.
 * No DB reads — all data comes from client (OPFS).
 *
 * Supports server-side text chunking: if the combined prompt exceeds
 * the model's context window, characters are split into sub-batches,
 * each AI call is made independently, and results are merged before
 * returning to the client. Works for both batch and selective modes.
 */
import { logAiUsage } from "../_shared/logAiUsage.ts";
import { resolveAiEndpoint } from "../_shared/providerRouting.ts";
import { modelParams } from "../_shared/modelParams.ts";
import { resolveTaskPromptWithOverrides } from "../_shared/taskPrompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ProfileResult {
  name: string;
  age_group: string;
  temperament: string;
  speech_style: string;
  description: string;
  speech_tags?: string[];
  psycho_tags?: string[];
}

// ── Helpers ──────────────────────────────────────────────

function extractBalancedJson(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length && i < start + 50000; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/** Rough token estimate: ~4 chars per token (conservative for multilingual) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** Context window limits by model family (input tokens) */
function getModelContextLimit(model: string): number {
  if (/gemini-2\.5-pro/.test(model)) return 1_000_000;
  if (/gemini-2\.5-flash/.test(model)) return 1_000_000;
  if (/gemini-3/.test(model)) return 1_000_000;
  if (/gpt-5/.test(model)) return 128_000;
  if (/gpt-4o-mini/.test(model)) return 128_000;
  if (/gpt-4o/.test(model)) return 128_000;
  if (/gpt-4-turbo/.test(model)) return 128_000;
  if (/claude-3/.test(model)) return 200_000;
  if (/deepseek/.test(model)) return 64_000;
  return 32_000; // conservative default
}

/** Max output tokens by model — keep proportional to avoid token waste */
function getMaxOutputTokens(model: string): number {
  const LOW_TOKEN_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "claude-3-haiku", "claude-3-sonnet"];
  if (LOW_TOKEN_MODELS.some(m => model.includes(m))) return 16_384;
  return 16_384; // was 65_536 — profiling rarely needs more than 16K output
}

function parseProfilesFromContent(content: string): ProfileResult[] | undefined {
  const raw = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  // Direct parse
  try {
    const p = JSON.parse(raw);
    const arr = p.characters || (Array.isArray(p) ? p : undefined);
    if (arr?.length) return arr;
  } catch { /* continue */ }

  // Extract balanced JSON
  const firstBrace = raw.indexOf("{");
  if (firstBrace >= 0) {
    const extracted = extractBalancedJson(raw, firstBrace);
    if (extracted) {
      try {
        const p = JSON.parse(extracted);
        return p.characters || (Array.isArray(p) ? p : undefined);
      } catch { /* continue */ }
    }
  }

  // Try array
  const firstBracket = raw.indexOf("[");
  if (firstBracket >= 0) {
    const extracted = extractBalancedJson(raw, firstBracket);
    if (extracted) {
      try { return JSON.parse(extracted); } catch { /* continue */ }
    }
  }

  return undefined;
}

// ── Character block builder ──────────────────────────────

interface CharBlock {
  name: string;
  block: string;
  tokenEstimate: number;
}

function buildCharBlock(
  c: { name: string; aliases: string[] },
  charExcerpts: Map<string, string[]>,
  existingProfiles?: Record<string, string>,
): CharBlock {
  let block = `### ${c.name}`;
  if (c.aliases?.length) block += ` (aliases: ${c.aliases.join(", ")})`;
  block += "\n";
  const existingDesc = existingProfiles?.[c.name];
  if (existingDesc) {
    block += `Current profile: ${existingDesc}\nUpdate only if new text reveals significant new traits.\n`;
  }
  const excerpts = charExcerpts.get(c.name);
  if (excerpts?.length) {
    block += "Text excerpts:\n" + excerpts.map((e, i) => `  ${i + 1}. ${e}`).join("\n") + "\n";
  } else {
    block += "No direct text excerpts found.\n";
  }
  return { name: c.name, block, tokenEstimate: estimateTokens(block) };
}

// ── AI call with retry logic ──────────────────────────────

interface AiCallOpts {
  endpoint: string;
  apiKeyValue: string;
  usedModel: string;
  systemPrompt: string;
  jsonSuffix: string;
  charBlocksText: string;
  maxTokens: number;
}

async function callAiWithRetry(opts: AiCallOpts): Promise<{ profiles: ProfileResult[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  const { endpoint, apiKeyValue, usedModel, systemPrompt, jsonSuffix, charBlocksText, maxTokens } = opts;

  const buildBody = (tokenLimit?: number) => JSON.stringify({
    model: usedModel,
    messages: [
      { role: "system", content: systemPrompt + jsonSuffix },
      { role: "user", content: `## Characters to profile:\n\n${charBlocksText}\n\nRespond with ONLY the JSON object.` },
    ],
    ...modelParams(usedModel, { maxTokens: tokenLimit || maxTokens, temperature: 0.3 }),
  });

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKeyValue}` };

  let aiRes = await fetch(endpoint, { method: "POST", headers, body: buildBody() });

  // Retry on 400
  if (aiRes.status === 400) {
    const errBody = await aiRes.text();
    console.warn(`[profile-characters-local] 400, retrying. Model: ${usedModel}, err: ${errBody.slice(0, 300)}`);

    if (/max_tokens|max_completion_tokens/i.test(errBody)) {
      // Reduce to 8192
      aiRes = await fetch(endpoint, { method: "POST", headers, body: buildBody(8192) });
    } else {
      aiRes = await fetch(endpoint, { method: "POST", headers, body: buildBody() });
    }
  }

  if (aiRes.status === 429) throw Object.assign(new Error("rate_limited"), { status: 429 });
  if (aiRes.status === 402) throw Object.assign(new Error("payment_required"), { status: 402 });
  if (!aiRes.ok) {
    const errText = await aiRes.text().catch(() => "");
    throw new Error(`AI error: ${aiRes.status} ${errText.slice(0, 200)}`);
  }

  const aiData = await aiRes.json();
  const content = String(aiData.choices?.[0]?.message?.content || "");
  const profiles = parseProfilesFromContent(content) || [];
  return { profiles, usage: aiData.usage };
}

// ── Main handler ──────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { characters, scenes, lang, model, apiKey, existingProfiles } = await req.json() as {
      characters: Array<{ name: string; aliases: string[] }>;
      scenes: Array<{ title: string; text: string }>;
      lang: "ru" | "en";
      model?: string;
      apiKey?: string | null;
      existingProfiles?: Record<string, string>;
    };

    if (!characters?.length || !scenes?.length) {
      return new Response(JSON.stringify({ error: "characters and scenes are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Auth ──
    const authHeader = req.headers.get("authorization") || "";
    let userId: string | undefined;
    if (authHeader.startsWith("Bearer ")) {
      try {
        const { createClient } = await import("npm:@supabase/supabase-js@2");
        const token = authHeader.replace("Bearer ", "");
        const tempClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data } = await tempClient.auth.getUser(token);
        userId = data?.user?.id;
      } catch { /* ignore */ }
    }

    // ── Build per-character text excerpts ──
    const charExcerpts = new Map<string, string[]>();
    for (const scene of scenes) {
      const text = scene.text || "";
      for (const c of characters) {
        const names = [c.name, ...c.aliases];
        const mentioned = names.some(n => text.toLowerCase().includes(n.toLowerCase()));
        if (mentioned) {
          const existing = charExcerpts.get(c.name) || [];
          if (existing.length < 5) {
            existing.push(text.slice(0, 800));
          }
          charExcerpts.set(c.name, existing);
        }
      }
    }

    // ── Build character blocks with token estimates ──
    const charBlocks: CharBlock[] = characters.map(c =>
      buildCharBlock(c, charExcerpts, existingProfiles)
    );

    // ── Resolve model + prompts ──
    const requestedModel = model || "google/gemini-2.5-flash";
    const resolved = resolveAiEndpoint(requestedModel, apiKey || null);
    if (!resolved.apiKey) throw new Error("AI key not configured");
    const usedModel = resolved.model;

    const systemPrompt = (await resolveTaskPromptWithOverrides("profiler:profile_characters", lang))
      || "You are a literary analyst. Analyze characters based on text.";

    const jsonSuffix = `\n\nRespond with ONLY a valid JSON: {"characters": [{"name": "...", "age_group": "...", "temperament": "...", "speech_style": "...", "description": "...", "speech_tags": ["#tag1", "#tag2"], "psycho_tags": ["#tag1", "#tag2"]}]}\n\nspeech_tags: 2-4 hashtags describing speech MANNER for TTS voice synthesis (tempo, intonation, articulation). Examples: #отрывисто #быстро #нервно #хрипло #тихо #громко #монотонно #певуче #резко.\npsycho_tags: 2-4 hashtags describing character PSYCHOTYPE for voice auto-casting. Examples: #паникер #эгоцентрист #невротик #меланхолик #лидер #интроверт #манипулятор #оптимист.\nTags MUST start with # and be in the same language as the text.`;

    const maxOutputTokens = getMaxOutputTokens(usedModel);

    // ── Context-aware chunking ──
    const contextLimit = getModelContextLimit(usedModel);
    const systemTokens = estimateTokens(systemPrompt + jsonSuffix);
    // Reserve space for: system prompt + output + safety margin (10%)
    const availableInputTokens = Math.floor((contextLimit - maxOutputTokens) * 0.9) - systemTokens;

    // Split characters into chunks that fit within context
    const chunks: CharBlock[][] = [];
    let currentChunk: CharBlock[] = [];
    let currentTokens = 0;

    for (const cb of charBlocks) {
      // If a single character exceeds budget, it goes alone (truncation is last resort)
      if (currentTokens + cb.tokenEstimate > availableInputTokens && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentTokens = 0;
      }
      currentChunk.push(cb);
      currentTokens += cb.tokenEstimate;
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);

    console.log(`[profile-characters-local] ${characters.length} chars, ${chunks.length} chunk(s), model: ${usedModel}, ctx: ${contextLimit}`);

    // ── Execute AI calls (sequential for single chunk, parallel for multiple) ──
    const aiStart = Date.now();
    let allProfiles: ProfileResult[] = [];
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    const callOpts = {
      endpoint: resolved.endpoint,
      apiKeyValue: resolved.apiKey,
      usedModel,
      systemPrompt,
      jsonSuffix,
      maxTokens: maxOutputTokens,
    };

    if (chunks.length === 1) {
      // Single chunk — no splitting needed (most common case)
      const result = await callAiWithRetry({
        ...callOpts,
        charBlocksText: chunks[0].map(cb => cb.block).join("\n"),
      });
      allProfiles = result.profiles;
      totalTokensIn = result.usage?.prompt_tokens || 0;
      totalTokensOut = result.usage?.completion_tokens || 0;
    } else {
      // Multiple chunks — parallel calls + merge
      const results = await Promise.allSettled(
        chunks.map(chunk =>
          callAiWithRetry({
            ...callOpts,
            charBlocksText: chunk.map(cb => cb.block).join("\n"),
          })
        )
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          allProfiles.push(...r.value.profiles);
          totalTokensIn += r.value.usage?.prompt_tokens || 0;
          totalTokensOut += r.value.usage?.completion_tokens || 0;
        } else {
          // If any chunk fails with rate limit / payment, propagate immediately
          const err = r.reason;
          if (err?.status === 429 || err?.status === 402) {
            return new Response(JSON.stringify({ error: err.message }), {
              status: err.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          console.error("[profile-characters-local] chunk failed:", err);
        }
      }
    }

    // ── Deduplicate: last wins (in case of overlap between chunks) ──
    const deduped = new Map<string, ProfileResult>();
    for (const p of allProfiles) {
      if (p.name) deduped.set(p.name.toLowerCase(), p);
    }
    const finalProfiles = Array.from(deduped.values());

    // ── Log usage ──
    if (userId) {
      logAiUsage({
        userId, modelId: usedModel, requestType: "profile-characters-local",
        status: finalProfiles.length ? "success" : "error",
        latencyMs: Date.now() - aiStart,
        tokensInput: totalTokensIn || undefined,
        tokensOutput: totalTokensOut || undefined,
        errorMessage: finalProfiles.length ? undefined
          : `Empty parse (${chunks.length} chunks, ${allProfiles.length} raw)`,
      });
    }

    return new Response(JSON.stringify({
      profiles: finalProfiles,
      usedModel,
      chunks: chunks.length, // inform client about chunking
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("profile-characters-local error:", err);
    const status = err?.status || 500;
    return new Response(JSON.stringify({ error: String(err) }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
