// ─── Phrase Annotation Types & Config ─────────────────────────

export type AnnotationType =
  | "pause"
  | "emphasis"
  | "stress"
  | "whisper"
  | "slow"
  | "fast"
  | "joy"
  | "sadness"
  | "anger"
  | "sigh"
  | "cough"
  | "laugh"
  | "hmm";

export interface PhraseAnnotation {
  type: AnnotationType;
  /** Character offset within phrase text (for insertions like pause) */
  offset?: number;
  /** Start character offset (for range annotations) */
  start?: number;
  /** End character offset (for range annotations) */
  end?: number;
  /** Duration in ms (for pause) */
  durationMs?: number;
  /** Rate multiplier (for slow/fast) */
  rate?: number;
}

export type TtsProvider = "yandex" | "elevenlabs" | "proxyapi" | "salutespeech" | "unknown";

/** Whether an annotation is an insertion (at a point) vs a range selection */
export function isInsertionAnnotation(type: AnnotationType): boolean {
  return type === "pause" || type === "sigh" || type === "cough" || type === "laugh" || type === "hmm";
}

export interface AnnotationConfig {
  type: AnnotationType;
  label_ru: string;
  label_en: string;
  emoji: string;
  /** Which providers support this annotation inline */
  providers: TtsProvider[];
  /** Whether this needs a text range selection (vs cursor position) */
  needsRange: boolean;
}

export const ANNOTATION_CONFIGS: AnnotationConfig[] = [
  {
    type: "pause",
    label_ru: "⏸ Пауза",
    label_en: "⏸ Pause",
    emoji: "⏸",
    providers: ["yandex", "elevenlabs", "proxyapi"],
    needsRange: false,
  },
  {
    type: "emphasis",
    label_ru: "💪 Ударение",
    label_en: "💪 Emphasis",
    emoji: "💪",
    providers: ["yandex"],
    needsRange: true,
  },
  {
    type: "whisper",
    label_ru: "🤫 Шёпот",
    label_en: "🤫 Whisper",
    emoji: "🤫",
    providers: ["yandex"],
    needsRange: true,
  },
  {
    type: "slow",
    label_ru: "🐢 Медленно",
    label_en: "🐢 Slow",
    emoji: "🐢",
    providers: ["yandex"],
    needsRange: true,
  },
  {
    type: "fast",
    label_ru: "🐇 Быстро",
    label_en: "🐇 Fast",
    emoji: "🐇",
    providers: ["yandex"],
    needsRange: true,
  },
  {
    type: "joy",
    label_ru: "😊 Радость",
    label_en: "😊 Joy",
    emoji: "😊",
    providers: ["yandex", "elevenlabs", "proxyapi"],
    needsRange: true,
  },
  {
    type: "sadness",
    label_ru: "😢 Грусть",
    label_en: "😢 Sadness",
    emoji: "😢",
    providers: ["yandex", "elevenlabs", "proxyapi"],
    needsRange: true,
  },
  {
    type: "anger",
    label_ru: "😡 Злость",
    label_en: "😡 Anger",
    emoji: "😡",
    providers: ["yandex", "elevenlabs", "proxyapi"],
    needsRange: true,
  },
  {
    type: "sigh",
    label_ru: "😮‍💨 Вздох",
    label_en: "😮‍💨 Sigh",
    emoji: "😮‍💨",
    providers: ["yandex", "elevenlabs", "proxyapi"],
    needsRange: false,
  },
  {
    type: "cough",
    label_ru: "🤧 Кашель",
    label_en: "🤧 Cough",
    emoji: "🤧",
    providers: ["yandex", "elevenlabs", "proxyapi"],
    needsRange: false,
  },
  {
    type: "laugh",
    label_ru: "😂 Смех",
    label_en: "😂 Laugh",
    emoji: "😂",
    providers: ["yandex", "elevenlabs", "proxyapi"],
    needsRange: false,
  },
  {
    type: "hmm",
    label_ru: "🤔 Хмыканье",
    label_en: "🤔 Hmm",
    emoji: "🤔",
    providers: ["yandex", "elevenlabs", "proxyapi"],
    needsRange: false,
  },
];

/** Get available annotations for a given TTS provider */
export function getAvailableAnnotations(
  provider: TtsProvider,
  hasSelection: boolean
): AnnotationConfig[] {
  return ANNOTATION_CONFIGS.filter((a) => {
    if (!a.providers.includes(provider)) return false;
    if (a.needsRange && !hasSelection) return false;
    return true;
  });
}

/** Style config for rendering annotations */
export const ANNOTATION_STYLES: Record<
  AnnotationType,
  { className: string; prefix?: string; suffix?: string }
> = {
  pause: {
    className: "",
    prefix: " ⏸ ",
  },
  emphasis: {
    className: "font-bold text-amber-400",
  },
  stress: {
    className: "font-bold text-amber-300 underline decoration-solid decoration-amber-400",
  },
  whisper: {
    className: "italic text-purple-400/80",
    prefix: "🤫",
  },
  slow: {
    className: "underline decoration-dotted decoration-cyan-400/60 text-cyan-300",
    prefix: "🐢",
  },
  fast: {
    className: "underline decoration-dotted decoration-rose-400/60 text-rose-300",
    prefix: "🐇",
  },
  joy: {
    className: "text-yellow-400 font-medium",
    prefix: "😊",
  },
  sadness: {
    className: "text-blue-400 italic",
    prefix: "😢",
  },
  anger: {
    className: "font-bold text-red-400",
    prefix: "😡",
  },
  sigh: {
    className: "",
    prefix: " 😮‍💨 ",
  },
  cough: {
    className: "",
    prefix: " 🤧 ",
  },
  laugh: {
    className: "",
    prefix: " 😂 ",
  },
  hmm: {
    className: "",
    prefix: " 🤔 ",
  },
};

/** Resolve TTS provider from a voice_config object */
export function resolveProvider(voiceConfig: Record<string, unknown> | null | undefined): TtsProvider {
  if (!voiceConfig) return "unknown";
  const p = voiceConfig.provider as string | undefined;
  if (p === "elevenlabs") return "elevenlabs";
  if (p === "proxyapi" || p === "openai") return "proxyapi";
  if (p === "yandex" || !p) return "yandex"; // default to yandex
  return "unknown";
}
