import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Types ────────────────────────────────────────────────────────────

interface InlineNarration {
  text: string;
  insert_after: string;
}

interface InlineNarrationResult {
  text: string;
  insert_after: string;
  audio_path: string;
  duration_ms: number;
  offset_ms: number; // position in the dialogue timeline where narrator starts
}

interface SegmentResult {
  segment_id: string;
  status: string;
  duration_ms: number;
  audio_path: string;
  error?: string;
  inline_narrations?: InlineNarrationResult[];
}

// ── V3-only voices (cannot use SSML / v1) ────────────────────────────
const V3_ONLY_VOICES = new Set([
  "dasha", "julia", "lera", "masha", "alexander", "kirill", "anton",
  "saule_ru", "zamira_ru", "zhanar_ru", "yulduz_ru",
  "naomi", "saule", "zhanar", "zamira", "yulduz",
]);

// ── Voice helpers ────────────────────────────────────────────────────

const voiceRolesMap: Record<string, string[]> = {
  alena: ["neutral", "good"], filipp: ["neutral"], ermil: ["neutral", "good"],
  jane: ["neutral", "good", "evil"], madirus: ["neutral"], omazh: ["neutral", "evil"],
  zahar: ["neutral", "good"], dasha: ["neutral", "friendly", "strict"],
  julia: ["neutral", "strict"], lera: ["neutral", "friendly"],
  masha: ["neutral", "friendly", "strict"], marina: ["neutral", "whisper", "friendly"],
  alexander: ["neutral", "good"], kirill: ["neutral", "strict", "good"],
  anton: ["neutral", "good"],
};

function randomVoiceConfig() {
  const voices = Object.keys(voiceRolesMap);
  const voice = voices[Math.floor(Math.random() * voices.length)];
  const roles = voiceRolesMap[voice];
  const role = roles[Math.floor(Math.random() * roles.length)];
  const speed = Math.round((0.9 + Math.random() * 0.3) * 100) / 100;
  const pitchShift = Math.floor(Math.random() * 400) - 200;
  return { voice, role, speed, pitchShift, volume: undefined as number | undefined };
}

function resolveVoice(
  speaker: string | null,
  voiceConfigMap: Map<string, Record<string, unknown>>
) {
  const vc = speaker
    ? voiceConfigMap.get(speaker.toLowerCase()) ?? {}
    : {};

  if ((vc as Record<string, unknown>).voice) {
    return {
      voice: (vc as Record<string, unknown>).voice as string,
      role: (vc as Record<string, unknown>).role as string | undefined,
      speed: ((vc as Record<string, unknown>).speed as number) || 1.0,
      pitchShift: (vc as Record<string, unknown>).pitchShift as number | undefined,
      volume: (vc as Record<string, unknown>).volume as number | undefined,
    };
  }
  return randomVoiceConfig();
}

// ── MP3 duration parser ──────────────────────────────────────────────
// Parses MP3 frame headers to calculate accurate duration instead of
// rough byte-size estimation which varies with VBR encoding.

const MP3_BITRATES_V1_L3 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
const MP3_SAMPLERATES_V1  = [44100, 48000, 32000, 0];

