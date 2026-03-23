/**
 * profile-characters-local: Local-first character profiling.
 * Accepts character names + scene texts, returns psychological profiles.
 * No DB reads — all data comes from client (OPFS).
 */
import { logAiUsage } from "../_shared/logAiUsage.ts";
import { resolveAiEndpoint } from "../_shared/providerRouting.ts";
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

    // Extract user ID for logging
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
      } catch {}
    }

    // Build character context from scenes
    const charNamesLower = new Set(characters.map(c => c.name.toLowerCase()));
    const aliasToName = new Map<string, string>();
    for (const c of characters) {
      for (const a of c.aliases) aliasToName.set(a.toLowerCase(), c.name);
    }

    // Build per-character text excerpts (search for character mentions in scenes)
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

    const charBlocks = characters.map(c => {
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
      return block;
    }).join("\n");

    const systemPrompt = (await resolveTaskPromptWithOverrides("profiler:profile_characters", lang))
      || "You are a literary analyst. Analyze characters based on text.";

    const jsonSuffix = `\n\nRespond with ONLY a valid JSON: {"characters": [{"name": "...", "age_group": "...", "temperament": "...", "speech_style": "...", "description": "...", "speech_tags": ["#tag1", "#tag2"], "psycho_tags": ["#tag1", "#tag2"]}]}\n\nspeech_tags: 2-4 hashtags describing speech MANNER for TTS voice synthesis (tempo, intonation, articulation). Examples: #отрывисто #быстро #нервно #хрипло #тихо #громко #монотонно #певуче #резко.\npsycho_tags: 2-4 hashtags describing character PSYCHOTYPE for voice auto-casting. Examples: #паникер #эгоцентрист #невротик #меланхолик #лидер #интроверт #манипулятор #оптимист.\nTags MUST start with # and be in the same language as the text.`;

    const requestedModel = model || "google/gemini-2.5-flash";
    const resolved = resolveAiEndpoint(requestedModel, apiKey || null);
    if (!resolved.apiKey) throw new Error("AI key not configured");
    const usedModel = resolved.model;

    // Models that don't support temperature
    const MODELS_NO_TEMPERATURE = ["o1", "o3", "o4-mini", "deepseek-r1"];
    const skipTemp = MODELS_NO_TEMPERATURE.some(m => usedModel.includes(m));

    // Models that require max_completion_tokens instead of max_tokens
    const useMaxCompletionTokens = /gpt-5|o1|o3|o4/.test(usedModel);

    // Cap max tokens based on model capability
    const LOW_TOKEN_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "claude-3-haiku", "claude-3-sonnet"];
    const isLowTokenModel = LOW_TOKEN_MODELS.some(m => usedModel.includes(m));
    const maxTokens = isLowTokenModel ? 16384 : 65536;

    const buildBody = (includeTemp: boolean) => JSON.stringify({
      model: usedModel,
      messages: [
        { role: "system", content: systemPrompt + jsonSuffix },
        { role: "user", content: `## Characters to profile:\n\n${charBlocks}\n\nRespond with ONLY the JSON object.` },
      ],
      ...(includeTemp && !skipTemp ? { temperature: 0.3 } : {}),
      ...(useMaxCompletionTokens ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    });

    const aiStart = Date.now();
    let aiRes = await fetch(resolved.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resolved.apiKey}` },
      body: buildBody(true),
    });

    // Retry on 400: first without temperature, then with reduced max_tokens
    if (aiRes.status === 400) {
      const errBody = await aiRes.text();
      console.warn(`[profile-characters-local] 400, retrying. Model: ${usedModel}, body: ${errBody.slice(0, 300)}`);

      // If error mentions max_tokens, reduce it
      const isTokenError = /max_tokens|max_completion_tokens/i.test(errBody);
      if (isTokenError) {
        const reducedBody = JSON.stringify({
          model: usedModel,
          messages: JSON.parse(buildBody(false)).messages,
          ...(useMaxCompletionTokens ? { max_completion_tokens: 8192 } : { max_tokens: 8192 }),
        });
        aiRes = await fetch(resolved.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resolved.apiKey}` },
          body: reducedBody,
        });
      } else if (!skipTemp) {
        aiRes = await fetch(resolved.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resolved.apiKey}` },
          body: buildBody(false),
        });
      }
    }

    if (aiRes.status === 429) {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (aiRes.status === 402) {
      return new Response(JSON.stringify({ error: "payment_required" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => "");
      throw new Error(`AI error: ${aiRes.status} ${errText.slice(0, 200)}`);
    }

    const aiData = await aiRes.json();
    const usage = aiData.usage;
    const content = String(aiData.choices?.[0]?.message?.content || "");

    let profiles: ProfileResult[] | undefined;

    // Parse JSON from response
    const raw = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    try {
      const p = JSON.parse(raw);
      profiles = p.characters || (Array.isArray(p) ? p : undefined);
    } catch {}

    if (!profiles) {
      const firstBrace = raw.indexOf("{");
      if (firstBrace >= 0) {
        const extracted = extractBalancedJson(raw, firstBrace);
        if (extracted) {
          try {
            const p = JSON.parse(extracted);
            profiles = p.characters || (Array.isArray(p) ? p : undefined);
          } catch {}
        }
      }
    }

    if (userId) {
      logAiUsage({
        userId, modelId: usedModel, requestType: "profile-characters-local",
        status: profiles?.length ? "success" : "error",
        latencyMs: Date.now() - aiStart,
        tokensInput: usage?.prompt_tokens, tokensOutput: usage?.completion_tokens,
        errorMessage: profiles?.length ? undefined : "Empty parse",
      });
    }

    return new Response(JSON.stringify({ profiles: profiles || [], usedModel }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("profile-characters-local error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
