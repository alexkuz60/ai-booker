/**
 * AI Role Registry — defines specialized AI agent roles,
 * their default models, and system prompts.
 *
 * Each role maps to a specific task category with an appropriate
 * model tier: lightweight tasks → flash-lite, medium → flash, heavy → pro.
 */

export type AiRoleId =
  | "translator"
  | "proofreader"
  | "screenwriter"
  | "director"
  | "profiler"
  | "sound_engineer";

export interface AiRoleDefinition {
  id: AiRoleId;
  labelRu: string;
  labelEn: string;
  descriptionRu: string;
  descriptionEn: string;
  /** Default model for admin (Lovable AI) */
  defaultModelAdmin: string;
  /** Default model for regular users (external providers) */
  defaultModelUser: string;
  /** Model tier hint: lite | standard | heavy */
  tier: "lite" | "standard" | "heavy";
  /** Whether this role supports a multi-model pool for parallel batch processing */
  poolable: boolean;
  /** System prompt template for this role */
  systemPrompt: string;
}

export const AI_ROLES: Record<AiRoleId, AiRoleDefinition> = {
  translator: {
    id: "translator",
    labelRu: "Переводчик",
    labelEn: "Translator",
    descriptionRu: "Перевод поисковых запросов, адаптация текста",
    descriptionEn: "Search query translation, text adaptation",
    defaultModelAdmin: "google/gemini-2.5-flash-lite",
    defaultModelUser: "google/gemini-2.5-flash-lite",
    tier: "lite",
    poolable: false,
    systemPrompt:
      "You are a professional translator. Translate concisely and naturally. " +
      "Preserve meaning and tone. Return ONLY the translation, no explanations.",
  },

  proofreader: {
    id: "proofreader",
    labelRu: "Корректор",
    labelEn: "Proofreader",
    descriptionRu: "Правка текста, ударения, пунктуация, SSML-разметка",
    descriptionEn: "Text correction, stress marks, punctuation, SSML markup",
    defaultModelAdmin: "google/gemini-2.5-flash",
    defaultModelUser: "google/gemini-2.5-flash",
    tier: "standard",
    poolable: true,
    systemPrompt:
      "You are an expert Russian-language proofreader and SSML specialist. " +
      "Fix grammar, punctuation, and add stress marks (ударения) where needed for TTS synthesis. " +
      "Preserve the author's style and voice. Output corrected text only.",
  },

  screenwriter: {
    id: "screenwriter",
    labelRu: "Сценарист",
    labelEn: "Screenwriter",
    descriptionRu: "Сегментация текста, определение сцен и типов сегментов",
    descriptionEn: "Text segmentation, scene detection, segment type classification",
    defaultModelAdmin: "google/gemini-2.5-flash",
    defaultModelUser: "google/gemini-2.5-flash",
    tier: "standard",
    systemPrompt:
      "You are an audiobook screenwriter and dramaturg. " +
      "Analyze literary text structure: identify scenes, segment types (narrator, dialogue, " +
      "inner_thought, first_person, epigraph, lyric, footnote), speaker attribution, " +
      "and emotional beats. Be precise with segment boundaries.",
  },

  director: {
    id: "director",
    labelRu: "Режиссёр",
    labelEn: "Director",
    descriptionRu: "Темп, паузы, эмоциональный рисунок, распределение голосов",
    descriptionEn: "Pacing, pauses, emotional arc, voice casting direction",
    defaultModelAdmin: "google/gemini-2.5-pro",
    defaultModelUser: "google/gemini-2.5-pro",
    tier: "heavy",
    systemPrompt:
      "You are an experienced audiobook director and dramaturg. " +
      "Analyze chapters for pacing, emotional arc, and dramatic tension. " +
      "Define BPM (reading tempo), silence durations between scenes, mood transitions, " +
      "and voice casting recommendations based on character psychology and scene dynamics. " +
      "Consider the listener's experience: build tension, provide relief, manage fatigue.",
  },

  profiler: {
    id: "profiler",
    labelRu: "Профайлер",
    labelEn: "Profiler",
    descriptionRu: "Глубокий анализ персонажей: психотип, речевой стиль, темперамент",
    descriptionEn: "Deep character analysis: psychotype, speech style, temperament",
    defaultModelAdmin: "google/gemini-2.5-pro",
    defaultModelUser: "google/gemini-2.5-pro",
    tier: "heavy",
    systemPrompt:
      "You are an expert literary psychologist and character profiler. " +
      "Analyze characters deeply: determine gender, age group, temperament (sanguine/choleric/" +
      "melancholic/phlegmatic), speech style, emotional range, and distinctive traits. " +
      "Base analysis on dialogue patterns, actions, and narrative descriptions. " +
      "Be specific and evidence-based.",
  },

  sound_engineer: {
    id: "sound_engineer",
    labelRu: "Звукоинженер",
    labelEn: "Sound Engineer",
    descriptionRu: "Генерация промптов для SFX, атмосферы и музыки",
    descriptionEn: "Prompt generation for SFX, atmosphere, and music",
    defaultModelAdmin: "google/gemini-2.5-flash",
    defaultModelUser: "google/gemini-2.5-flash",
    tier: "standard",
    systemPrompt:
      "You are a professional sound designer for audiobooks. " +
      "Generate precise, evocative prompts for sound effects, ambient atmosphere, " +
      "and background music. Consider the emotional tone, setting, and pacing of each scene. " +
      "Output concise English prompts optimized for AI sound generation.",
  },
};

/** Ordered list for UI display */
export const AI_ROLE_LIST: AiRoleDefinition[] = [
  AI_ROLES.translator,
  AI_ROLES.proofreader,
  AI_ROLES.screenwriter,
  AI_ROLES.director,
  AI_ROLES.profiler,
  AI_ROLES.sound_engineer,
];

/** Tier labels for UI */
export const TIER_LABELS = {
  lite: { ru: "Лёгкая", en: "Light" },
  standard: { ru: "Средняя", en: "Standard" },
  heavy: { ru: "Тяжёлая", en: "Heavy" },
} as const;

/** User-overridable mapping: roleId → modelId */
export type AiRoleModelMap = Partial<Record<AiRoleId, string>>;

/** Get default model map for admin */
export function getDefaultAdminModels(): Record<AiRoleId, string> {
  return Object.fromEntries(
    AI_ROLE_LIST.map((r) => [r.id, r.defaultModelAdmin])
  ) as Record<AiRoleId, string>;
}

/** Get default model map for regular users */
export function getDefaultUserModels(): Record<AiRoleId, string> {
  return Object.fromEntries(
    AI_ROLE_LIST.map((r) => [r.id, r.defaultModelUser])
  ) as Record<AiRoleId, string>;
}
