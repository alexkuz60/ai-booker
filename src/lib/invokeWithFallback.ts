/**
 * invokeWithFallback — wraps supabase.functions.invoke with cascading
 * provider fallback on 402 (credits exhausted) / 429 (rate limit).
 *
 * Fallback chain: Lovable AI → OpenRouter → ProxyAPI → DotPoint
 */

import { supabase } from "@/integrations/supabase/client";
import { getModelRegistryEntry } from "@/config/modelRegistry";
import { toast } from "sonner";

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: "OpenRouter",
  proxyapi: "ProxyAPI",
  dotpoint: "DotPoint",
};

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

async function extractFunctionErrorMessage(result: { data: unknown; error: any }): Promise<string> {
  const baseMessage = String(result.error?.message || result.error || "");
  const response = result.error?.context;
  if (!response || typeof response.text !== "function") return baseMessage;

  try {
    const raw = await response.clone().text();
    if (!raw) return baseMessage;
    try {
      const parsed = JSON.parse(raw);
      return String(parsed?.error || parsed?.message || raw || baseMessage);
    } catch {
      return raw;
    }
  } catch {
    return baseMessage;
  }
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

  const missingProviderError = getMissingExplicitProviderError(originalModel, body, userApiKeys, isRu);
  if (missingProviderError) {
    return {
      data: null,
      error: missingProviderError,
    };
  }

  // Enrich first call with matching API keys so the edge function
  // can route to the correct provider without falling back to Lovable AI.
  const enrichedBody = enrichBodyWithKeys(body, originalModel, userApiKeys);

  // First attempt — original request (now with keys)
  const firstResult = await supabase.functions.invoke(functionName, { body: enrichedBody });

  // Check if we need fallback
  const needsFallback = isRetryableError(firstResult);

  if (!needsFallback) {
    if (firstResult.error) {
      firstResult.error.message = await extractFunctionErrorMessage(firstResult);
    }
    return firstResult as InvokeResult<T>;
  }

  // Build fallback chain
  const fallbacks = buildFallbackChain(originalModel, userApiKeys, modelField, body);

  for (const fb of fallbacks) {
    console.warn(`[${functionName}] Falling back to ${fb.label}`);
    toast.info(isRu ? `Переключаюсь на ${fb.label}...` : `Switching to ${fb.label}...`);

    const result = await supabase.functions.invoke(functionName, { body: fb.body });
    if (!isRetryableError(result)) {
      if (result.error) {
        result.error.message = await extractFunctionErrorMessage(result);
      }
      return result as InvokeResult<T>;
    }
  }

  // All fallbacks exhausted — return last error
  if (firstResult.error) {
    firstResult.error.message = await extractFunctionErrorMessage(firstResult);
  }
  return firstResult as InvokeResult<T>;
}

function isRetryableError(result: { data: unknown; error: any }): boolean {
  if (!result.error) {
    // Edge function returned 200 but with error in body
    const dataErr = (result.data as Record<string, unknown>)?.error;
    if (dataErr && /402|429|payment|credits|rate.?limit/i.test(String(dataErr))) return true;
    return false;
  }
  // Check error message text
  const errMsg = String(result.error?.message || result.error || "");
  if (/402|429|payment|credits|rate.?limit/i.test(errMsg)) return true;
  // Check HTTP status from FunctionsHttpError.context (Response object)
  const status = result.error?.context?.status;
  if (status === 402 || status === 429) return true;
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

/**
 * Enrich request body with the appropriate API key for the model's provider prefix.
 * This ensures the first call already carries the key so the edge function
 * doesn't fall through to Lovable AI gateway.
 */
export function enrichBodyWithKeys(
  body: Record<string, unknown>,
  model: string,
  userApiKeys: Record<string, string>,
): Record<string, unknown> {
  // Already has explicit keys — don't override
  if (body.apiKey || body.user_api_key || body.openrouter_api_key) return body;

  if (model.startsWith("openrouter/") && userApiKeys["openrouter"]) {
    return {
      ...body,
      provider: "openrouter",
      apiKey: userApiKeys["openrouter"],
      user_api_key: userApiKeys["openrouter"],
      openrouter_api_key: userApiKeys["openrouter"],
    };
  }
  if (model.startsWith("proxyapi/") && userApiKeys["proxyapi"]) {
    return {
      ...body,
      provider: "proxyapi",
      apiKey: userApiKeys["proxyapi"],
      user_api_key: userApiKeys["proxyapi"],
    };
  }
  if (model.startsWith("dotpoint/") && userApiKeys["dotpoint"]) {
    return {
      ...body,
      provider: "dotpoint",
      apiKey: userApiKeys["dotpoint"],
      user_api_key: userApiKeys["dotpoint"],
    };
  }
  return body;
}

export function getMissingExplicitProviderError(
  model: string,
  body: Record<string, unknown>,
  userApiKeys: Record<string, string>,
  isRu = false,
): Error | null {
  const provider = getExplicitProvider(model);
  if (!provider) return null;

  const hasInlineKey = provider === "openrouter"
    ? Boolean(body.apiKey || body.user_api_key || body.openrouter_api_key)
    : Boolean(body.apiKey || body.user_api_key);

  if (hasInlineKey || userApiKeys[provider]) return null;

  const providerLabel = PROVIDER_LABELS[provider] || provider;
  return new Error(
    isRu
      ? `Для модели ${model} не найден API-ключ ${providerLabel}. Запрос остановлен, чтобы не откатываться на Lovable AI.`
      : `Missing ${providerLabel} API key for model ${model}. Request was stopped to avoid falling back to Lovable AI.`,
  );
}

function getExplicitProvider(model: string): string | null {
  if (model.startsWith("openrouter/")) return "openrouter";
  if (model.startsWith("proxyapi/")) return "proxyapi";
  if (model.startsWith("dotpoint/")) return "dotpoint";
  return null;
}
