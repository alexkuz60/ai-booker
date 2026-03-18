import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveAiEndpoint } from "../_shared/providerRouting.ts";

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
// Strips common suffixes to find word stems for matching
function stem(word: string): string {
  let w = word.toLowerCase();
  // Remove common endings (simplified Russian morphology)
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
      break;
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
  word_offset: number; // char offset of the word in phrase text
  stressed_char_offset: number; // char offset of the stressed vowel in phrase text
  dict_word: string;
  confidence: "stem" | "exact" | "ai";
}

function findStemMatches(
  phraseId: string,
  text: string,
  dictEntries: DictEntry[]
): StressMatch[] {
  const matches: StressMatch[] = [];
  // Build stem → entries map
  const stemMap = new Map<string, DictEntry[]>();
  for (const entry of dictEntries) {
    const s = stem(entry.word);
    const list = stemMap.get(s) ?? [];
    list.push(entry);
    stemMap.set(s, list);
  }

  // Tokenize text into words with positions
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
      // Find the stressed vowel position in the current word form
      // The dictionary stores stressed_index relative to the base word
      // We need to map it to the current form
      const stressedVowelChar = entry.word.toLowerCase()[entry.stressed_index];
      if (!stressedVowelChar || !isVowel(stressedVowelChar)) continue;

      // Find the nth vowel in the dictionary word
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

      // Find the same nth vowel in the text word
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;
    const { scene_id, mode, model } = await req.json();
    // mode: "correct" (apply dictionary to scene) | "suggest" (AI find ambiguous words)

    if (!scene_id) {
      return new Response(JSON.stringify({ error: "scene_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load scene segments + phrases
    const { data: segments } = await supabase
      .from("scene_segments")
      .select("id, segment_number, speaker")
      .eq("scene_id", scene_id)
      .order("segment_number");

    if (!segments?.length) {
      return new Response(JSON.stringify({ error: "No segments found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const segIds = segments.map(s => s.id);
    const { data: phrases } = await supabase
      .from("segment_phrases")
      .select("id, segment_id, phrase_number, text, metadata")
      .in("segment_id", segIds)
      .order("phrase_number");

    if (!phrases?.length) {
      return new Response(JSON.stringify({ error: "No phrases found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load user's stress dictionary
    const { data: dictEntries } = await supabase
      .from("stress_dictionary")
      .select("word, stressed_index, context")
      .eq("user_id", userId);

    const dictionary = (dictEntries ?? []) as DictEntry[];

    if (mode === "suggest") {
      // ── AI mode: find ambiguous words in scene text ──────────────
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        return new Response(JSON.stringify({ error: "AI not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Collect all text
      const sceneText = phrases.map(p => p.text).join("\n");
      const existingWords = new Set(dictionary.map(d => d.word.toLowerCase()));

      const systemPrompt = `Ты — эксперт по русской фонетике и орфоэпии. Твоя задача — найти в тексте слова с неоднозначным ударением (омографы и слова, часто произносимые неправильно).

Для каждого найденного слова верни:
- word: слово в начальной форме (именительный падеж, инфинитив)
- stressed_index: индекс (0-based) ударной буквы в слове
- reason: краткое объяснение почему ударение может быть неочевидным

Примеры омографов: замОк/зАмок, мукА/мУка, Орган/оргАн, Атлас/атлАс, стрЕлки/стрелкИ.
Примеры частых ошибок: звонИт (не звОнит), тОрты (не тортЫ), бАнты (не бантЫ).

Не включай слова, ударение которых очевидно и не вызывает сомнений.
${existingWords.size > 0 ? `\nУже в словаре пользователя (не включай): ${[...existingWords].join(", ")}` : ""}`;

      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: model || "google/gemini-2.5-flash",
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
          temperature: 0.3,
        }),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        console.error("AI error:", aiRes.status, errText);
        if (aiRes.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "AI analysis failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
          // Fallback: try parsing from content
          const content = aiData.choices?.[0]?.message?.content;
          if (content) {
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) suggestions = JSON.parse(jsonMatch[0]);
          }
        }
      } catch (e) {
        console.error("Failed to parse AI suggestions:", e);
      }

      // Filter out invalid entries
      suggestions = suggestions.filter(s =>
        s.word && typeof s.stressed_index === "number" &&
        s.stressed_index >= 0 && s.stressed_index < s.word.length &&
        isVowel(s.word[s.stressed_index])
      );

      return new Response(JSON.stringify({ suggestions, count: suggestions.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Correct mode: apply dictionary to phrases ──────────────────
    if (dictionary.length === 0) {
      return new Response(JSON.stringify({
        applied: 0,
        message: "Dictionary is empty. Use 'suggest' mode to find words or add manually.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find all stem matches
    const allMatches: StressMatch[] = [];
    for (const p of phrases) {
      const matches = findStemMatches(p.id, p.text, dictionary);
      allMatches.push(...matches);
    }

    if (allMatches.length === 0) {
      return new Response(JSON.stringify({ applied: 0, message: "No dictionary words found in scene text." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group matches by phrase and apply as stress annotations
    const phraseMatches = new Map<string, StressMatch[]>();
    for (const m of allMatches) {
      const list = phraseMatches.get(m.phrase_id) ?? [];
      list.push(m);
      phraseMatches.set(m.phrase_id, list);
    }

    let appliedCount = 0;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    for (const [phraseId, matches] of phraseMatches) {
      const phrase = phrases.find(p => p.id === phraseId);
      if (!phrase) continue;

      const meta = (phrase.metadata ?? {}) as Record<string, unknown>;
      const existing = (meta.annotations ?? []) as Array<Record<string, unknown>>;

      // Don't duplicate: check if stress annotation already exists at same offset
      const existingStressOffsets = new Set(
        existing.filter(a => a.type === "stress").map(a => a.start)
      );

      const newAnnotations = [...existing];
      for (const m of matches) {
        if (existingStressOffsets.has(m.stressed_char_offset)) continue;
        newAnnotations.push({
          type: "stress",
          start: m.stressed_char_offset,
          end: m.stressed_char_offset + 1,
        });
        appliedCount++;
      }

      if (newAnnotations.length > existing.length) {
        await supabaseAdmin
          .from("segment_phrases")
          .update({ metadata: { ...meta, annotations: newAnnotations } })
          .eq("id", phraseId);
      }
    }

    return new Response(JSON.stringify({
      applied: appliedCount,
      total_matches: allMatches.length,
      phrases_affected: phraseMatches.size,
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
