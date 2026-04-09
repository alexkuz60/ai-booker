import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveAiEndpoint } from "../_shared/providerRouting.ts";
import { modelParams } from "../_shared/modelParams.ts";
import { resolveTaskPromptWithOverrides } from "../_shared/taskPrompts.ts";
import { getUserIdFromAuth } from "../_shared/logAiUsage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Russian vowels ──────────────────────────────────────────────────
const VOWELS = new Set("аеёиоуыэюяАЕЁИОУЫЭЮЯ");

function isVowel(ch: string): boolean {
  return VOWELS.has(ch);
}

// ── Simple Russian stemmer (Porter-like) ────────────────────────────
function stem(word: string): string {
  let w = word.toLowerCase();
  const suffixes = [
    "ившись", "ывшись", "вшись",
    "ающий", "яющий", "ующий", "ющий", "ащий", "ящий",
    "авший", "ивший", "увший", "ывший",
    "ённый", "анный", "енный",
    "ающе", "яюще", "ующе",
    "ости", "ость", "ести", "есть",
    "ание", "ение", "ании", "ении",
    "ться", "тся",
    "ами", "ями", "ому", "ему", "ого", "его",
    "ать", "ять", "еть", "ить", "уть",
    "ала", "ила", "ела", "ула", "ыла", "ола",
    "али", "или", "ели", "ули", "ыли", "оли",
    "ает", "яет", "ует", "ёт", "ит", "ет",
    "ой", "ый", "ий", "ая", "яя", "ое", "ее",
    "ов", "ев", "ей", "ам", "ям", "ах", "ях",
    "ом", "ем", "им", "ым", "ой",
    "ал", "ил", "ел", "ул", "ыл", "ол",
    "ан", "ен", "он", "ин", "ун", "ын",
    "ку", "ке", "ка", "ки", "ко",
    "ну", "не", "на", "ни", "но",
    "ту", "те", "та", "ти", "то",
    "ы", "и", "а", "я", "у", "ю", "е", "о",
  ];
  for (const s of suffixes) {
    if (w.length > s.length + 2 && w.endsWith(s)) {
      return w.slice(0, -s.length);
    }
  }
  return w;
}

// ── Find dictionary matches in text using stemming ──────────────────
interface DictEntry {
  word: string;
  stressed_index: number;
  context: string | null;
}

interface StressMatch {
  phrase_id: string;
  word: string;
  word_offset: number;
  stressed_char_offset: number;
  dict_word: string;
  confidence: "stem" | "exact" | "ai";
}

function findStemMatches(
  phraseId: string,
  text: string,
  dictEntries: DictEntry[]
): StressMatch[] {
  const matches: StressMatch[] = [];
  const stemMap = new Map<string, DictEntry[]>();
  for (const entry of dictEntries) {
    const s = stem(entry.word);
    const list = stemMap.get(s) ?? [];
    list.push(entry);
    stemMap.set(s, list);
  }

  const wordRegex = /[а-яёА-ЯЁ]+/g;
  let m: RegExpExecArray | null;
  while ((m = wordRegex.exec(text)) !== null) {
    const word = m[0];
    const wordOffset = m.index;
    const wordLower = word.toLowerCase();
    const wordStem = stem(wordLower);

    const entries = stemMap.get(wordStem);
    if (!entries) continue;

    for (const entry of entries) {
      const stressedVowelChar = entry.word.toLowerCase()[entry.stressed_index];
      if (!stressedVowelChar || !isVowel(stressedVowelChar)) continue;

      let vowelCount = 0;
      let targetVowelN = 0;
      for (let i = 0; i < entry.word.length; i++) {
        if (isVowel(entry.word[i])) {
          vowelCount++;
          if (i === entry.stressed_index) {
            targetVowelN = vowelCount;
            break;
          }
        }
      }

      let currentVowelN = 0;
      let stressOffset = -1;
      for (let i = 0; i < word.length; i++) {
        if (isVowel(word[i])) {
          currentVowelN++;
          if (currentVowelN === targetVowelN) {
            stressOffset = wordOffset + i;
            break;
          }
        }
      }

      if (stressOffset >= 0) {
        const isExact = wordLower === entry.word.toLowerCase();
        matches.push({
          phrase_id: phraseId,
          word,
          word_offset: wordOffset,
          stressed_char_offset: stressOffset,
          dict_word: entry.word,
          confidence: isExact ? "exact" : "stem",
        });
      }
    }
  }

  return matches;
}

