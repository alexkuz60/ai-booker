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

/**
 * Advanced synthesis parameters (Phase 1 experimentation).
 * Mirrors the OmniVoice server REST contract for /v1/audio/speech.
 *  - guidance_scale       — CFG strength (consistency vs naturalness)
 *  - num_step             — diffusion steps (quality vs latency)
 *  - t_shift              — noise schedule shift
 *  - position_temperature — voice diversity / intonation variety
 *  - class_temperature    — token sampling "liveliness"
 *  - denoise              — enable on-server denoising
 */
export interface OmniVoiceAdvancedParams {
  guidance_scale: number;
  num_step: number;
  t_shift: number;
  position_temperature: number;
  class_temperature: number;
  denoise: boolean;
}

export const DEFAULT_ADVANCED_PARAMS: OmniVoiceAdvancedParams = {
  guidance_scale: 3.0,
  num_step: 32,
  t_shift: 1.0,
  position_temperature: 1.0,
  class_temperature: 1.0,
  denoise: false,
};

export interface AdvancedPreset {
  id: "draft" | "standard" | "final";
  label_ru: string;
  label_en: string;
  description_ru: string;
  description_en: string;
  params: OmniVoiceAdvancedParams;
}

export const ADVANCED_PRESETS: AdvancedPreset[] = [
  {
    id: "draft",
    label_ru: "Черновик",
    label_en: "Draft",
    description_ru: "Быстро, для проверки",
    description_en: "Fast, for previewing",
    params: { guidance_scale: 2.5, num_step: 12, t_shift: 1.0, position_temperature: 1.0, class_temperature: 1.0, denoise: false },
  },
  {
    id: "standard",
    label_ru: "Стандарт",
    label_en: "Standard",
    description_ru: "Баланс качества и скорости",
    description_en: "Balanced quality and speed",
    params: { ...DEFAULT_ADVANCED_PARAMS },
  },
  {
    id: "final",
    label_ru: "Финал",
    label_en: "Final",
    description_ru: "Максимальное качество",
    description_en: "Maximum quality",
    params: { guidance_scale: 3.5, num_step: 64, t_shift: 1.0, position_temperature: 1.0, class_temperature: 1.0, denoise: true },
  },
];

export const COMBINING_ACUTE = "\u0301";
export const RU_VOWELS_RE = /[аеёиоуыэюяАЕЁИОУЫЭЮЯ]/;

export const normalizeServerUrl = (value: string) => value.trim().replace(/\/$/, "");
export const isDefaultLocalOmniVoiceServer = (value: string) =>
  /^https?:\/\/(?:127\.0\.0\.1|localhost):8880$/i.test(normalizeServerUrl(value));