function parseMp3Duration(data: Uint8Array): number {
  let totalMs = 0;
  let i = 0;
  let frameCount = 0;

  // Skip ID3v2 tag if present
  if (data.length > 10 && data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
    const size = ((data[6] & 0x7F) << 21) | ((data[7] & 0x7F) << 14) |
                 ((data[8] & 0x7F) << 7) | (data[9] & 0x7F);
    i = 10 + size;
  }

  while (i < data.length - 4) {
    // Look for frame sync (0xFF 0xE0+)
    if (data[i] === 0xFF && (data[i + 1] & 0xE0) === 0xE0) {
      const b1 = data[i + 1];
      const b2 = data[i + 2];

      const version = (b1 >> 3) & 0x03;     // 0=2.5, 1=reserved, 2=v2, 3=v1
      const layer   = (b1 >> 1) & 0x03;     // 1=L3, 2=L2, 3=L1
      const brIdx   = (b2 >> 4) & 0x0F;
      const srIdx   = (b2 >> 2) & 0x03;
      const padding = (b2 >> 1) & 0x01;

      if (version === 1 || layer === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) {
        i++;
        continue;
      }

      let bitrate: number;
      let sampleRate: number;
      let samplesPerFrame: number;

      if (version === 3) { // MPEG1
        bitrate = MP3_BITRATES_V1_L3[brIdx] * 1000;
        sampleRate = MP3_SAMPLERATES_V1[srIdx];
        samplesPerFrame = layer === 1 ? 1152 : layer === 2 ? 1152 : 384;
      } else { // MPEG2 / 2.5
        // Simplified bitrate table for MPEG2 L3
        const br2 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0];
        bitrate = br2[brIdx] * 1000;
        sampleRate = MP3_SAMPLERATES_V1[srIdx];
        if (version === 2) sampleRate /= 2;
        else if (version === 0) sampleRate /= 4;
        samplesPerFrame = layer === 1 ? 576 : 576;
      }

      if (bitrate === 0 || sampleRate === 0) { i++; continue; }

      const frameLen = Math.floor((samplesPerFrame * (bitrate / 8)) / sampleRate) + padding;
      if (frameLen < 4) { i++; continue; }

      totalMs += (samplesPerFrame / sampleRate) * 1000;
      frameCount++;
      i += frameLen;
    } else {
      i++;
    }
  }

  // Fallback to byte-size estimate if parsing failed
  if (frameCount < 3) {
    return Math.round((data.length / 16000) * 1000);
  }

  return Math.round(totalMs);
}

// ── TTS call helper ──────────────────────────────────────────────────

async function callTts(
  yandexTtsUrl: string,
  authHeader: string,
  params: {
    text?: string;
    ssml?: string;
    voice: string;
    role?: string;
    speed: number;
    pitchShift?: number;
    volume?: number;
    lang: string;
  }
): Promise<{ audio: Uint8Array; durationMs: number } | { error: string }> {
  const body: Record<string, unknown> = {
    voice: params.voice,
    role: params.role,
    speed: params.speed,
    pitchShift: params.pitchShift,
    volume: params.volume,
    lang: params.lang,
  };
  if (params.ssml) {
    body.ssml = params.ssml;
  } else {
    body.text = params.text;
  }

  const resp = await fetch(yandexTtsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    return { error: `TTS ${resp.status}: ${errBody}` };
  }

  const audioBuffer = await resp.arrayBuffer();
  const audio = new Uint8Array(audioBuffer);
  const durationMs = parseMp3Duration(audio);
  return { audio, durationMs };
}

// ── SSML builder for dialogue with inline narration pauses ───────────

