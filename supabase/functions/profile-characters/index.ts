import { createClient } from "npm:@supabase/supabase-js@2";

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
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { book_id, language } = await req.json();
    if (!book_id) {
      return new Response(JSON.stringify({ error: "book_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lang = language === "ru" ? "ru" : "en";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify user owns this book
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: bookCheck, error: bookErr } = await userClient
      .from("books")
      .select("id")
      .eq("id", book_id)
      .maybeSingle();
    if (bookErr || !bookCheck) {
      return new Response(JSON.stringify({ error: "Book not found or access denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load existing characters
    const { data: characters } = await supabase
      .from("book_characters")
      .select("id, name, aliases")
      .eq("book_id", book_id);

    if (!characters || characters.length === 0) {
      return new Response(JSON.stringify({ error: lang === "ru" ? "Нет персонажей для профайлинга. Сначала выполните сегментацию сцен." : "No characters to profile. Run scene segmentation first." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load all dialogue/first_person segments with their phrases for context
    const { data: chapters } = await supabase
      .from("book_chapters")
      .select("id, title")
      .eq("book_id", book_id);
    if (!chapters?.length) {
      return new Response(JSON.stringify({ error: "No chapters found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const chapterIds = chapters.map(c => c.id);
    const { data: scenes } = await supabase
      .from("book_scenes")
      .select("id, title")
      .in("chapter_id", chapterIds);
    if (!scenes?.length) {
      return new Response(JSON.stringify({ error: "No scenes found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sceneIds = scenes.map(s => s.id);
    const { data: segments } = await supabase
      .from("scene_segments")
      .select("id, segment_type, speaker, scene_id")
      .in("scene_id", sceneIds)
      .in("segment_type", ["dialogue", "first_person", "inner_thought", "narrator"])
      .order("segment_number");

    if (!segments?.length) {
      return new Response(JSON.stringify({ error: lang === "ru" ? "Нет сегментов для анализа" : "No segments to analyze" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load phrases for these segments (limit to keep context manageable)
    const segmentIds = segments.map(s => s.id);
    // Batch load in chunks of 200 to avoid query limits
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

    // Build character context: group dialogue by speaker
    const characterNames = characters.map(c => c.name);
    const speakerDialogues = new Map<string, string[]>();
    const narratorExcerpts: string[] = [];

    for (const seg of segments) {
      const phrases = allPhrases
        .filter(p => p.segment_id === seg.id)
        .sort((a, b) => a.phrase_number - b.phrase_number)
        .map(p => p.text)
        .join(" ");

      if (!phrases) continue;

      if (seg.speaker && characterNames.includes(seg.speaker)) {
        const existing = speakerDialogues.get(seg.speaker) || [];
        // Keep max ~10 excerpts per character
        if (existing.length < 10) {
          existing.push(phrases.slice(0, 500));
        }
        speakerDialogues.set(seg.speaker, existing);
      } else if (seg.segment_type === "narrator" || seg.segment_type === "inner_thought") {
        // Keep some narrator excerpts for context (max 20)
        if (narratorExcerpts.length < 20) {
          narratorExcerpts.push(phrases.slice(0, 300));
        }
      }
    }

    // Build the prompt
    const characterList = characters.map(c => {
      const dialogues = speakerDialogues.get(c.name);
      let block = `### ${c.name}`;
      if (c.aliases?.length) block += ` (aliases: ${c.aliases.join(", ")})`;
      block += "\n";
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
      ? `Ты — литературный аналитик. Проанализируй персонажей книги на основе их реплик и контекста повествования.\n\nДля каждого персонажа определи:\n- aliases: все варианты имени (сокращения, прозвища, обращения)\n- gender: male / female / unknown\n- age_group: child / teen / young / adult / elder / unknown\n- temperament: один из: sanguine (сангвиник), choleric (холерик), melancholic (меланхолик), phlegmatic (флегматик), или смешанный\n- speech_style: краткое описание стиля речи (2-3 предложения)\n- description: психологический портрет персонажа (3-5 предложений)\n\nОтвечай на русском языке в полях description и speech_style.`
      : `You are a literary analyst. Analyze book characters based on their dialogue and narrative context.\n\nFor each character determine:\n- aliases: all name variations (nicknames, shortened forms, titles)\n- gender: male / female / unknown\n- age_group: child / teen / young / adult / elder / unknown\n- temperament: one of: sanguine, choleric, melancholic, phlegmatic, or mixed\n- speech_style: brief description of speech patterns (2-3 sentences)\n- description: psychological portrait (3-5 sentences)`;

    const userPrompt = `## Characters to profile:\n\n${characterList}${narratorContext}`;

    // AI call with tool calling for structured output
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
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
                    },
                    required: ["name", "aliases", "gender", "age_group", "temperament", "speech_style", "description"],
                  },
                },
              },
              required: ["characters"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_character_profiles" } },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, errText);
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: lang === "ru" ? "Превышен лимит запросов, попробуйте позже" : "Rate limit exceeded, try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: lang === "ru" ? "Необходимо пополнить баланс" : "Payment required" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `AI error: ${aiRes.status}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiRes.json();
    let profiles: CharacterProfile[];

    // Try tool_calls first
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        profiles = parsed.characters;
      } catch {
        // Fallback: parse from content
        let raw = aiData.choices?.[0]?.message?.content || "";
        raw = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        profiles = JSON.parse(raw).characters;
      }
    } else {
      // Fallback: parse from content
      let raw = aiData.choices?.[0]?.message?.content || "";
      raw = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(raw);
      profiles = parsed.characters || parsed;
    }

    // Update each character in DB
    let updated = 0;
    for (const profile of profiles) {
      const char = characters.find(c => c.name === profile.name);
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
          updated_at: new Date().toISOString(),
        })
        .eq("id", char.id);

      if (!error) updated++;
      else console.error("Failed to update character:", char.name, error);
    }

    return new Response(JSON.stringify({
      profiled: updated,
      total: characters.length,
      profiles: profiles,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("profile-characters error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
