// SaluteSpeech (Sber) voice registry

export interface SaluteSpeechVoice {
  id: string;           // e.g. "Nec_24000"
  name: { ru: string; en: string };
  gender: "male" | "female";
  description: { ru: string; en: string };
}

export const SALUTESPEECH_VOICES: SaluteSpeechVoice[] = [
  {
    id: "Nec_24000",
    name: { ru: "Наталья", en: "Natalya" },
    gender: "female",
    description: { ru: "Спокойный, нейтральный", en: "Calm, neutral" },
  },
  {
    id: "Bys_24000",
    name: { ru: "Борис", en: "Boris" },
    gender: "male",
    description: { ru: "Уверенный, деловой", en: "Confident, business" },
  },
  {
    id: "May_24000",
    name: { ru: "Марфа", en: "Marfa" },
    gender: "female",
    description: { ru: "Молодой, дружелюбный", en: "Young, friendly" },
  },
  {
    id: "Tur_24000",
    name: { ru: "Тарас", en: "Taras" },
    gender: "male",
    description: { ru: "Глубокий, выразительный", en: "Deep, expressive" },
  },
  {
    id: "Ost_24000",
    name: { ru: "Александра", en: "Alexandra" },
    gender: "female",
    description: { ru: "Мягкий, тёплый", en: "Soft, warm" },
  },
  {
    id: "Pon_24000",
    name: { ru: "Сергей", en: "Sergey" },
    gender: "male",
    description: { ru: "Энергичный, молодой", en: "Energetic, young" },
  },
];

/** Pick best SaluteSpeech voice for a character based on gender */
export function matchSaluteSpeechVoice(gender: string): string {
  const genderVoices = gender !== "unknown"
    ? SALUTESPEECH_VOICES.filter(v => v.gender === gender)
    : SALUTESPEECH_VOICES;
  return genderVoices[0]?.id ?? SALUTESPEECH_VOICES[0].id;
}
