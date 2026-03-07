import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData } = await supabaseUser.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" });

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    const bucket = "user-media";

    const results: { deleted: string[]; errors: string[]; scanned: number } = {
      deleted: [],
      errors: [],
      scanned: 0,
    };

    // Load all valid audio paths from segment_audio
    const { data: allAudioPaths } = await supabaseAdmin
      .from("segment_audio")
      .select("audio_path")
      .eq("status", "ready");

    const validPaths = new Set(
      (allAudioPaths ?? []).map((r: { audio_path: string }) => r.audio_path),
    );

    // Determine which user folders to scan
    const foldersToScan: string[] = [];

    if (isAdmin) {
      // Admin: scan ALL user folders + legacy tts/ prefix
      const { data: topLevel } = await supabaseAdmin.storage.from(bucket).list("", { limit: 1000 });
      if (topLevel) {
        for (const entry of topLevel) {
          if (!entry.id) foldersToScan.push(entry.name); // folders only
        }
      }
    } else {
      // Regular user: only their own folder
      foldersToScan.push(userId);
    }

    // Helper: scan a tts/ subfolder and find orphans
    async function scanTtsFolder(prefix: string) {
      const { data: sceneFolders } = await supabaseAdmin.storage
        .from(bucket)
        .list(prefix, { limit: 1000 });
      if (!sceneFolders) return;

      for (const sf of sceneFolders) {
        if (sf.id) continue; // skip files, only folders
        const scenePath = `${prefix}/${sf.name}`;
        const { data: audioFiles } = await supabaseAdmin.storage
          .from(bucket)
          .list(scenePath, { limit: 1000 });
        if (!audioFiles) continue;

        const files = audioFiles.filter((f) => f.id);
        results.scanned += files.length;

        const orphaned = files
          .map((f) => `${scenePath}/${f.name}`)
          .filter((p) => !validPaths.has(p));

        if (orphaned.length > 0) {
          if (!dryRun) {
            const { error: rmErr } = await supabaseAdmin.storage.from(bucket).remove(orphaned);
            if (rmErr) {
              results.errors.push(...orphaned.map((p) => `${p}: ${rmErr.message}`));
            } else {
              results.deleted.push(...orphaned);
            }
          } else {
            results.deleted.push(...orphaned);
          }
        }
      }
    }

    for (const folder of foldersToScan) {
      if (folder === "tts") {
        // Legacy tts/<user_id>/... structure — admin only
        const { data: userSubs } = await supabaseAdmin.storage.from(bucket).list("tts", { limit: 1000 });
        if (userSubs) {
          for (const sub of userSubs) {
            if (!sub.id) await scanTtsFolder(`tts/${sub.name}`);
          }
        }
      } else {
        // Standard <user_id>/tts/... structure
        const { data: subs } = await supabaseAdmin.storage.from(bucket).list(folder, { limit: 100 });
        if (subs?.find((s) => s.name === "tts")) {
          await scanTtsFolder(`${folder}/tts`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        dry_run: dryRun,
        scope: isAdmin ? "all" : "own",
        scanned: results.scanned,
        [dryRun ? "would_delete" : "deleted"]: results.deleted.length,
        files: results.deleted,
        errors: results.errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Cleanup error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
