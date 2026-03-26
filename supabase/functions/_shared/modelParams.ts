/**
 * Shared model parameter normalization for AI edge functions.
 *
 * GPT-5 series (gpt-5, gpt-5-mini, gpt-5-nano, gpt-5.2) and reasoning models
 * (o1, o3, o4) reject `max_tokens` and non-default `temperature`.
 * This module centralizes detection so every edge function stays compatible.
 */

/** Models that MUST use max_completion_tokens instead of max_tokens */
const MODELS_USE_MAX_COMPLETION_TOKENS = /gpt-5|o1|o3|o4/i;

/**
 * Models that reject non-default temperature.
 * gpt-5, gpt-5-mini, gpt-5-nano: temperature not supported at all.
 * gpt-5.2: temperature only with reasoning_effort: "none" — safer to omit.
 * o1, o3, o4: same.
 * deepseek-reasoner: same.
 */
const MODELS_NO_TEMPERATURE = /gpt-5|o1-|o3-|o3$|o4-|o4$|deepseek-reasoner/i;

/**
 * Build the correct token limit parameter for a model.
 */
export function tokenLimitParam(
  model: string,
  maxTokens: number,
): Record<string, number> {
  if (MODELS_USE_MAX_COMPLETION_TOKENS.test(model)) {
    return { max_completion_tokens: maxTokens };
  }
  return { max_tokens: maxTokens };
}

/**
 * Return temperature param if the model supports it, otherwise empty object.
 */
export function temperatureParam(
  model: string,
  value: number,
): Record<string, number> {
  if (MODELS_NO_TEMPERATURE.test(model)) return {};
  return { temperature: value };
}

/**
 * Convenience: build both token limit + temperature params.
 */
export function modelParams(
  model: string,
  opts: { maxTokens?: number; temperature?: number } = {},
): Record<string, number> {
  return {
    ...(opts.maxTokens != null ? tokenLimitParam(model, opts.maxTokens) : {}),
    ...temperatureParam(model, opts.temperature ?? 1),
  };
}