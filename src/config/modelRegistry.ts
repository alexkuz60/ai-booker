/**
 * Static Model Registry — metadata catalog for AI models available for semantic analysis.
 * Filtered for text analysis tasks (chat models only).
 */

export interface ModelRegistryEntry {
  id: string;
  displayName: string;
  provider: string;
  creator: string;
  strengths: string[];
  pricing: { input: string; output: string } | 'free' | 'included';
}

const registry: ModelRegistryEntry[] = [
  // ─── Lovable AI (built-in, no key needed) ───
  { id: 'google/gemini-3-flash-preview', displayName: 'Gemini 3 Flash Preview', provider: 'lovable', creator: 'Google', strengths: ['speed', 'multimodal'], pricing: 'included' },
  { id: 'google/gemini-3-pro-preview', displayName: 'Gemini 3 Pro Preview', provider: 'lovable', creator: 'Google', strengths: ['reasoning', 'multimodal', 'coding'], pricing: 'included' },
  { id: 'google/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', provider: 'lovable', creator: 'Google', strengths: ['reasoning', 'long-context'], pricing: 'included' },
  { id: 'google/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', provider: 'lovable', creator: 'Google', strengths: ['speed', 'reasoning'], pricing: 'included' },
  { id: 'google/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite', provider: 'lovable', creator: 'Google', strengths: ['speed', 'efficiency'], pricing: 'included' },
  { id: 'openai/gpt-5', displayName: 'GPT-5', provider: 'lovable', creator: 'OpenAI', strengths: ['reasoning', 'multimodal', 'long-context'], pricing: 'included' },
  { id: 'openai/gpt-5-mini', displayName: 'GPT-5 Mini', provider: 'lovable', creator: 'OpenAI', strengths: ['reasoning', 'efficiency'], pricing: 'included' },
  { id: 'openai/gpt-5-nano', displayName: 'GPT-5 Nano', provider: 'lovable', creator: 'OpenAI', strengths: ['speed', 'efficiency'], pricing: 'included' },
  { id: 'openai/gpt-5.2', displayName: 'GPT-5.2', provider: 'lovable', creator: 'OpenAI', strengths: ['reasoning', 'coding'], pricing: 'included' },
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

export const DEFAULT_MODEL_ID = 'google/gemini-3-flash-preview';

export function isLovableModel(modelId: string): boolean {
  const entry = registryMap.get(modelId);
  return entry?.provider === 'lovable';
}
