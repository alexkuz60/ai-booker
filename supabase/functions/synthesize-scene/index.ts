import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * synthesize-scene: iterate segments of a scene, call yandex-tts for each,
 * store audio in user-media bucket, save metadata to segment_audio.
 * Supports previous_text/next_text context for stitching.
 */

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
    // Service-role client for storage uploads & segment_audio writes (bypasses RLS)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin-only (same as yandex-tts)
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: "Scene synthesis is available for admins only." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { scene_id, language } = await req.json();
    const isRu = language === "ru";

    if (!scene_id) {
      return new Response(
        JSON.stringify({ error: "scene_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load segments + phrases
    const { data: segments, error: segErr } = await supabase
      .from("scene_segments")
      .select("id, segment_number, segment_type, speaker")
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
      // Get book_id from scene
      const { data: sceneData } = await supabase
        .from("book_scenes")
        .select("chapter_id")
        .eq("id", scene_id)
        .single();

      if (sceneData) {
        const { data: chapterData } = await supabase
          .from("book_chapters")
          .select("book_id")
          .eq("id", sceneData.chapter_id)
          .single();

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

    // Synthesize each segment sequentially
    const results: Array<{
      segment_id: string;
      status: string;
      duration_ms: number;
      audio_path: string;
      error?: string;
    }> = [];

    // Build segment texts for stitching context
    const segmentTexts = segments.map(seg => {
      const segPhrases = phrasesBySegment.get(seg.id) ?? [];
      return segPhrases.join(" ");
    });

    const yandexTtsUrl = `${supabaseUrl}/functions/v1/yandex-tts`;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const text = segmentTexts[i];

      if (!text.trim()) {
        results.push({
          segment_id: seg.id,
          status: "skipped",
          duration_ms: 0,
          audio_path: "",
        });
        continue;
      }

      // Resolve voice config — random for unassigned speakers
      const vc = seg.speaker
        ? voiceConfigMap.get(seg.speaker.toLowerCase()) ?? {}
        : {};

      const hasVoice = !!(vc as Record<string, unknown>).voice;
      let voice: string;
      let role: string | undefined;
      let speed: number;
      let pitchShift: number | undefined;
      let volume: number | undefined;

      if (hasVoice) {
        voice = (vc as Record<string, unknown>).voice as string;
        role = (vc as Record<string, unknown>).role as string | undefined;
        speed = ((vc as Record<string, unknown>).speed as number) || 1.0;
        pitchShift = (vc as Record<string, unknown>).pitchShift as number | undefined;
        volume = (vc as Record<string, unknown>).volume as number | undefined;
      } else {
        // Random voice with validated role from Yandex SpeechKit registry
        const voiceRolesMap: Record<string, string[]> = {
          alena: ["neutral", "good"], filipp: ["neutral"], ermil: ["neutral", "good"],
          jane: ["neutral", "good", "evil"], madirus: ["neutral"], omazh: ["neutral", "evil"],
          zahar: ["neutral", "good"], dasha: ["neutral", "friendly", "strict"],
          julia: ["neutral", "strict"], lera: ["neutral", "friendly"],
          masha: ["neutral", "friendly", "strict"], marina: ["neutral", "whisper", "friendly"],
          alexander: ["neutral", "good"], kirill: ["neutral", "strict", "good"],
          anton: ["neutral", "good"],
        };
        const randomVoices = Object.keys(voiceRolesMap);
        voice = randomVoices[Math.floor(Math.random() * randomVoices.length)];
        const validRoles = voiceRolesMap[voice];
        role = validRoles[Math.floor(Math.random() * validRoles.length)];
        speed = 0.9 + Math.random() * 0.3; // 0.9–1.2
        speed = Math.round(speed * 100) / 100;
        pitchShift = Math.floor(Math.random() * 400) - 200; // -200..+200 Hz
        volume = undefined;
        console.log(`Unassigned segment ${seg.id}: random voice=${voice}, role=${role}, speed=${speed}, pitch=${pitchShift}`);
      }

      try {
        // Call yandex-tts
        const ttsResp = await fetch(yandexTtsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            text,
            voice,
            role,
            speed,
            pitchShift,
            volume,
            lang: isRu ? "ru" : "en",
          }),
        });

        if (!ttsResp.ok) {
          const errBody = await ttsResp.text();
          console.error(`TTS failed for segment ${seg.id}:`, ttsResp.status, errBody);
          results.push({
            segment_id: seg.id,
            status: "error",
            duration_ms: 0,
            audio_path: "",
            error: `TTS ${ttsResp.status}`,
          });
          continue;
        }

        const audioBuffer = await ttsResp.arrayBuffer();
        const audioBytes = new Uint8Array(audioBuffer);

        // Estimate duration from MP3 size (approx 16kB/s at 128kbps)
        const durationMs = Math.round((audioBytes.length / 16000) * 1000);

        // Upload to storage
        const storagePath = `${userData.user.id}/tts/${scene_id}/${seg.id}.mp3`;
        const { error: uploadErr } = await supabaseAdmin.storage
          .from("user-media")
          .upload(storagePath, audioBytes, {
            contentType: "audio/mpeg",
            upsert: true,
          });

        if (uploadErr) {
          console.error(`Upload failed for segment ${seg.id}:`, uploadErr);
          results.push({
            segment_id: seg.id,
            status: "error",
            duration_ms: 0,
            audio_path: "",
            error: "Upload failed",
          });
          continue;
        }

        // Upsert segment_audio record
        await supabaseAdmin.from("segment_audio").upsert(
          {
            segment_id: seg.id,
            audio_path: storagePath,
            duration_ms: durationMs,
            status: "ready",
            voice_config: { voice, role, speed, pitchShift, volume },
          },
          { onConflict: "segment_id" }
        );

        results.push({
          segment_id: seg.id,
          status: "ready",
          duration_ms: durationMs,
          audio_path: storagePath,
        });

        console.log(`Synthesized segment ${i + 1}/${segments.length}: ${seg.speaker || seg.segment_type}, ${durationMs}ms`);
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

    // Save playlist snapshot to scene_playlists
    const playlistSegments = results.map((r, idx) => ({
      segment_id: r.segment_id,
      segment_number: segments[idx].segment_number,
      speaker: segments[idx].speaker,
      segment_type: segments[idx].segment_type,
      audio_path: r.audio_path || null,
      duration_ms: r.duration_ms,
      status: r.status,
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

    console.log(`Playlist saved for scene ${scene_id}: ${playlistStatus}, ${totalDurationMs}ms`);

    return new Response(
      JSON.stringify({
        scene_id,
        total_segments: segments.length,
        synthesized: successCount,
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