// ── Main handler ─────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = await getUserIdFromAuth(authHeader);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 🚫 К3: Accept phrases from client (OPFS), never read from DB
    const { scene_id, mode, phrases: clientPhrases, model, provider, apiKey, user_api_key, openrouter_api_key } = await req.json();

    if (!scene_id) {
      return new Response(JSON.stringify({ error: "scene_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!clientPhrases || !Array.isArray(clientPhrases) || clientPhrases.length === 0) {
      return new Response(JSON.stringify({ error: "phrases required — send storyboard phrases from OPFS" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate phrase structure
    const phrases = clientPhrases.map((p: any) => ({
      id: String(p.id || p.phrase_id || ""),
      segment_id: String(p.segment_id || ""),
      phrase_number: Number(p.phrase_number) || 0,
      text: String(p.text || ""),
      metadata: p.metadata ?? {},
    }));

    // Load user's stress dictionary (this is user-level data, not book content — OK to read from DB)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: dictEntries } = await supabase
      .from("stress_dictionary")
      .select("word, stressed_index, context")
      .eq("user_id", userId);

    const dictionary = (dictEntries ?? []) as DictEntry[];

    if (mode === "suggest") {
      // ── AI mode: find ambiguous words in scene text ──────────────
      const usedModel = model || "google/gemini-2.5-flash";
      const effectiveApiKey = apiKey || user_api_key || null;
      const resolved = resolveAiEndpoint(usedModel, effectiveApiKey, openrouter_api_key);

      if (!resolved.apiKey) {
        return new Response(JSON.stringify({ error: "AI not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const sceneText = phrases.map((p: any) => p.text).join("\n");
      const existingWords = new Set(dictionary.map(d => d.word.toLowerCase()));

      const basePrompt = (await resolveTaskPromptWithOverrides("proofreader:suggest_stress"))
        || "Ты — эксперт по русской фонетике. Найди слова с неоднозначным ударением.";
      const systemPrompt = existingWords.size > 0
        ? `${basePrompt}\n\nУже в словаре пользователя (не включай): ${[...existingWords].join(", ")}`
        : basePrompt;

      const aiRes = await fetch(resolved.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resolved.apiKey}`,
        },
        body: JSON.stringify({
          model: resolved.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Найди слова с неоднозначным ударением в этом тексте:\n\n${sceneText}` },
          ],
          tools: [{
            type: "function",
            function: {
              name: "report_ambiguous_words",
              description: "Report words with ambiguous stress",
              parameters: {
                type: "object",
                properties: {
                  words: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        word: { type: "string", description: "Word in base form" },
                        stressed_index: { type: "integer", description: "0-based index of stressed letter" },
                        reason: { type: "string", description: "Why stress is ambiguous" },
                      },
                      required: ["word", "stressed_index", "reason"],
                    },
                  },
                },
                required: ["words"],
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "report_ambiguous_words" } },
          ...modelParams(resolved.model, { temperature: 0.3 }),
        }),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        console.error("AI error:", aiRes.status, errText);
        const statusCode = (aiRes.status === 402 || aiRes.status === 429) ? aiRes.status : 500;
        return new Response(JSON.stringify({ error: `AI error: ${aiRes.status}` }), {
          status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiData = await aiRes.json();
      let suggestions: Array<{ word: string; stressed_index: number; reason: string }> = [];

      try {
        const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          const parsed = JSON.parse(toolCall.function.arguments);
          suggestions = parsed.words ?? [];
        } else {
          const content = aiData.choices?.[0]?.message?.content;
          if (content) {
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) suggestions = JSON.parse(jsonMatch[0]);
          }
        }
      } catch (e) {
        console.error("Failed to parse AI suggestions:", e);
      }

      suggestions = suggestions.filter(s =>
        s.word && typeof s.stressed_index === "number" &&
        s.stressed_index >= 0 && s.stressed_index < s.word.length &&
        isVowel(s.word[s.stressed_index])
      );

      return new Response(JSON.stringify({ suggestions, count: suggestions.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Correct mode: apply dictionary to phrases, return annotations ──
    // 🚫 К3: No DB writes — return computed annotations for client to apply locally
    if (dictionary.length === 0) {
      return new Response(JSON.stringify({
        applied: 0,
        annotations: {},
        message: "Dictionary is empty. Use 'suggest' mode to find words or add manually.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allMatches: StressMatch[] = [];
    for (const p of phrases) {
      const matches = findStemMatches(p.id, p.text, dictionary);
      allMatches.push(...matches);
    }

    if (allMatches.length === 0) {
      return new Response(JSON.stringify({
        applied: 0,
        annotations: {},
        message: "No dictionary words found in scene text.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group matches by phrase and compute new annotations
    const phraseMatches = new Map<string, StressMatch[]>();
    for (const m of allMatches) {
      const list = phraseMatches.get(m.phrase_id) ?? [];
      list.push(m);
      phraseMatches.set(m.phrase_id, list);
    }

    // Return annotations map: phrase_id → new annotations to add
    const annotations: Record<string, Array<{ type: string; start: number; end: number }>> = {};
    let appliedCount = 0;

    for (const [phraseId, matches] of phraseMatches) {
      const phrase = phrases.find((p: any) => p.id === phraseId);
      if (!phrase) continue;

      const meta = (phrase.metadata ?? {}) as Record<string, unknown>;
      const existing = (meta.annotations ?? []) as Array<Record<string, unknown>>;
      const existingStressOffsets = new Set(
        existing.filter(a => a.type === "stress").map(a => a.start)
      );

      const newAnnotations: Array<{ type: string; start: number; end: number }> = [];
      for (const m of matches) {
        if (existingStressOffsets.has(m.stressed_char_offset)) continue;
        newAnnotations.push({
          type: "stress",
          start: m.stressed_char_offset,
          end: m.stressed_char_offset + 1,
        });
        appliedCount++;
      }

      if (newAnnotations.length > 0) {
        annotations[phraseId] = newAnnotations;
      }
    }

    return new Response(JSON.stringify({
      applied: appliedCount,
      total_matches: allMatches.length,
      phrases_affected: Object.keys(annotations).length,
      annotations,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("correct-stress error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
