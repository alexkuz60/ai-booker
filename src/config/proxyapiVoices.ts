// ProxyAPI (OpenAI) TTS voice registry

export interface ProxyApiTtsVoice {
  id: string;
  name: string;
  description: { ru: string; en: string };
  gender: "male" | "female";
  /** Models that support this voice */
  models: string[];
}

/** Base voices available in all models */
const BASE_VOICES: ProxyApiTtsVoice[] = [
  { id: "alloy", name: "Alloy", description: { ru: "Нейтральный, сбалансированный", en: "Neutral, balanced" }, gender: "female", models: ["tts-1", "tts-1-hd", "gpt-4o-mini-tts"] },
  { id: "echo", name: "Echo", description: { ru: "Спокойный, глубокий мужской", en: "Calm, deep male" }, gender: "male", models: ["tts-1", "tts-1-hd", "gpt-4o-mini-tts"] },
  { id: "fable", name: "Fable", description: { ru: "Выразительный, «рассказчик»", en: "Expressive, narrator" }, gender: "male", models: ["tts-1", "tts-1-hd", "gpt-4o-mini-tts"] },
  { id: "onyx", name: "Onyx", description: { ru: "Басовитый, авторитетный", en: "Deep, authoritative" }, gender: "male", models: ["tts-1", "tts-1-hd", "gpt-4o-mini-tts"] },
  { id: "nova", name: "Nova", description: { ru: "Энергичный, тёплый женский", en: "Energetic, warm female" }, gender: "female", models: ["tts-1", "tts-1-hd", "gpt-4o-mini-tts"] },
  { id: "shimmer", name: "Shimmer", description: { ru: "Мягкий, чёткий женский", en: "Soft, clear female" }, gender: "female", models: ["tts-1", "tts-1-hd", "gpt-4o-mini-tts"] },
  { id: "ash", name: "Ash", description: { ru: "Чистый, профессиональный", en: "Clean, professional" }, gender: "male", models: ["tts-1", "tts-1-hd", "gpt-4o-mini-tts"] },
  { id: "sage", name: "Sage", description: { ru: "Мягкий, рассудительный", en: "Soft, thoughtful" }, gender: "female", models: ["tts-1", "tts-1-hd", "gpt-4o-mini-tts"] },
  { id: "coral", name: "Coral", description: { ru: "Дружелюбный, доступный", en: "Friendly, approachable" }, gender: "female", models: ["tts-1", "tts-1-hd", "gpt-4o-mini-tts"] },
];

/** Extended voices only for gpt-4o-mini-tts */
const EXTENDED_VOICES: ProxyApiTtsVoice[] = [
  { id: "ballad", name: "Ballad", description: { ru: "Нарративный, тёплый", en: "Narrative, warm" }, gender: "male", models: ["gpt-4o-mini-tts"] },
  { id: "verse", name: "Verse", description: { ru: "Лиричный, ритмичный", en: "Lyrical, rhythmic" }, gender: "male", models: ["gpt-4o-mini-tts"] },
  { id: "marin", name: "Marin", description: { ru: "Улучшенный мужской (премиум)", en: "Enhanced male (premium)" }, gender: "male", models: ["gpt-4o-mini-tts"] },
  { id: "cedar", name: "Cedar", description: { ru: "Улучшенный женский (премиум)", en: "Enhanced female (premium)" }, gender: "female", models: ["gpt-4o-mini-tts"] },
];

/** All voices */
export const PROXYAPI_TTS_VOICES: ProxyApiTtsVoice[] = [...BASE_VOICES, ...EXTENDED_VOICES];

/** Get voices available for a specific model */
export function getVoicesForModel(modelId: string): ProxyApiTtsVoice[] {
  return PROXYAPI_TTS_VOICES.filter(v => v.models.includes(modelId));
}

export interface ProxyApiTtsModel {
  id: string;
  name: string;
  description: { ru: string; en: string };
  supportsInstructions: boolean;
}

export const PROXYAPI_TTS_MODELS: ProxyApiTtsModel[] = [
  { id: "gpt-4o-mini-tts", name: "GPT-4o mini TTS", description: { ru: "Новейшая, управление через инструкции", en: "Latest, controllable via instructions" }, supportsInstructions: true },
  { id: "tts-1", name: "TTS-1", description: { ru: "Быстрая, низкая задержка", en: "Fast, low latency" }, supportsInstructions: false },
  { id: "tts-1-hd", name: "TTS-1 HD", description: { ru: "Высокое качество звука", en: "High quality audio" }, supportsInstructions: false },
];

/** Pick a ProxyAPI voice for a character based on gender */
export function matchProxyApiVoice(gender: string): string {
  const genderVoices = gender !== "unknown"
    ? BASE_VOICES.filter(v => v.gender === gender)
    : BASE_VOICES;
  return genderVoices[0]?.id ?? "alloy";
}
