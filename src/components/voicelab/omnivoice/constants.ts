/**
 * Shared constants for OmniVoice panel and subcomponents.
 */

export const OPENAI_PRESETS = [
  "alloy", "ash", "ballad", "cedar", "coral", "echo",
  "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse",
] as const;

/**
 * Full set of OmniVoice non-verbal control tags (https://github.com/k2-fsa/OmniVoice),
 * grouped by meaning for easy insertion from UI.
 */
export const NON_VERBAL_TAG_GROUPS: { label_ru: string; label_en: string; tags: string[] }[] = [
  {
    label_ru: "Эмоции", label_en: "Emotions",
    tags: ["[laughter]", "[sigh]", "[cry]", "[gasp]"],
  },
  {
    label_ru: "Подтверждения", label_en: "Confirmations",
    tags: ["[confirmation-en]", "[confirmation-mm]", "[confirmation-uhhuh]"],
  },
  {
    label_ru: "Вопросы", label_en: "Questions",
    tags: ["[question-en]", "[question-ah]", "[question-oh]", "[question-hmm]"],
  },
  {
    label_ru: "Удивление", label_en: "Surprise",
    tags: ["[surprise-ah]", "[surprise-oh]", "[surprise-wa]", "[surprise-yo]"],
  },
  {
    label_ru: "Прочее", label_en: "Other",
    tags: ["[dissatisfaction-hnn]", "[thinking-hmm]", "[breath]", "[cough]"],
  },
];

export const DEFAULT_SERVER_URL = "http://127.0.0.1:8880";
export const LOCAL_DEV_PROXY_PATH = "/api/omnivoice";
export const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

export type SynthMode = "design" | "clone" | "auto";
export type SynthStage = "idle" | "synthesizing" | "done" | "error";

export const COMBINING_ACUTE = "\u0301";
export const RU_VOWELS_RE = /[аеёиоуыэюяАЕЁИОУЫЭЮЯ]/;

export const normalizeServerUrl = (value: string) => value.trim().replace(/\/$/, "");
export const isDefaultLocalOmniVoiceServer = (value: string) =>
  /^https?:\/\/(?:127\.0\.0\.1|localhost):8880$/i.test(normalizeServerUrl(value));
