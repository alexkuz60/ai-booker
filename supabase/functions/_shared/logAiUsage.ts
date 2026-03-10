import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Log AI usage to proxy_api_logs table.
 * Non-fatal: errors are logged but never thrown.
 */
export async function logAiUsage(params: {
  userId: string;
  modelId: string;
  requestType: string;
  status: "success" | "error";
  latencyMs: number;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  errorMessage?: string | null;
}) {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    await supabase.from("proxy_api_logs").insert({
      user_id: params.userId,
      model_id: params.modelId,
      provider: "lovable",
      request_type: params.requestType,
      status: params.status,
      latency_ms: params.latencyMs,
      tokens_input: params.tokensInput ?? null,
      tokens_output: params.tokensOutput ?? null,
      error_message: params.errorMessage ?? null,
    });
  } catch (e) {
    console.error("logAiUsage failed (non-fatal):", e);
  }
}

/** Extract user ID from Authorization header via Supabase auth */
export async function getUserIdFromAuth(authHeader: string): Promise<string | null> {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabase.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}
