/**
 * invokeWithFallback — wraps supabase.functions.invoke with cascading
 * provider fallback on 402 (credits exhausted) / 429 (rate limit).
 *
 * Fallback chain: Lovable AI → OpenRouter → ProxyAPI → DotPoint
 */

import { supabase } from "@/integrations/supabase/client";
import { getModelRegistryEntry } from "@/config/modelRegistry";
import { toast } from "sonner";

export interface FallbackOptions {
  /** Edge function name */
  functionName: string;
  /** Request body (will be augmented with provider fields on retry) */
  body: Record<string, unknown>;
  /** User API keys from useUserApiKeys */
  userApiKeys: Record<string, string>;
  /** The AI model field name in the body (default: "model") */
  modelField?: string;
  /** Is Russian UI */
  isRu?: boolean;
}

interface InvokeResult<T = unknown> {
  data: T | null;
  error: any;
}

/**
 * Invoke an edge function with automatic cascading fallback.
 * Only triggers fallback when:
 * 1. The original call used Lovable AI (no provider prefix or "lovable" provider)
 * 2. The response is 402 or 429
 */
export async function invokeWithFallback<T = unknown>(
  opts: FallbackOptions,
): Promise<InvokeResult<T>> {
  const { functionName, body, userApiKeys, isRu = false } = opts;
  const modelField = opts.modelField || "model";
  const originalModel = String(body[modelField] || "");

  // First attempt — original request
  const firstResult = await supabase.functions.invoke(functionName, { body });

  // Check if we need fallback
  const needsFallback = isRetryableError(firstResult);
  const isLovableProvider = !originalModel.startsWith("openrouter/") &&
    !originalModel.startsWith("proxyapi/") &&
    !originalModel.startsWith("dotpoint/");

  if (!needsFallback || !isLovableProvider) {
    return firstResult as InvokeResult<T>;
  }

  // Build fallback chain
  const fallbacks = buildFallbackChain(originalModel, userApiKeys, modelField, body);

  for (const fb of fallbacks) {
    console.warn(`[${functionName}] Falling back to ${fb.label}`);
    toast.info(isRu ? `Переключаюсь на ${fb.label}...` : `Switching to ${fb.label}...`);

    const result = await supabase.functions.invoke(functionName, { body: fb.body });
    if (!isRetryableError(result)) {
      return result as InvokeResult<T>;
    }
  }

  // All fallbacks exhausted — return last error
  return firstResult as InvokeResult<T>;
}

function isRetryableError(result: { data: unknown; error: any }): boolean {
  // Check explicit error from SDK
  const errMsg = String(result.error?.message || result.error || "");
  if (/402|429|payment|credits|rate.?limit/i.test(errMsg)) return true;
  // Check error embedded in response data (edge function returning JSON error)
  const dataErr = (result.data as Record<string, unknown>)?.error;
  if (dataErr) {
    const dataMsg = String(dataErr);
    if (/402|429|payment|credits|rate.?limit/i.test(dataMsg)) return true;
  }
  return false;
}

interface FallbackEntry {
  label: string;
  body: Record<string, unknown>;
}

function buildFallbackChain(
  originalModel: string,
  userApiKeys: Record<string, string>,
  modelField: string,
  baseBody: Record<string, unknown>,
): FallbackEntry[] {
  const chain: FallbackEntry[] = [];
  const cleanModel = originalModel.replace(/^(openrouter|proxyapi|dotpoint|lovable)\//, "");

  // 1. OpenRouter
  if (userApiKeys["openrouter"]) {
    const orModel = `openrouter/${cleanModel}`;
    const entry = getModelRegistryEntry(orModel);
    chain.push({
      label: "OpenRouter",
      body: {
        ...baseBody,
        [modelField]: entry ? orModel : cleanModel,
        provider: "openrouter",
        apiKey: userApiKeys["openrouter"],
        user_api_key: userApiKeys["openrouter"],
        openrouter_api_key: userApiKeys["openrouter"],
      },
    });
  }

  // 2. ProxyAPI
  if (userApiKeys["proxyapi"]) {
    const paModel = `proxyapi/${cleanModel}`;
    const entry = getModelRegistryEntry(paModel);
    chain.push({
      label: "ProxyAPI",
      body: {
        ...baseBody,
        [modelField]: entry ? paModel : cleanModel,
        provider: "proxyapi",
        apiKey: userApiKeys["proxyapi"],
        user_api_key: userApiKeys["proxyapi"],
        openrouter_api_key: null,
      },
    });
  }

  // 3. DotPoint
  if (userApiKeys["dotpoint"]) {
    chain.push({
      label: "DotPoint",
      body: {
        ...baseBody,
        [modelField]: `dotpoint/${cleanModel}`,
        provider: "dotpoint",
        apiKey: userApiKeys["dotpoint"],
        user_api_key: userApiKeys["dotpoint"],
        openrouter_api_key: null,
      },
    });
  }

  return chain;
}
