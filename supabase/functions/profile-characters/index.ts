import { createClient } from "npm:@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/logAiUsage.ts";
import { resolveAiEndpoint, extractProviderFields } from "../_shared/providerRouting.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CharacterProfile {
  name: string;
  aliases: string[];
  gender: "male" | "female" | "unknown";
  age_group: "child" | "teen" | "young" | "adult" | "elder" | "unknown";
  temperament: string;
  speech_style: string;
  description: string;
  speech_tags?: string[];
  psycho_tags?: string[];
}

// ── Helpers ──────────────────────────────────────────────

function buildPrompt(
  characters: Array<{ name: string; aliases: string[] }>,
  speakerDialogues: Map<string, string[]>,
  narratorExcerpts: string[],
  lang: "ru" | "en",
  existingProfiles?: Map<string, string>, // name → existing description
) {
  const characterList = characters.map(c => {
    const dialogues = speakerDialogues.get(c.name);
    let block = `### ${c.name}`;
    if (c.aliases?.length) block += ` (aliases: ${c.aliases.join(", ")})`;
    block += "\n";
    const existing = existingProfiles?.get(c.name);
    if (existing) {
      block += `Current profile: ${existing}\n`;
      block += "IMPORTANT: Update this profile only if the new dialogue samples reveal significant new character traits, emotional depth, or behavioral patterns not captured above. If nothing substantially new, return the same profile.\n";
    }
    if (dialogues?.length) {
      block += "Dialogue samples:\n" + dialogues.map((d, i) => `  ${i + 1}. "${d}"`).join("\n") + "\n";
    } else {
      block += "No direct dialogue found.\n";
    }
    return block;
  }).join("\n");

  const narratorContext = narratorExcerpts.length > 0
    ? "\n\n## Narrator excerpts (for additional context):\n" + narratorExcerpts.map((n, i) => `${i + 1}. ${n}`).join("\n")
    : "";

  const systemPrompt = lang === "ru"
    ? `Ты — литературный аналитик. Проанализируй персонажей книги на основе их реплик и контекста повествования.\n\nДля каждого персонажа определи:\n- aliases: все варианты имени (сокращения, прозвища, обращения)\n- gender: male / female / unknown\n- age_group: child / teen / young / adult / elder / unknown\n- temperament: один из: sanguine (сангвиник), choleric (холерик), melancholic (меланхолик), phlegmatic (флегматик), или смешанный\n- speech_style: краткое описание стиля речи (2-3 предложения)\n- description: психологический портрет персонажа (3-5 предложений)\n- speech_tags: 2-4 хэштега, описывающих МАНЕРУ РЕЧИ для голосового синтеза (темп, интонация, артикуляция). Примеры: #отрывисто #быстро #нервно #хрипло #тихо #громко #монотонно #певуче #резко #бархатисто #визгливо\n- psycho_tags: 2-4 хэштега, описывающих ПСИХОТИП персонажа для автоподбора голоса. Примеры: #паникер #эгоцентрист #невротик #меланхолик #лидер #интроверт #манипулятор #оптимист #педант #мечтатель\nТеги ОБЯЗАТЕЛЬНО начинаются с # и пишутся на русском.\n\nОтвечай на русском языке в полях description и speech_style.`
    : `You are a literary analyst. Analyze book characters based on their dialogue and narrative context.\n\nFor each character determine:\n- aliases: all name variations (nicknames, shortened forms, titles)\n- gender: male / female / unknown\n- age_group: child / teen / young / adult / elder / unknown\n- temperament: one of: sanguine, choleric, melancholic, phlegmatic, or mixed\n- speech_style: brief description of speech patterns (2-3 sentences)\n- description: psychological portrait (3-5 sentences)\n- speech_tags: 2-4 hashtags describing SPEECH MANNER for voice synthesis (tempo, intonation, articulation). Examples: #clipped #fast #nervous #raspy #quiet #loud #monotone #melodic #sharp #velvety\n- psycho_tags: 2-4 hashtags describing character PSYCHOTYPE for voice auto-casting. Examples: #panicker #egocentric #neurotic #melancholic #leader #introvert #manipulator #optimist #pedant #dreamer\nTags MUST start with # and be in the same language as the text.`;

  return { systemPrompt, userPrompt: `## Characters to profile:\n\n${characterList}${narratorContext}` };
}

