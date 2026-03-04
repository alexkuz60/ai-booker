/**
 * Static Model Registry — metadata catalog for AI models available for semantic analysis.
 * Filtered for text analysis tasks (chat models only).
 */

export interface ModelRegistryEntry {
  id: string;
  displayName: string;
  /** 'lovable' | 'proxyapi' | 'openrouter' */
  provider: string;
  creator: string;
  strengths: string[];
  pricing: { input: string; output: string } | 'free' | 'included';
  /** Which api_keys key is required (null for lovable) */
  apiKeyField: string | null;
}

const registry: ModelRegistryEntry[] = [
  // ─── Lovable AI (built-in, no key needed) ───
  { id: 'google/gemini-3-flash-preview', displayName: 'Gemini 3 Flash Preview', provider: 'lovable', creator: 'Google', strengths: ['speed', 'multimodal'], pricing: 'included', apiKeyField: null },
  { id: 'google/gemini-3-pro-preview', displayName: 'Gemini 3 Pro Preview', provider: 'lovable', creator: 'Google', strengths: ['reasoning', 'multimodal', 'coding'], pricing: 'included', apiKeyField: null },
  { id: 'google/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', provider: 'lovable', creator: 'Google', strengths: ['reasoning', 'long-context'], pricing: 'included', apiKeyField: null },
  { id: 'google/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', provider: 'lovable', creator: 'Google', strengths: ['speed', 'reasoning'], pricing: 'included', apiKeyField: null },
  { id: 'google/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite', provider: 'lovable', creator: 'Google', strengths: ['speed', 'efficiency'], pricing: 'included', apiKeyField: null },
  { id: 'openai/gpt-5', displayName: 'GPT-5', provider: 'lovable', creator: 'OpenAI', strengths: ['reasoning', 'multimodal', 'long-context'], pricing: 'included', apiKeyField: null },
  { id: 'openai/gpt-5-mini', displayName: 'GPT-5 Mini', provider: 'lovable', creator: 'OpenAI', strengths: ['reasoning', 'efficiency'], pricing: 'included', apiKeyField: null },
  { id: 'openai/gpt-5-nano', displayName: 'GPT-5 Nano', provider: 'lovable', creator: 'OpenAI', strengths: ['speed', 'efficiency'], pricing: 'included', apiKeyField: null },
  { id: 'openai/gpt-5.2', displayName: 'GPT-5.2', provider: 'lovable', creator: 'OpenAI', strengths: ['reasoning', 'coding'], pricing: 'included', apiKeyField: null },

  // ─── ProxyAPI (requires 'proxyapi' key) ───
  { id: 'proxyapi/gpt-5', displayName: 'GPT-5 (ProxyAPI)', provider: 'proxyapi', creator: 'OpenAI via ProxyAPI', strengths: ['reasoning', 'multimodal', 'long-context'], pricing: { input: '≈$5', output: '≈$15' }, apiKeyField: 'proxyapi' },
  { id: 'proxyapi/gpt-5-mini', displayName: 'GPT-5 Mini (ProxyAPI)', provider: 'proxyapi', creator: 'OpenAI via ProxyAPI', strengths: ['reasoning', 'efficiency'], pricing: { input: '≈$1', output: '≈$4' }, apiKeyField: 'proxyapi' },
  { id: 'proxyapi/gpt-5.2', displayName: 'GPT-5.2 (ProxyAPI)', provider: 'proxyapi', creator: 'OpenAI via ProxyAPI', strengths: ['reasoning', 'coding'], pricing: { input: '≈$6', output: '≈$18' }, apiKeyField: 'proxyapi' },
  { id: 'proxyapi/gpt-4o', displayName: 'GPT-4o (ProxyAPI)', provider: 'proxyapi', creator: 'OpenAI via ProxyAPI', strengths: ['reasoning', 'vision', 'coding'], pricing: { input: '≈$3', output: '≈$12' }, apiKeyField: 'proxyapi' },
  { id: 'proxyapi/gpt-4o-mini', displayName: 'GPT-4o Mini (ProxyAPI)', provider: 'proxyapi', creator: 'OpenAI via ProxyAPI', strengths: ['speed', 'efficiency'], pricing: { input: '≈$0.2', output: '≈$0.8' }, apiKeyField: 'proxyapi' },
  { id: 'proxyapi/claude-sonnet-4', displayName: 'Claude Sonnet 4 (ProxyAPI)', provider: 'proxyapi', creator: 'Anthropic via ProxyAPI', strengths: ['coding', 'reasoning', 'creative'], pricing: { input: '≈$4', output: '≈$20' }, apiKeyField: 'proxyapi' },
  { id: 'proxyapi/claude-opus-4', displayName: 'Claude Opus 4 (ProxyAPI)', provider: 'proxyapi', creator: 'Anthropic via ProxyAPI', strengths: ['deep-reasoning', 'creative'], pricing: { input: '≈$15', output: '≈$75' }, apiKeyField: 'proxyapi' },
  { id: 'proxyapi/claude-3-5-sonnet', displayName: 'Claude 3.5 Sonnet (ProxyAPI)', provider: 'proxyapi', creator: 'Anthropic via ProxyAPI', strengths: ['coding', 'reasoning'], pricing: { input: '≈$4', output: '≈$20' }, apiKeyField: 'proxyapi' },
  { id: 'proxyapi/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro (ProxyAPI)', provider: 'proxyapi', creator: 'Google via ProxyAPI', strengths: ['reasoning', 'long-context'], pricing: { input: '≈$1.5', output: '≈$6' }, apiKeyField: 'proxyapi' },
  { id: 'proxyapi/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash (ProxyAPI)', provider: 'proxyapi', creator: 'Google via ProxyAPI', strengths: ['speed', 'reasoning'], pricing: { input: '≈$0.15', output: '≈$0.6' }, apiKeyField: 'proxyapi' },

  // ─── OpenRouter (requires 'openrouter' key) ───
  { id: 'openrouter/google/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro (OpenRouter)', provider: 'openrouter', creator: 'Google via OpenRouter', strengths: ['reasoning', 'long-context'], pricing: { input: '$1.25', output: '$5' }, apiKeyField: 'openrouter' },
  { id: 'openrouter/google/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash (OpenRouter)', provider: 'openrouter', creator: 'Google via OpenRouter', strengths: ['speed', 'reasoning'], pricing: { input: '$0.075', output: '$0.3' }, apiKeyField: 'openrouter' },
  { id: 'openrouter/anthropic/claude-sonnet-4', displayName: 'Claude Sonnet 4 (OpenRouter)', provider: 'openrouter', creator: 'Anthropic via OpenRouter', strengths: ['coding', 'reasoning'], pricing: { input: '$3', output: '$15' }, apiKeyField: 'openrouter' },
  { id: 'openrouter/anthropic/claude-3.5-sonnet', displayName: 'Claude 3.5 Sonnet (OpenRouter)', provider: 'openrouter', creator: 'Anthropic via OpenRouter', strengths: ['coding', 'reasoning'], pricing: { input: '$3', output: '$15' }, apiKeyField: 'openrouter' },
  { id: 'openrouter/deepseek/deepseek-chat', displayName: 'DeepSeek V3 (OpenRouter)', provider: 'openrouter', creator: 'DeepSeek via OpenRouter', strengths: ['coding', 'reasoning', 'multilingual'], pricing: { input: '$0.27', output: '$1.1' }, apiKeyField: 'openrouter' },
  { id: 'openrouter/deepseek/deepseek-r1', displayName: 'DeepSeek R1 (OpenRouter)', provider: 'openrouter', creator: 'DeepSeek via OpenRouter', strengths: ['deep-reasoning', 'math'], pricing: { input: '$0.55', output: '$2.19' }, apiKeyField: 'openrouter' },
  { id: 'openrouter/qwen/qwen3-0.6b-04-28:free', displayName: 'Qwen3 0.6B (Free)', provider: 'openrouter', creator: 'Alibaba via OpenRouter', strengths: ['efficiency', 'multilingual'], pricing: 'free', apiKeyField: 'openrouter' },
];

const registryMap = new Map<string, ModelRegistryEntry>(
  registry.map(entry => [entry.id, entry])
);

export function getModelRegistryEntry(id: string): ModelRegistryEntry | undefined {
  return registryMap.get(id);
}

export function getModelsForAnalysis(): ModelRegistryEntry[] {
  return registry;
}

/** Get available models filtered by which API keys the user has */
export function getAvailableModels(userApiKeys: Record<string, string>): ModelRegistryEntry[] {
  return registry.filter(m => {
    if (m.provider === 'lovable') return true;
    return m.apiKeyField ? !!userApiKeys[m.apiKeyField] : false;
  });
}

export const DEFAULT_MODEL_ID = 'google/gemini-3-flash-preview';

export function isLovableModel(modelId: string): boolean {
  const entry = registryMap.get(modelId);
  return entry?.provider === 'lovable';
}
