/**
 * profile-characters-local: Local-first character profiling.
 * Accepts character names + scene texts, returns psychological profiles.
 * No DB reads — all data comes from client (OPFS).
 */
import { logAiUsage } from "../_shared/logAiUsage.ts";
import { resolveAiEndpoint } from "../_shared/providerRouting.ts";

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

    const systemPrompt = lang === "ru"
      ? `Ты — литературный аналитик. Проанализируй персонажей на основе текста.\n\nДля каждого определи:\n- age_group: child / teen / young / adult / elder / unknown\n- temperament: sanguine / choleric / melancholic / phlegmatic / mixed\n- speech_style: описание стиля речи (2-3 предложения)\n- description: психологический портрет (3-5 предложений)\n\nОтвечай на русском в полях description и speech_style.`
      : `You are a literary analyst. Analyze characters based on text.\n\nFor each determine:\n- age_group: child / teen / young / adult / elder / unknown\n- temperament: sanguine / choleric / melancholic / phlegmatic / mixed\n- speech_style: speech patterns description (2-3 sentences)\n- description: psychological portrait (3-5 sentences)`;

    const jsonSuffix = `\n\nRespond with ONLY a valid JSON: {"characters": [{"name": "...", "age_group": "...", "temperament": "...", "speech_style": "...", "description": "..."}]}`;

    const usedModel = model || "google/gemini-2.5-flash";
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("AI key not configured");

    const aiStart = Date.now();
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: usedModel,
        messages: [
          { role: "system", content: systemPrompt + jsonSuffix },
          { role: "user", content: `## Characters to profile:\n\n${charBlocks}\n\nRespond with ONLY the JSON object.` },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (aiRes.status === 429) throw new Error("rate_limited");
    if (aiRes.status === 402) throw new Error("payment_required");
    if (!aiRes.ok) throw new Error(`AI error: ${aiRes.status}`);

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

    return new Response(JSON.stringify({ profiles: profiles || [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("profile-characters-local error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
