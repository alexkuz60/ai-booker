/**
 * Shared provider routing for AI edge functions.
 * Resolves endpoint, model name, and API key based on provider prefix.
 */

import { resolveProxyApiModel } from "./proxyapi.ts";

export interface ResolvedEndpoint {
  endpoint: string;
  model: string;
  apiKey: string;
}

/**
 * Resolve AI endpoint based on model prefix and provided keys.
 * Priority: explicit provider prefix → Lovable AI fallback.
 */
export function resolveAiEndpoint(
  userModel: string,
  userApiKey: string | null,
  openrouterApiKey?: string | null,
): ResolvedEndpoint {
  // ProxyAPI
  if (userModel.startsWith("proxyapi/") && userApiKey) {
    const realModel = resolveProxyApiModel(userModel);
    return {
      endpoint: "https://openai.api.proxyapi.ru/v1/chat/completions",
      model: realModel,
      apiKey: userApiKey,
    };
  }

  // OpenRouter
  if (userModel.startsWith("openrouter/")) {
    const key = userApiKey || openrouterApiKey;
    if (key) {
      return {
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        model: userModel.replace("openrouter/", ""),
        apiKey: key,
      };
    }
  }

  // DotPoint
  if (userModel.startsWith("dotpoint/") && userApiKey) {
    return {
      endpoint: "https://llms.dotpoin.com/v1/chat/completions",
      model: userModel.replace("dotpoint/", ""),
      apiKey: userApiKey,
    };
  }

  // Lovable AI gateway (default)
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  return {
    endpoint: "https://ai.gateway.lovable.dev/v1/chat/completions",
    model: userModel.replace(/^(openrouter|proxyapi|dotpoint|lovable)\//, "") || "google/gemini-2.5-flash",
    apiKey: LOVABLE_API_KEY || "",
  };
}

/**
 * Extract provider routing fields from request body.
 * Returns defaults if fields are missing (backward-compatible).
 */
export function extractProviderFields(body: Record<string, unknown>): {
  model: string;
  apiKey: string | null;
  openrouterApiKey: string | null;
  provider: string;
} {
  return {
    model: String(body.model || body.user_model || body.clientModel || ""),
    apiKey: (body.apiKey || body.user_api_key || null) as string | null,
    openrouterApiKey: (body.openrouter_api_key || null) as string | null,
    provider: String(body.provider || ""),
  };
}
