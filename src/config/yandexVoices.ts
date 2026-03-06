// Yandex SpeechKit voice registry

export interface YandexVoice {
  id: string;
  name: { ru: string; en: string };
  gender: "male" | "female";
  lang: string;
  apiVersion: "v1" | "v3" | "both";
  roles?: string[];
}

export const YANDEX_VOICES: YandexVoice[] = [
  // v1+v3
  { id: "alena", name: { ru: "Алёна", en: "Alena" }, gender: "female", lang: "ru", apiVersion: "both", roles: ["neutral", "good"] },
  { id: "filipp", name: { ru: "Филипп", en: "Filipp" }, gender: "male", lang: "ru", apiVersion: "both" },
  { id: "ermil", name: { ru: "Ермил", en: "Ermil" }, gender: "male", lang: "ru", apiVersion: "both", roles: ["neutral", "good"] },
  { id: "jane", name: { ru: "Джейн", en: "Jane" }, gender: "female", lang: "ru", apiVersion: "both", roles: ["neutral", "good", "evil"] },
  { id: "madirus", name: { ru: "Мадирус", en: "Madirus" }, gender: "male", lang: "ru", apiVersion: "both" },
  { id: "omazh", name: { ru: "Омаж", en: "Omazh" }, gender: "female", lang: "ru", apiVersion: "both", roles: ["neutral", "evil"] },
  { id: "zahar", name: { ru: "Захар", en: "Zahar" }, gender: "male", lang: "ru", apiVersion: "both", roles: ["neutral", "good"] },
  // v3-only
  { id: "dasha", name: { ru: "Даша", en: "Dasha" }, gender: "female", lang: "ru", apiVersion: "v3", roles: ["neutral", "friendly", "strict"] },
  { id: "julia", name: { ru: "Юлия", en: "Julia" }, gender: "female", lang: "ru", apiVersion: "v3", roles: ["neutral", "strict"] },
  { id: "lera", name: { ru: "Лера", en: "Lera" }, gender: "female", lang: "ru", apiVersion: "v3", roles: ["neutral", "friendly"] },
  { id: "masha", name: { ru: "Маша", en: "Masha" }, gender: "female", lang: "ru", apiVersion: "v3", roles: ["neutral", "friendly", "strict"] },
  { id: "marina", name: { ru: "Марина", en: "Marina" }, gender: "female", lang: "ru", apiVersion: "v3", roles: ["neutral", "whisper", "friendly"] },
  { id: "alexander", name: { ru: "Александр", en: "Alexander" }, gender: "male", lang: "ru", apiVersion: "v3", roles: ["neutral", "good"] },
  { id: "kirill", name: { ru: "Кирилл", en: "Kirill" }, gender: "male", lang: "ru", apiVersion: "v3", roles: ["neutral", "strict", "good"] },
  { id: "anton", name: { ru: "Антон", en: "Anton" }, gender: "male", lang: "ru", apiVersion: "v3", roles: ["neutral", "good"] },
  // English
  { id: "john", name: { ru: "Джон", en: "John" }, gender: "male", lang: "en", apiVersion: "both" },
];

export const ROLE_LABELS: Record<string, { ru: string; en: string }> = {
  neutral: { ru: "Нейтральный", en: "Neutral" },
  good: { ru: "Радостный", en: "Cheerful" },
  evil: { ru: "Раздражённый", en: "Irritated" },
  friendly: { ru: "Дружелюбный", en: "Friendly" },
  strict: { ru: "Строгий", en: "Strict" },
  whisper: { ru: "Шёпот", en: "Whisper" },
};
