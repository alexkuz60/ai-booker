// ProxyAPI (OpenAI) TTS voice registry

export interface ProxyApiTtsVoice {
  id: string;
  name: string;
  description: { ru: string; en: string };
  gender: "male" | "female";
}

export const PROXYAPI_TTS_VOICES: ProxyApiTtsVoice[] = [
  { id: "alloy", name: "Alloy", description: { ru: "Нейтральный, сбалансированный", en: "Neutral, balanced" }, gender: "female" },
  { id: "ash", name: "Ash", description: { ru: "Тёплый, уверенный", en: "Warm, confident" }, gender: "male" },
  { id: "ballad", name: "Ballad", description: { ru: "Мягкий, мелодичный", en: "Soft, melodic" }, gender: "male" },
  { id: "coral", name: "Coral", description: { ru: "Яркий, выразительный", en: "Bright, expressive" }, gender: "female" },
  { id: "echo", name: "Echo", description: { ru: "Спокойный, ровный", en: "Calm, even" }, gender: "male" },
  { id: "fable", name: "Fable", description: { ru: "Повествовательный, тёплый", en: "Narrative, warm" }, gender: "male" },
  { id: "nova", name: "Nova", description: { ru: "Энергичный, молодой", en: "Energetic, young" }, gender: "female" },
  { id: "onyx", name: "Onyx", description: { ru: "Глубокий, авторитетный", en: "Deep, authoritative" }, gender: "male" },
  { id: "sage", name: "Sage", description: { ru: "Мудрый, спокойный", en: "Wise, calm" }, gender: "female" },
  { id: "shimmer", name: "Shimmer", description: { ru: "Лёгкий, воздушный", en: "Light, airy" }, gender: "female" },
];

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
    ? PROXYAPI_TTS_VOICES.filter(v => v.gender === gender)
    : PROXYAPI_TTS_VOICES;
  return genderVoices[0]?.id ?? "alloy";
}