function buildDialogueSsml(
  dialogueText: string,
  narrations: Array<{ insert_after: string; duration_ms: number }>
): string {
  // Sort narrations by position in text (find insert_after location)
  const sorted = narrations
    .map((n) => {
      const idx = dialogueText.indexOf(n.insert_after);
      return { ...n, charIdx: idx >= 0 ? idx + n.insert_after.length : -1 };
    })
    .filter((n) => n.charIdx >= 0)
    .sort((a, b) => a.charIdx - b.charIdx);

  if (sorted.length === 0) {
    return `<speak>${escapeXml(dialogueText)}</speak>`;
  }

  let ssml = "<speak>";
  let lastIdx = 0;
  for (const n of sorted) {
    ssml += escapeXml(dialogueText.slice(lastIdx, n.charIdx));
    ssml += ` <break time="${n.duration_ms}ms"/> `;
    lastIdx = n.charIdx;
  }
  ssml += escapeXml(dialogueText.slice(lastIdx));
  ssml += "</speak>";
  return ssml;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Narrator voice for inline narrations ─────────────────────────────
// If scene has first_person segments with a speaker, use that character's voice
// (the scene is narrated from their perspective). Otherwise fall back to Narrator/Рассказчик.

function getNarratorVoice(
  voiceConfigMap: Map<string, Record<string, unknown>>,
  segments?: Array<{ segment_type: string; speaker: string | null }>
) {
  // Check if scene has a first-person narrator
  if (segments) {
    const fpSeg = segments.find(s => s.segment_type === "first_person" && s.speaker);
    if (fpSeg && fpSeg.speaker) {
      const fpVc = voiceConfigMap.get(fpSeg.speaker.toLowerCase());
      if (fpVc && fpVc.voice) {
        return {
          voice: fpVc.voice as string,
          role: fpVc.role as string | undefined,
          speed: (fpVc.speed as number) || 1.0,
          pitchShift: fpVc.pitchShift as number | undefined,
          volume: fpVc.volume as number | undefined,
        };
      }
    }
  }

  // Fall back to narrator character voice
  const narratorVc = voiceConfigMap.get("narrator") ?? voiceConfigMap.get("рассказчик");
  if (narratorVc && (narratorVc as Record<string, unknown>).voice) {
    return {
      voice: (narratorVc as Record<string, unknown>).voice as string,
      role: (narratorVc as Record<string, unknown>).role as string | undefined,
      speed: ((narratorVc as Record<string, unknown>).speed as number) || 1.0,
      pitchShift: (narratorVc as Record<string, unknown>).pitchShift as number | undefined,
      volume: (narratorVc as Record<string, unknown>).volume as number | undefined,
    };
  }
  // Default narrator voice
  return { voice: "alena", role: "neutral", speed: 1.0, pitchShift: undefined, volume: undefined };
}

// ── Main handler ─────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin-only
    const { data: roleData } = await supabase
      .from("user_roles").select("role")
      .eq("user_id", userData.user.id).eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: "Scene synthesis is available for admins only." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { scene_id, language, force, segment_ids: filterSegIds } = await req.json();
    const isRu = language === "ru";
    const forceResynthesize = force === true;
    const filterSet = Array.isArray(filterSegIds) && filterSegIds.length > 0
      ? new Set<string>(filterSegIds)
      : null;
    const langCode = isRu ? "ru" : "en";

    if (!scene_id) {
      return new Response(
        JSON.stringify({ error: "scene_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load segments + phrases + metadata
    const { data: segments, error: segErr } = await supabase
      .from("scene_segments")
      .select("id, segment_number, segment_type, speaker, metadata")
      .eq("scene_id", scene_id)
      .order("segment_number");

    if (segErr) throw segErr;
    if (!segments?.length) {
      return new Response(
        JSON.stringify({ error: isRu ? "Нет сегментов" : "No segments found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const segIds = segments.map((s) => s.id);
    const { data: phrases } = await supabase
      .from("segment_phrases")
      .select("id, segment_id, phrase_number, text")
      .in("segment_id", segIds)
      .order("phrase_number");

    // Group phrases by segment
    const phrasesBySegment = new Map<string, string[]>();
    for (const p of phrases ?? []) {
      const list = phrasesBySegment.get(p.segment_id) ?? [];
      list.push(p.text);
      phrasesBySegment.set(p.segment_id, list);
    }

    // Load character voice configs
    const speakerNames = [...new Set(segments.map(s => s.speaker).filter(Boolean))];
    const voiceConfigMap = new Map<string, Record<string, unknown>>();

    if (speakerNames.length > 0) {
      const { data: sceneData } = await supabase
        .from("book_scenes").select("chapter_id").eq("id", scene_id).single();
      if (sceneData) {
        const { data: chapterData } = await supabase
          .from("book_chapters").select("book_id").eq("id", sceneData.chapter_id).single();
        if (chapterData) {
          const { data: chars } = await supabase
            .from("book_characters")
            .select("name, voice_config, aliases")
            .eq("book_id", chapterData.book_id);
          if (chars) {
            for (const c of chars) {
              const vc = (c.voice_config || {}) as Record<string, unknown>;
              voiceConfigMap.set(c.name.toLowerCase(), vc);
              for (const alias of (c.aliases ?? [])) {
                if (alias) voiceConfigMap.set(alias.toLowerCase(), vc);
              }
            }
          }
        }
      }
    }

    const yandexTtsUrl = `${supabaseUrl}/functions/v1/yandex-tts`;
    const userId = userData.user.id;
    const narratorVoice = getNarratorVoice(voiceConfigMap, segments);

    // ── Load existing audio records for cache comparison ─────────────
    const { data: existingAudio } = await supabase
      .from("segment_audio")
      .select("segment_id, audio_path, duration_ms, status, voice_config")
      .in("segment_id", segIds)
      .eq("status", "ready");

    const existingAudioMap = new Map<string, {
      audio_path: string;
      duration_ms: number;
      voice_config: Record<string, unknown>;
    }>();
    for (const a of existingAudio ?? []) {
      existingAudioMap.set(a.segment_id, {
        audio_path: a.audio_path,
        duration_ms: a.duration_ms,
        voice_config: (a.voice_config ?? {}) as Record<string, unknown>,
      });
    }

    /** Fast FNV-1a 32-bit hash for text comparison */
    function hashText(s: string): string {
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return (h >>> 0).toString(36);
    }

    /** Compare relevant voice params + text hash to decide if re-synthesis is needed */
    function voiceConfigChanged(
      current: { voice: string; role?: string; speed: number; pitchShift?: number; volume?: number },
      cached: Record<string, unknown>,
      currentTextHash: string
    ): boolean {
      if (current.voice !== cached.voice) return true;
      if ((current.role ?? "neutral") !== (cached.role ?? "neutral")) return true;
      if (Math.abs((current.speed ?? 1) - (Number(cached.speed) || 1)) > 0.01) return true;
      if ((current.pitchShift ?? 0) !== (Number(cached.pitchShift) || 0)) return true;
      if ((current.volume ?? -1) !== (Number(cached.volume) ?? -1)) return true;
      // Text edited? Compare hash (catches any change, not just length)
      if (currentTextHash !== (cached.textHash ?? "")) return true;
      return false;
    }

    // Build segment texts
    const segmentTexts = segments.map(seg => {
      return (phrasesBySegment.get(seg.id) ?? []).join(" ");
    });

    // ── Synthesize each segment ──────────────────────────────────────
    const results: SegmentResult[] = [];
    let cachedCount = 0;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const text = segmentTexts[i];

      // Skip segments not in filter (if filter specified)
      if (filterSet && !filterSet.has(seg.id)) {
        // Include cached result for playlist completeness
        const cached = existingAudioMap.get(seg.id);
        results.push({
          segment_id: seg.id,
          status: cached ? "ready" : "skipped",
          duration_ms: cached?.duration_ms ?? 0,
          audio_path: cached?.audio_path ?? "",
        });
        continue;
      }

      if (!text.trim()) {
        results.push({ segment_id: seg.id, status: "skipped", duration_ms: 0, audio_path: "" });
        continue;
      }

      // Check for inline narrations in metadata
      const metadata = (seg.metadata ?? {}) as Record<string, unknown>;
      const inlineNarrations = (metadata.inline_narrations ?? []) as InlineNarration[];
      const hasInlineNarrations = inlineNarrations.length > 0 && seg.segment_type === "dialogue";

      const voiceConfig = resolveVoice(seg.speaker, voiceConfigMap);

      // ── Cache check: skip if audio exists with same voice config ──
      const cached = existingAudioMap.get(seg.id);
      if (cached && !forceResynthesize && !voiceConfigChanged(voiceConfig, cached.voice_config, hashText(text))) {
        // Also check that the text hasn't changed by verifying the file still exists
        // (we trust the DB record — if segment_audio says "ready", it's good)
        console.log(`Cache hit for segment ${seg.id}: voice=${voiceConfig.voice}, skipping TTS`);
        results.push({
          segment_id: seg.id,
          status: "ready",
          duration_ms: cached.duration_ms,
          audio_path: cached.audio_path,
          inline_narrations: (metadata.inline_narrations_audio as InlineNarrationResult[] | undefined) ?? undefined,
        });
        cachedCount++;
        continue;
      }

      const isUnassigned = !voiceConfigMap.get(seg.speaker?.toLowerCase() ?? "")?.voice;
      if (isUnassigned) {
        console.log(`Unassigned segment ${seg.id}: random voice=${voiceConfig.voice}, role=${voiceConfig.role}`);
      }

      const isV3Voice = V3_ONLY_VOICES.has(voiceConfig.voice);
      const apiVersion = isV3Voice ? "v3" : "v1";
      const estimatedChunks = isV3Voice ? Math.max(1, Math.ceil(text.length / 240)) : 1;
      console.log(`▶ Segment ${i + 1}/${segments.length} [${seg.id}]: speaker=${seg.speaker || seg.segment_type}, api=${apiVersion}, voice=${voiceConfig.voice}, chars=${text.length}, chunks≈${estimatedChunks}${hasInlineNarrations ? `, narrations=${inlineNarrations.length}` : ""}`);

      try {
        let dialogueDurationMs: number;
        let dialogueAudio: Uint8Array;
        const narrationResults: InlineNarrationResult[] = [];

        if (hasInlineNarrations) {
          // ── TWO-PASS SYNTHESIS ──────────────────────────────

          // PASS 1: Synthesize each narrator insertion → get exact duration
          let offsetAccumulator = 0;
          for (let n = 0; n < inlineNarrations.length; n++) {
            const narr = inlineNarrations[n];
            console.log(`Pass 1: narrator insertion "${narr.text}" for segment ${seg.id}`);

            const narrResult = await callTts(yandexTtsUrl, authHeader, {
              text: narr.text,
              voice: narratorVoice.voice,
              role: narratorVoice.role,
              speed: narratorVoice.speed,
              pitchShift: narratorVoice.pitchShift,
              volume: narratorVoice.volume,
              lang: langCode,
            });

            if ("error" in narrResult) {
              console.error(`Narrator TTS failed for "${narr.text}":`, narrResult.error);
              continue;
            }

            // Upload narrator audio
            const narrPath = `${userId}/tts/${scene_id}/${seg.id}_narrator_${n}.mp3`;
            await supabaseAdmin.storage.from("user-media").upload(
              narrPath, narrResult.audio, { contentType: "audio/mpeg", upsert: true }
            );

            // Estimate the offset: character position in dialogue text
            const insertIdx = text.indexOf(narr.insert_after);
            const charsBefore = insertIdx >= 0 ? insertIdx + narr.insert_after.length : 0;
            // Rough estimate: chars before / total chars * total estimated duration
            // We'll refine offset_ms after we know the actual dialogue duration
            narrationResults.push({
              text: narr.text,
              insert_after: narr.insert_after,
              audio_path: narrPath,
              duration_ms: narrResult.durationMs,
              offset_ms: 0, // will be calculated after dialogue synthesis
            });

            offsetAccumulator += narrResult.durationMs;
          }

          // PASS 2: Synthesize dialogue
          // For v3-only voices: plain text (yandex-tts handles auto-splitting at sentence boundaries)
          // For v1 voices: SSML with <break> pauses baked in
          // isV3Voice already computed above

          if (narrationResults.length > 0) {
            let dialogueResult: { audio: Uint8Array; durationMs: number } | { error: string };

            if (isV3Voice) {
              // V3: synthesize plain text — narrator overlays are separate audio tracks
              console.log(`Pass 2 (v3): plain text for segment ${seg.id}, ${text.length} chars`);
              dialogueResult = await callTts(yandexTtsUrl, authHeader, {
                text,
                voice: voiceConfig.voice,
                role: voiceConfig.role,
                speed: voiceConfig.speed,
                pitchShift: voiceConfig.pitchShift,
                volume: voiceConfig.volume,
                lang: langCode,
              });
            } else {
              // V1: use SSML with <break> pauses for narrator insertions
              const ssml = buildDialogueSsml(
                text,
                narrationResults.map(nr => ({
                  insert_after: nr.insert_after,
                  duration_ms: nr.duration_ms,
                }))
              );
              console.log(`Pass 2 (v1 SSML): segment ${seg.id}, ${ssml.length} chars`);
              dialogueResult = await callTts(yandexTtsUrl, authHeader, {
                ssml,
                voice: voiceConfig.voice,
                speed: voiceConfig.speed,
                lang: langCode,
              });
            }

            if ("error" in dialogueResult) {
              console.error(`Dialogue TTS failed for segment ${seg.id}:`, dialogueResult.error);
              // Fallback: synthesize plain text without any special handling
              const fallbackResult = await callTts(yandexTtsUrl, authHeader, {
                text,
                voice: voiceConfig.voice,
                role: voiceConfig.role,
                speed: voiceConfig.speed,
                pitchShift: voiceConfig.pitchShift,
                volume: voiceConfig.volume,
                lang: langCode,
              });
              if ("error" in fallbackResult) {
                results.push({ segment_id: seg.id, status: "error", duration_ms: 0, audio_path: "", error: fallbackResult.error });
                continue;
              }
              dialogueAudio = fallbackResult.audio;
              dialogueDurationMs = fallbackResult.durationMs;
            } else {
              dialogueAudio = dialogueResult.audio;
              dialogueDurationMs = dialogueResult.durationMs;
            }
          } else {
            // No narrations succeeded — just synthesize plain text
            const plainResult = await callTts(yandexTtsUrl, authHeader, {
              text,
              voice: voiceConfig.voice,
              role: voiceConfig.role,
              speed: voiceConfig.speed,
              pitchShift: voiceConfig.pitchShift,
              volume: voiceConfig.volume,
              lang: langCode,
            });
            if ("error" in plainResult) {
              results.push({ segment_id: seg.id, status: "error", duration_ms: 0, audio_path: "", error: plainResult.error });
              continue;
            }
            dialogueAudio = plainResult.audio;
            dialogueDurationMs = plainResult.durationMs;
          }

          // Calculate narrator offsets based on dialogue character positions
          const totalChars = text.length;
          for (const nr of narrationResults) {
            const insertIdx = text.indexOf(nr.insert_after);
            const charPos = insertIdx >= 0 ? insertIdx + nr.insert_after.length : 0;
            // Scale position proportionally to actual duration
            // (the dialogue audio already has pauses baked in, so offset = proportional position)
            nr.offset_ms = Math.round((charPos / totalChars) * dialogueDurationMs);
          }

        } else {
          // ── STANDARD SINGLE-PASS SYNTHESIS ────────────────
          const result = await callTts(yandexTtsUrl, authHeader, {
            text,
            voice: voiceConfig.voice,
            role: voiceConfig.role,
            speed: voiceConfig.speed,
            pitchShift: voiceConfig.pitchShift,
            volume: voiceConfig.volume,
            lang: langCode,
          });

          if ("error" in result) {
            results.push({ segment_id: seg.id, status: "error", duration_ms: 0, audio_path: "", error: result.error });
            continue;
          }
          dialogueAudio = result.audio;
          dialogueDurationMs = result.durationMs;
        }

        // Validate audio is not empty
        if (!dialogueAudio || dialogueAudio.length === 0) {
          console.error(`Empty audio returned for segment ${seg.id} (voice=${voiceConfig.voice})`);
          results.push({ segment_id: seg.id, status: "error", duration_ms: 0, audio_path: "", error: "Empty audio returned from TTS" });
          continue;
        }

        // Upload main audio
        const storagePath = `${userId}/tts/${scene_id}/${seg.id}.mp3`;
        const { error: uploadErr } = await supabaseAdmin.storage
          .from("user-media")
          .upload(storagePath, dialogueAudio, { contentType: "audio/mpeg", upsert: true });

        if (uploadErr) {
          console.error(`Upload failed for segment ${seg.id}:`, uploadErr);
          results.push({ segment_id: seg.id, status: "error", duration_ms: 0, audio_path: "", error: "Upload failed" });
          continue;
        }

        // Update segment metadata with narrator audio info
        const updatedMetadata = { ...metadata };
        if (narrationResults.length > 0) {
          updatedMetadata.inline_narrations_audio = narrationResults;
        }

        // Upsert segment_audio record
        // isV3Voice already computed above
        await supabaseAdmin.from("segment_audio").upsert(
          {
            segment_id: seg.id,
            audio_path: storagePath,
            duration_ms: dialogueDurationMs,
            status: "ready",
            voice_config: {
              voice: voiceConfig.voice,
              role: voiceConfig.role,
              speed: voiceConfig.speed,
              pitchShift: voiceConfig.pitchShift,
              volume: voiceConfig.volume,
              textHash: hashText(text),
              apiVersion: isV3Voice ? "v3" : "v1",
            },
          },
          { onConflict: "segment_id" }
        );

        // Update segment metadata with inline narration audio info
        if (narrationResults.length > 0) {
          await supabaseAdmin
            .from("scene_segments")
            .update({ metadata: updatedMetadata })
            .eq("id", seg.id);
        }

        results.push({
          segment_id: seg.id,
          status: "ready",
          duration_ms: dialogueDurationMs,
          audio_path: storagePath,
          inline_narrations: narrationResults.length > 0 ? narrationResults : undefined,
        });

        console.log(`✅ Segment ${i + 1}/${segments.length}: ${seg.speaker || seg.segment_type}, api=${apiVersion}, chunks≈${estimatedChunks}, ${text.length}ch → ${dialogueDurationMs}ms, audio=${dialogueAudio.length}B${narrationResults.length > 0 ? ` (+${narrationResults.length} narrator overlays)` : ""}`);

      } catch (err) {
        console.error(`Error synthesizing segment ${seg.id}:`, err);
        results.push({
          segment_id: seg.id,
          status: "error",
          duration_ms: 0,
          audio_path: "",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const totalDurationMs = results.reduce((sum, r) => sum + r.duration_ms, 0);
    const successCount = results.filter(r => r.status === "ready").length;
    const errorCount = results.filter(r => r.status === "error").length;

    // Save playlist snapshot
    const playlistSegments = results.map((r, idx) => ({
      segment_id: r.segment_id,
      segment_number: segments[idx].segment_number,
      speaker: segments[idx].speaker,
      segment_type: segments[idx].segment_type,
      audio_path: r.audio_path || null,
      duration_ms: r.duration_ms,
      status: r.status,
      inline_narrations: r.inline_narrations || null,
    }));

    const playlistStatus = errorCount === 0 ? "ready" : successCount > 0 ? "partial" : "error";

    await supabaseAdmin.from("scene_playlists").upsert(
      {
        scene_id,
        total_duration_ms: totalDurationMs,
        status: playlistStatus,
        segments: playlistSegments,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "scene_id" }
    );

    console.log(`Playlist saved for scene ${scene_id}: ${playlistStatus}, ${totalDurationMs}ms (cached: ${cachedCount}, synthesized: ${successCount - cachedCount}, errors: ${errorCount})`);

    return new Response(
      JSON.stringify({
        scene_id,
        total_segments: segments.length,
        synthesized: successCount - cachedCount,
        cached: cachedCount,
        errors: errorCount,
        total_duration_ms: totalDurationMs,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("synthesize-scene error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
