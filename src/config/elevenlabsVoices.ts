// ElevenLabs voice registry for character voice assignment

export interface ElevenLabsVoice {
  id: string;
  name: string;
  description: { ru: string; en: string };
  gender: "male" | "female";
  accent: string;
}

export const ELEVENLABS_VOICES: ElevenLabsVoice[] = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", description: { ru: "Тёплый, британский", en: "Warm, British" }, gender: "male", accent: "british" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", description: { ru: "Мягкий, американский", en: "Soft, American" }, gender: "female", accent: "american" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", description: { ru: "Глубокий, авторитетный", en: "Deep, authoritative" }, gender: "male", accent: "british" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", description: { ru: "Нежный, британский", en: "Gentle, British" }, gender: "female", accent: "british" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", description: { ru: "Молодой, американский", en: "Young, American" }, gender: "male", accent: "american" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", description: { ru: "Чёткий, британский", en: "Clear, British" }, gender: "female", accent: "british" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", description: { ru: "Классический рассказчик", en: "Classic narrator" }, gender: "male", accent: "american" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", description: { ru: "Дружелюбный, американский", en: "Friendly, American" }, gender: "female", accent: "american" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", description: { ru: "Уверенный, американский", en: "Confident, American" }, gender: "male", accent: "american" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", description: { ru: "Элегантный, американский", en: "Elegant, American" }, gender: "female", accent: "american" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", description: { ru: "Непринуждённый, австралийский", en: "Casual, Australian" }, gender: "male", accent: "australian" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", description: { ru: "Спокойный, трансатлантический", en: "Calm, transatlantic" }, gender: "male", accent: "transatlantic" },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River", description: { ru: "Спокойный, американский", en: "Calm, American" }, gender: "male", accent: "american" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", description: { ru: "Тёплый, австралийский", en: "Warm, Australian" }, gender: "female", accent: "australian" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will", description: { ru: "Дружелюбный, американский", en: "Friendly, American" }, gender: "male", accent: "american" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric", description: { ru: "Дружелюбный, американский", en: "Friendly, American" }, gender: "male", accent: "american" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris", description: { ru: "Непринуждённый, американский", en: "Casual, American" }, gender: "male", accent: "american" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill", description: { ru: "Доверительный, американский", en: "Trustworthy, American" }, gender: "male", accent: "american" },
];

/** Pick best ElevenLabs voice for a character based on gender */
export function matchElevenLabsVoice(gender: string): string {
  const genderVoices = gender !== "unknown"
    ? ELEVENLABS_VOICES.filter(v => v.gender === gender)
    : ELEVENLABS_VOICES;
  return genderVoices[0]?.id ?? ELEVENLABS_VOICES[0].id;
}