/** Extract balanced JSON starting from a given index (handles nested braces/brackets) */
function extractBalancedJson(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
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

async function callAI(systemPrompt: string, userPrompt: string, lang: "ru" | "en", modelOverride?: string, userId?: string, providerApiKey?: string | null, openrouterApiKey?: string | null): Promise<CharacterProfile[]> {
  const resolved = resolveAiEndpoint(modelOverride || "google/gemini-3-flash-preview", providerApiKey || null, openrouterApiKey);
  if (!resolved.apiKey) throw new Error("AI key not configured");

  const usedModel = modelOverride || "google/gemini-3-flash-preview";
  // Reasoning models return data in reasoning/reasoning_details, not tool_calls
  const isReasoningModel = usedModel.includes("gpt-5") || usedModel.includes("o3") || usedModel.includes("o4") || usedModel.includes("gemini-2.5-pro");
  const aiStart = Date.now();

  // Models that require max_completion_tokens instead of max_tokens
  const useMaxCompletionTokens = /gpt-5|o1|o3|o4/.test(usedModel);

  // Build two variants: with tools (preferred) and without (fallback for reasoning models)
  const toolsPayload = {
    model: usedModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    ...(useMaxCompletionTokens ? { max_completion_tokens: 4096 } : { max_tokens: 4096 }),
    tools: [{
      type: "function",
      function: {
        name: "save_character_profiles",
        description: "Save profiled character data",
        parameters: {
          type: "object",
          properties: {
            characters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Primary character name (must match input)" },
                  aliases: { type: "array", items: { type: "string" } },
                  gender: { type: "string", enum: ["male", "female", "unknown"] },
                  age_group: { type: "string", enum: ["child", "teen", "young", "adult", "elder", "unknown"] },
                  temperament: { type: "string" },
                  speech_style: { type: "string" },
                  description: { type: "string" },
                  speech_tags: { type: "array", items: { type: "string" }, description: "2-4 hashtags describing speech manner for TTS" },
                  psycho_tags: { type: "array", items: { type: "string" }, description: "2-4 hashtags describing character psychotype" },
                },
                required: ["name", "aliases", "gender", "age_group", "temperament", "speech_style", "description", "speech_tags", "psycho_tags"],
              },
            },
          },
          required: ["characters"],
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "save_character_profiles" } },
  };

  const jsonPromptSuffix = `\n\nCRITICAL INSTRUCTION: You MUST respond with ONLY a valid JSON object. No explanations, no markdown fences, no text before or after. The response must start with { and end with }.\nRequired format:\n{"characters": [{"name": "...", "aliases": ["..."], "gender": "male|female|unknown", "age_group": "child|teen|young|adult|elder|unknown", "temperament": "...", "speech_style": "...", "description": "...", "speech_tags": ["#tag1", "#tag2"], "psycho_tags": ["#tag1", "#tag2"]}]}\n\nspeech_tags: 2-4 hashtags describing speech MANNER for TTS voice synthesis.\npsycho_tags: 2-4 hashtags describing character PSYCHOTYPE for voice auto-casting.\nTags MUST start with # and be in the same language as the text.`;
  const plainPayload: Record<string, unknown> = {
    model: usedModel,
    messages: [
      { role: "system", content: systemPrompt + jsonPromptSuffix },
      { role: "user", content: userPrompt + "\n\nRespond with ONLY the JSON object, nothing else." },
    ],
    temperature: 0.3,
    ...(useMaxCompletionTokens ? { max_completion_tokens: 8192 } : { max_tokens: 8192 }),
  };
  // For OpenAI non-reasoning models, request structured JSON output
  // (Gemini models don't reliably support response_format through the gateway)
  if (!isReasoningModel && usedModel.includes("openai/")) {
    (plainPayload as Record<string, unknown>).response_format = { type: "json_object" };
  }

  // For reasoning models, skip tools entirely (they don't support tool_choice)
  let useToolsMode = !isReasoningModel;

  const MAX_RETRIES = 3;
  let profiles: CharacterProfile[] | undefined;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);

      const currentPayload = useToolsMode ? toolsPayload : plainPayload;
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
        body: JSON.stringify(currentPayload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      console.log(`AI attempt ${attempt}/${MAX_RETRIES}, status=${aiRes.status}`);

      if (aiRes.status === 429) {
        lastError = lang === "ru" ? "Превышен лимит запросов" : "Rate limit exceeded";
        if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 2000 * attempt)); continue; }
        throw new Error(lastError);
      }
      if (aiRes.status === 402) throw new Error(lang === "ru" ? "Необходимо пополнить баланс" : "Payment required");
      if (!aiRes.ok) {
        lastError = `AI error: ${aiRes.status}`;
        if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 1500 * attempt)); continue; }
        throw new Error(lastError);
      }

      const aiData = await aiRes.json();
      const usage = aiData.usage;
      const msg = aiData.choices?.[0]?.message;
      const toolCall = msg?.tool_calls?.[0];

      // 1) Tool call arguments
      if (toolCall?.function?.arguments) {
        try {
          const parsed = JSON.parse(toolCall.function.arguments);
          profiles = parsed.characters || (Array.isArray(parsed) ? parsed : undefined);
        } catch (e) {
          console.log("Tool call parse failed:", e);
        }
      }

      // 2) Content or reasoning field (may contain JSON)
      if (!profiles) {
        const content = String(msg?.content || "");
        const reasoning = String((msg as Record<string, unknown>)?.reasoning || "");
        // Also check reasoning_details array (some models nest text there)
        const reasoningDetails = (msg as Record<string, unknown>)?.reasoning_details;
        let reasoningText = reasoning;
        if (Array.isArray(reasoningDetails)) {
          for (const rd of reasoningDetails) {
            if (rd && typeof rd === "object") {
              const rdObj = rd as Record<string, unknown>;
              const rdText = String(rdObj.content || rdObj.text || "");
              if (rdText) reasoningText += "\n" + rdText;
            }
          }
        }

        for (const source of [content, reasoningText]) {
          if (profiles) break;
          if (!source?.trim()) continue;

          // Extract all ```json blocks first
          const codeBlocks = [...source.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)].map(m => m[1].trim());
          // Also try the raw source stripped of fences
          const raw = source.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const candidates = [...codeBlocks, raw];

          for (const candidate of candidates) {
            if (profiles) break;
            if (!candidate) continue;

            // Direct parse
            try {
              const p = JSON.parse(candidate);
              profiles = p.characters || (Array.isArray(p) ? p : undefined);
              if (profiles) break;
            } catch {}

            // Find JSON objects with "name" key (character profiles)
            // Use non-greedy matching to find individual JSON blocks
            const allJsonBlocks: string[] = [];

            // Match { "characters": [...] }
            const charObjMatches = candidate.matchAll(/\{\s*"characters"\s*:\s*\[/g);
            for (const m of charObjMatches) {
              const start = m.index!;
              const extracted = extractBalancedJson(candidate, start);
              if (extracted) allJsonBlocks.push(extracted);
            }

            // Match standalone arrays starting with [{ "name"
            const arrMatches = candidate.matchAll(/\[\s*\{\s*"name"/g);
            for (const m of arrMatches) {
              const start = m.index!;
              const extracted = extractBalancedJson(candidate, start);
              if (extracted) allJsonBlocks.push(extracted);
            }

            for (const block of allJsonBlocks) {
              try {
                const p = JSON.parse(block);
                const arr = p.characters || (Array.isArray(p) ? p : undefined);
                if (arr?.length && arr[0]?.name) { profiles = arr; break; }
              } catch {}
            }
          }
        }
      }

      if (profiles && profiles.length > 0) {
        // Log successful AI call
        if (userId) {
          logAiUsage({ userId, modelId: usedModel, requestType: "profile-characters", status: "success", latencyMs: Date.now() - aiStart, tokensInput: usage?.prompt_tokens, tokensOutput: usage?.completion_tokens });
        }
        break;
      }

      // Log raw response for debugging
      const reasoningLen = String((msg as Record<string, unknown>)?.reasoning || "").length;
      const contentPreview = String(msg?.content || "").slice(0, 300);
      console.log(`Attempt ${attempt} unparseable (tools=${useToolsMode}). Keys: ${JSON.stringify(Object.keys(msg || {}))}. Tool calls: ${toolCall?.function?.name}. Content len: ${(msg?.content || "").length}. Reasoning len: ${reasoningLen}`);
      console.log(`Content preview: ${contentPreview}`);
      lastError = "AI returned unparseable response";

      // Try one more aggressive extraction: find anything between { and } that contains "name"
      if (!profiles) {
        const fullText = [String(msg?.content || ""), String((msg as Record<string, unknown>)?.reasoning || "")].join("\n");
        // Try to find any JSON-like structure with "name" key
        const jsonMatch = fullText.match(/\{[\s\S]*?"name"\s*:\s*"[\s\S]*?\}/);
        if (jsonMatch) {
          // Find the outermost balanced JSON from first {
          const firstBrace = fullText.indexOf("{");
          if (firstBrace >= 0) {
            const extracted = extractBalancedJson(fullText, firstBrace);
            if (extracted) {
              try {
                const p = JSON.parse(extracted);
                profiles = p.characters || (Array.isArray(p) ? p : undefined);
                if (profiles?.length) {
                  console.log(`Aggressive extraction succeeded: ${profiles.length} profiles`);
                  if (userId) {
                    logAiUsage({ userId, modelId: usedModel, requestType: "profile-characters", status: "success", latencyMs: Date.now() - aiStart, tokensInput: usage?.prompt_tokens, tokensOutput: usage?.completion_tokens });
                  }
                  break;
                }
              } catch {}
            }
          }
        }
      }

      // If tools mode failed, switch to plain JSON mode for next attempt
      if (useToolsMode) {
        useToolsMode = false;
        console.log("Switching to plain JSON mode for next attempt");
      }
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 1500 * attempt));
    } catch (fetchErr) {
      lastError = String(fetchErr);
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 2000 * attempt));
      else throw new Error(lastError);
    }
  }

  if (!profiles || profiles.length === 0) {
    if (userId) {
      logAiUsage({ userId, modelId: usedModel, requestType: "profile-characters", status: "error", latencyMs: Date.now() - aiStart, errorMessage: lastError || "Empty response" });
    }
    throw new Error(lastError || "AI returned empty response");
  }
  return profiles;
}

