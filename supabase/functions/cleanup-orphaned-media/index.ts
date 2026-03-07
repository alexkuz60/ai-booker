import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify caller is admin
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData } = await supabaseUser.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default: dry run

    const bucket = "user-media";
    const results: { deleted: string[]; errors: string[]; scanned: number } = {
      deleted: [],
      errors: [],
      scanned: 0,
    };

    // 1. Clean up legacy `tts/<user_id>/...` paths (moved to `<user_id>/tts/...`)
    const { data: legacyFiles, error: listErr } = await supabaseAdmin.storage
      .from(bucket)
      .list("tts", { limit: 1000 });

    if (listErr) {
      console.error("Error listing tts/ prefix:", listErr);
    }

    // tts/ contains user-id subfolders
    if (legacyFiles) {
      for (const folder of legacyFiles) {
        if (!folder.id) {
          // It's a folder — list its contents recursively
          const { data: sceneFiles } = await supabaseAdmin.storage
            .from(bucket)
            .list(`tts/${folder.name}`, { limit: 1000 });

          if (sceneFiles) {
            for (const sceneFolder of sceneFiles) {
              if (!sceneFolder.id) {
                const { data: segments } = await supabaseAdmin.storage
                  .from(bucket)
                  .list(`tts/${folder.name}/${sceneFolder.name}`, {
                    limit: 1000,
                  });

                if (segments) {
                  const paths = segments
                    .filter((f) => f.id)
                    .map(
                      (f) =>
                        `tts/${folder.name}/${sceneFolder.name}/${f.name}`
                    );
                  results.scanned += paths.length;

                  if (!dryRun && paths.length > 0) {
                    const { data: removed, error: rmErr } =
                      await supabaseAdmin.storage.from(bucket).remove(paths);
                    if (rmErr) {
                      results.errors.push(
                        ...paths.map((p) => `${p}: ${rmErr.message}`)
                      );
                    } else {
                      results.deleted.push(...paths);
                    }
                  } else {
                    results.deleted.push(...paths); // in dry run, show what would be deleted
                  }
                }
              }
            }
          }
        }
      }
    }

    // 2. Find orphaned files in <user_id>/tts/ that have no matching segment_audio record
    const { data: allAudioPaths } = await supabaseAdmin
      .from("segment_audio")
      .select("audio_path")
      .eq("status", "ready");

    const validPaths = new Set(
      (allAudioPaths ?? []).map((r: { audio_path: string }) => r.audio_path)
    );

    // List all users' tts folders
    const { data: topLevel } = await supabaseAdmin.storage
      .from(bucket)
      .list("", { limit: 1000 });

    if (topLevel) {
      for (const userFolder of topLevel) {
        if (userFolder.id || userFolder.name === "tts") continue; // skip files and legacy tts/

        const { data: userSubs } = await supabaseAdmin.storage
          .from(bucket)
          .list(userFolder.name, { limit: 100 });

        const ttsSub = userSubs?.find((s) => s.name === "tts");
        if (!ttsSub) continue;

        // List scene folders
        const { data: sceneFolders } = await supabaseAdmin.storage
          .from(bucket)
          .list(`${userFolder.name}/tts`, { limit: 1000 });

        if (!sceneFolders) continue;

        for (const sf of sceneFolders) {
          if (sf.id) continue;
          const { data: audioFiles } = await supabaseAdmin.storage
            .from(bucket)
            .list(`${userFolder.name}/tts/${sf.name}`, { limit: 1000 });

          if (!audioFiles) continue;

          const orphaned = audioFiles
            .filter((f) => f.id)
            .map((f) => `${userFolder.name}/tts/${sf.name}/${f.name}`)
            .filter((p) => !validPaths.has(p));

          results.scanned += audioFiles.filter((f) => f.id).length;

          if (orphaned.length > 0) {
            if (!dryRun) {
              const { error: rmErr } = await supabaseAdmin.storage
                .from(bucket)
                .remove(orphaned);
              if (rmErr) {
                results.errors.push(
                  ...orphaned.map((p) => `${p}: ${rmErr.message}`)
                );
              } else {
                results.deleted.push(...orphaned);
              }
            } else {
              results.deleted.push(...orphaned);
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        dry_run: dryRun,
        scanned: results.scanned,
        [dryRun ? "would_delete" : "deleted"]: results.deleted.length,
        files: results.deleted,
        errors: results.errors,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Cleanup error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
