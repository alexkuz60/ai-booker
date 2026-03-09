/**
 * recalc-durations — Downloads existing MP3 files from storage,
 * parses MP3 frame headers for accurate duration, and updates
 * segment_audio.duration_ms without re-synthesis.
 *
 * Body: { chapter_id: string }
 * Returns: { updated: number, errors: number, details: [...] }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── MP3 duration parser ─────────────────────────────────────────────
const MP3_BITRATES_V1_L3 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
const MP3_SAMPLERATES_V1 = [44100, 48000, 32000, 0];

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
    if (data[i] === 0xFF && (data[i + 1] & 0xE0) === 0xE0) {
      const b1 = data[i + 1];
      const b2 = data[i + 2];
      const version = (b1 >> 3) & 0x03;
      const layer   = (b1 >> 1) & 0x03;
      const brIdx   = (b2 >> 4) & 0x0F;
      const srIdx   = (b2 >> 2) & 0x03;
      const padding = (b2 >> 1) & 0x01;

      if (version === 1 || layer === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) {
        i++; continue;
      }

      let bitrate: number;
      let sampleRate: number;
      let samplesPerFrame: number;

      if (version === 3) {
        bitrate = MP3_BITRATES_V1_L3[brIdx] * 1000;
        sampleRate = MP3_SAMPLERATES_V1[srIdx];
        samplesPerFrame = layer === 1 ? 1152 : layer === 2 ? 1152 : 384;
      } else {
        const br2 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0];
        bitrate = br2[brIdx] * 1000;
        sampleRate = MP3_SAMPLERATES_V1[srIdx];
        if (version === 2) sampleRate /= 2;
        else if (version === 0) sampleRate /= 4;
        samplesPerFrame = 576;
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

  if (frameCount < 3) {
    return Math.round((data.length / 16000) * 1000);
  }
  return Math.round(totalMs);
}

// ── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin-only
    const { data: roleData } = await supabase
      .from("user_roles").select("role")
      .eq("user_id", userData.user.id).eq("role", "admin")
      .maybeSingle();
    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { chapter_id } = await req.json();
    if (!chapter_id) {
      return new Response(JSON.stringify({ error: "chapter_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all scenes for this chapter
    const { data: scenes } = await supabase
      .from("book_scenes").select("id").eq("chapter_id", chapter_id);
    if (!scenes?.length) {
      return new Response(JSON.stringify({ updated: 0, errors: 0, details: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sceneIds = scenes.map(s => s.id);

    // Get all segments for these scenes
    const { data: segments } = await supabase
      .from("scene_segments").select("id").in("scene_id", sceneIds);
    if (!segments?.length) {
      return new Response(JSON.stringify({ updated: 0, errors: 0, details: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const segIds = segments.map(s => s.id);

    // Get all segment_audio records
    const { data: audioRecords } = await supabase
      .from("segment_audio")
      .select("id, segment_id, audio_path, duration_ms, status")
      .in("segment_id", segIds)
      .eq("status", "ready");

    if (!audioRecords?.length) {
      return new Response(JSON.stringify({ updated: 0, errors: 0, details: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let updated = 0;
    let errors = 0;
    const details: Array<{ segment_id: string; old_ms: number; new_ms: number }> = [];

    for (const rec of audioRecords) {
      try {
        // Download the MP3 file using admin client
        const { data: fileData, error: dlErr } = await supabaseAdmin.storage
          .from("user-media")
          .download(rec.audio_path);

        if (dlErr || !fileData) {
          console.error(`Download failed for ${rec.audio_path}:`, dlErr);
          errors++;
          continue;
        }

        const buffer = await fileData.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const newDurationMs = parseMp3Duration(bytes);

        if (newDurationMs <= 0) {
          console.error(`Invalid duration for ${rec.audio_path}: ${newDurationMs}ms`);
          errors++;
          continue;
        }

        // Only update if duration actually changed (>50ms difference)
        if (Math.abs(newDurationMs - rec.duration_ms) > 50) {
          await supabaseAdmin.from("segment_audio")
            .update({ duration_ms: newDurationMs })
            .eq("id", rec.id);

          details.push({ segment_id: rec.segment_id, old_ms: rec.duration_ms, new_ms: newDurationMs });
          updated++;
          console.log(`Updated ${rec.segment_id}: ${rec.duration_ms}ms → ${newDurationMs}ms`);
        }
      } catch (e) {
        console.error(`Error processing ${rec.segment_id}:`, e);
        errors++;
      }
    }

    // Also update scene_playlists total_duration_ms for affected scenes
    if (updated > 0) {
      for (const sceneId of sceneIds) {
        const { data: sceneAudio } = await supabase
          .from("segment_audio")
          .select("segment_id, duration_ms")
          .in("segment_id", segments.filter(s => true).map(s => s.id))
          .eq("status", "ready");

        // We'll let the client-side useTimelineClips handle playlist sync
        // since it has the full timing context
      }
    }

    return new Response(JSON.stringify({ updated, errors, total: audioRecords.length, details }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("recalc-durations error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
