import { createClient } from "npm:@supabase/supabase-js@2";

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get all files in book-uploads
    const { data: files, error: listErr } = await supabase.storage
      .from("book-uploads")
      .list("3571c4dd-60aa-47d2-b963-6d6d605a8107");

    if (listErr) throw listErr;

    // Get active file paths from books table
    const { data: books } = await supabase
      .from("books")
      .select("file_path")
      .not("file_path", "is", null);

    const activePaths = new Set((books || []).map((b: { file_path: string }) => b.file_path));

    // Find orphaned files
    const toDelete = (files || [])
      .map((f: { name: string }) => `3571c4dd-60aa-47d2-b963-6d6d605a8107/${f.name}`)
      .filter((path: string) => !activePaths.has(path));

    if (toDelete.length === 0) {
      return new Response(JSON.stringify({ deleted: 0, message: "No orphans found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: delErr } = await supabase.storage
      .from("book-uploads")
      .remove(toDelete);

    if (delErr) throw delErr;

    return new Response(
      JSON.stringify({ deleted: toDelete.length, paths: toDelete }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