// ── Main Handler ─────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { book_id, language, scene_ids, model: clientModel } = await req.json();
    if (!book_id) {
      return new Response(JSON.stringify({ error: "book_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lang: "ru" | "en" = language === "ru" ? "ru" : "en";
    // Extract user ID for logging
    const token = authHeader.replace("Bearer ", "");
    const tempClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: authData } = await tempClient.auth.getUser(token);
    const userId = authData?.user?.id;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify ownership
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: bookCheck, error: bookErr } = await userClient
      .from("books").select("id").eq("id", book_id).maybeSingle();
    if (bookErr || !bookCheck) {
      return new Response(JSON.stringify({ error: "Book not found or access denied" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load all characters
    const { data: allCharacters } = await supabase
      .from("book_characters")
      .select("id, name, aliases, description, gender, age_group")
      .eq("book_id", book_id);

    if (!allCharacters || allCharacters.length === 0) {
      return new Response(JSON.stringify({ error: lang === "ru" ? "Нет персонажей для профайлинга" : "No characters to profile" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Determine which characters to profile ────────────
    const incremental = Array.isArray(scene_ids) && scene_ids.length > 0;
    let charsToProfile: typeof allCharacters;
    let existingProfiles: Map<string, string> | undefined;

    if (incremental) {
      // Find characters appearing in the given scenes
      const { data: appearances } = await supabase
        .from("character_appearances")
        .select("character_id")
        .in("scene_id", scene_ids);
      const appearedIds = new Set(appearances?.map(a => a.character_id) || []);

      // Also include any character with no description (new, never profiled)
      charsToProfile = allCharacters.filter(c => !c.description || appearedIds.has(c.id));

      if (charsToProfile.length === 0) {
        return new Response(JSON.stringify({
          profiled: 0, total: allCharacters.length, skipped: allCharacters.length,
          message: lang === "ru" ? "Все персонажи уже профилированы, новых появлений нет" : "All characters already profiled, no new appearances",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Provide existing descriptions so AI can decide whether to update
      existingProfiles = new Map();
      for (const c of charsToProfile) {
        if (c.description) existingProfiles.set(c.name, c.description);
      }

      console.log(`Incremental mode: ${charsToProfile.length} chars to profile (${existingProfiles.size} existing), ${allCharacters.length - charsToProfile.length} skipped`);
    } else {
      charsToProfile = allCharacters;
    }

    // ── Load dialogue context ────────────────────────────
    const { data: chapters } = await supabase
      .from("book_chapters").select("id").eq("book_id", book_id);
    if (!chapters?.length) {
      return new Response(JSON.stringify({ error: "No chapters found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const chapterIds = chapters.map(c => c.id);
    const { data: scenes } = await supabase
      .from("book_scenes").select("id").in("chapter_id", chapterIds);
    if (!scenes?.length) {
      return new Response(JSON.stringify({ error: "No scenes found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // In incremental mode, only load segments from the new scenes for context
    const contextSceneIds = incremental ? scene_ids : scenes.map(s => s.id);
    const { data: segments } = await supabase
      .from("scene_segments")
      .select("id, segment_type, speaker, scene_id")
      .in("scene_id", contextSceneIds)
      .in("segment_type", ["dialogue", "monologue", "first_person", "inner_thought", "narrator"])
      .order("segment_number");

    if (!segments?.length) {
      return new Response(JSON.stringify({ error: lang === "ru" ? "Нет сегментов для анализа" : "No segments to analyze" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load phrases
    const segmentIds = segments.map(s => s.id);
    const allPhrases: Array<{ segment_id: string; text: string; phrase_number: number }> = [];
    for (let i = 0; i < segmentIds.length; i += 200) {
      const batch = segmentIds.slice(i, i + 200);
      const { data: phrases } = await supabase
        .from("segment_phrases")
        .select("segment_id, text, phrase_number")
        .in("segment_id", batch)
        .order("phrase_number");
      if (phrases) allPhrases.push(...phrases);
    }

    // Build per-character dialogue map
    const charNames = new Set(charsToProfile.map(c => c.name));
    const speakerDialogues = new Map<string, string[]>();
    const narratorExcerpts: string[] = [];

    for (const seg of segments) {
      const phrases = allPhrases
        .filter(p => p.segment_id === seg.id)
        .sort((a, b) => a.phrase_number - b.phrase_number)
        .map(p => p.text)
        .join(" ");
      if (!phrases) continue;

      if (seg.speaker && charNames.has(seg.speaker)) {
        const existing = speakerDialogues.get(seg.speaker) || [];
        if (existing.length < 10) existing.push(phrases.slice(0, 500));
        speakerDialogues.set(seg.speaker, existing);
      } else if (seg.segment_type === "narrator" || seg.segment_type === "inner_thought") {
        if (narratorExcerpts.length < 20) narratorExcerpts.push(phrases.slice(0, 300));
      }
    }

    // ── Call AI ───────────────────────────────────────────
    const { systemPrompt, userPrompt } = buildPrompt(
      charsToProfile, speakerDialogues, narratorExcerpts, lang, existingProfiles,
    );
    const profiles = await callAI(systemPrompt, userPrompt, lang, clientModel, userId);

    // ── Update DB ────────────────────────────────────────
    let updated = 0;
    for (const profile of profiles) {
      const char = charsToProfile.find(c => c.name === profile.name);
      if (!char) continue;

      const { error } = await supabase
        .from("book_characters")
        .update({
          aliases: profile.aliases?.length ? profile.aliases : char.aliases,
          gender: profile.gender || "unknown",
          age_group: profile.age_group || "unknown",
          temperament: profile.temperament || null,
          speech_style: profile.speech_style || null,
          description: profile.description || null,
          speech_tags: profile.speech_tags || [],
          psycho_tags: profile.psycho_tags || [],
          updated_at: new Date().toISOString(),
        })
        .eq("id", char.id);

      if (!error) updated++;
      else console.error("Failed to update character:", char.name, error);
    }

    const skipped = allCharacters.length - charsToProfile.length;
    return new Response(JSON.stringify({
      profiled: updated,
      total: allCharacters.length,
      skipped,
      profiles,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("profile-characters error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
