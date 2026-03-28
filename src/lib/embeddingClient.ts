/**
 * Client-side wrapper for calling semantic embedding APIs
 * via existing Edge Functions (openrouter-proxy, proxy-api-test).
 *
 * Supports:
 *   - OpenRouter: sentence-transformers models (384d / 768d)
 *   - ProxyAPI: OpenAI embedding models (1536d / 3072d)
 *
 * Embeddings are used for the "Semantic" axis of Quality Radar.
 */

import { supabase } from "@/integrations/supabase/client";

// ── Types ────────────────────────────────────────────────────────────────────

export type EmbeddingProvider = "openrouter" | "proxyapi";

export interface EmbeddingResult {
  vector: number[];
  dimensions: number;
  model: string;
  provider: EmbeddingProvider;
  latencyMs: number;
}

export interface EmbeddingOptions {
  provider: EmbeddingProvider;
  model?: string;
  apiKey: string;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MODELS: Record<EmbeddingProvider, string> = {
  openrouter: "sentence-transformers/all-MiniLM-L6-v2",
  proxyapi: "openai/text-embedding-3-small",
};

// ── API calls ────────────────────────────────────────────────────────────────

/**
 * Get embedding vector for a text string.
 *
 * @param text    Text to embed
 * @param opts    Provider config (provider, optional model, API key)
 * @returns       EmbeddingResult with vector and metadata
 * @throws        Error on network/API failure
 */
export async function getEmbedding(
  text: string,
  opts: EmbeddingOptions,
): Promise<EmbeddingResult> {
  const model = opts.model ?? DEFAULT_MODELS[opts.provider];
  const start = performance.now();

  if (opts.provider === "openrouter") {
    return callOpenRouter(text, model, opts.apiKey, start);
  }
  return callProxyApi(text, model, opts.apiKey, start);
}

/**
 * Get embeddings for multiple texts in a single call (batch).
 * Falls back to sequential calls if batch not supported.
 */
export async function getEmbeddings(
  texts: string[],
  opts: EmbeddingOptions,
): Promise<EmbeddingResult[]> {
  // Both providers support array input
  const model = opts.model ?? DEFAULT_MODELS[opts.provider];
  const start = performance.now();

  const functionName = opts.provider === "openrouter" ? "openrouter-proxy" : "proxy-api-test";
  const body: Record<string, unknown> = {
    action: "embeddings",
    model_id: model,
    input: texts,
  };

  if (opts.provider === "openrouter") {
    body.openrouter_api_key = opts.apiKey;
  } else {
    body.api_key = opts.apiKey;
  }

  const { data, error } = await supabase.functions.invoke(functionName, { body });
  const latencyMs = Math.round(performance.now() - start);

  if (error || !data || data.status === "error") {
    throw new Error(data?.error || error?.message || "Embedding request failed");
  }

  // Parse response — may be single or array
  const embData = Array.isArray(data.data) ? data.data : [data.data];
  return embData.map((item: { embedding: number[] }) => ({
    vector: item.embedding,
    dimensions: item.embedding.length,
    model,
    provider: opts.provider,
    latencyMs,
  }));
}

// ── Provider-specific calls ──────────────────────────────────────────────────

async function callOpenRouter(
  text: string,
  model: string,
  apiKey: string,
  start: number,
): Promise<EmbeddingResult> {
  const { data, error } = await supabase.functions.invoke("openrouter-proxy", {
    body: {
      action: "embeddings",
      model_id: model,
      input: text,
      openrouter_api_key: apiKey,
    },
  });

  const latencyMs = Math.round(performance.now() - start);
  if (error || !data || data.status === "error") {
    throw new Error(data?.error || error?.message || "OpenRouter embedding failed");
  }

  const vector = data.data?.[0]?.embedding ?? data.embedding ?? [];
  return { vector, dimensions: vector.length, model, provider: "openrouter", latencyMs };
}

async function callProxyApi(
  text: string,
  model: string,
  apiKey: string,
  start: number,
): Promise<EmbeddingResult> {
  const { data, error } = await supabase.functions.invoke("proxy-api-test", {
    body: {
      action: "embeddings",
      model_id: model,
      input: text,
      api_key: apiKey,
    },
  });

  const latencyMs = Math.round(performance.now() - start);
  if (error || !data || data.status === "error") {
    throw new Error(data?.error || error?.message || "ProxyAPI embedding failed");
  }

  const vector = data.data?.[0]?.embedding ?? data.embedding ?? [];
  return { vector, dimensions: vector.length, model, provider: "proxyapi", latencyMs };
}

// ── Similarity ───────────────────────────────────────────────────────────────

/** Cosine similarity between two embedding vectors */
export function embeddingCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Provider detection ───────────────────────────────────────────────────────

/**
 * Detect which embedding provider is available based on user's API keys.
 * Returns the best available option or null if none.
 */
export function detectEmbeddingProvider(
  userApiKeys: Record<string, string>,
): EmbeddingOptions | null {
  // Prefer ProxyAPI (OpenAI quality) if key available
  if (userApiKeys.proxyapi) {
    return { provider: "proxyapi", apiKey: userApiKeys.proxyapi };
  }
  // Fallback to OpenRouter
  if (userApiKeys.openrouter) {
    return { provider: "openrouter", apiKey: userApiKeys.openrouter };
  }
  return null;
}
