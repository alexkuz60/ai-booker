/**
 * Psychotype → TTS Voice Presets
 *
 * Maps character accentuation (Leonhard) and archetype (timbral)
 * to provider-specific TTS parameters.
 *
 * Used by:
 * - Auto-casting (suggest 2-3 voice candidates per character)
 * - Segment-level TTS instructions (emotion/pace modifiers)
 *
 * References: PSYCHOTYPE_TTS_ANALYTICS.md
 */

// ─── Accentuation (Leonhard typology) ────────────────────

export const ACCENTUATION_OPTIONS = [
  "hyperthymic", "schizoid", "histerionic", "epileptoid",
  "depressive", "anxious", "emotive", "cycloid",
  "stuck", "demonstrative",
] as const;
export type Accentuation = typeof ACCENTUATION_OPTIONS[number];

export const ACCENTUATION_LABELS: Record<Accentuation, { ru: string; en: string }> = {
  hyperthymic:   { ru: "Гипертим", en: "Hyperthymic" },
  schizoid:      { ru: "Шизоид", en: "Schizoid" },
  histerionic:   { ru: "Истероид", en: "Histerionic" },
  epileptoid:    { ru: "Эпилептоид", en: "Epileptoid" },
  depressive:    { ru: "Депрессив", en: "Depressive" },
  anxious:       { ru: "Тревожный", en: "Anxious" },
  emotive:       { ru: "Эмотивный", en: "Emotive" },
  cycloid:       { ru: "Циклоид", en: "Cycloid" },
  stuck:         { ru: "Застревающий", en: "Stuck" },
  demonstrative: { ru: "Демонстративный", en: "Demonstrative" },
};

// ─── Timbral Archetype ───────────────────────────────────

export const ARCHETYPE_OPTIONS = [
  "sage", "hero", "caregiver", "trickster",
  "lover", "rebel",
] as const;
export type Archetype = typeof ARCHETYPE_OPTIONS[number];

export const ARCHETYPE_LABELS: Record<Archetype, { ru: string; en: string }> = {
  sage:      { ru: "Мудрец", en: "Sage" },
  hero:      { ru: "Герой", en: "Hero" },
  caregiver: { ru: "Опекун", en: "Caregiver" },
  trickster: { ru: "Трикстер", en: "Trickster" },
  lover:     { ru: "Любовник", en: "Lover" },
  rebel:     { ru: "Бунтарь", en: "Rebel" },
};

// ─── Provider-specific parameter shapes ──────────────────

export interface YandexVoicePreset {
  provider: "yandex";
  /** Preferred voice IDs, ordered by priority */
  voices_m: string[];
  voices_f: string[];
  role?: string;
  /** SSML prosody overrides */
  rate?: string;   // "slow" | "medium" | "fast"
  pitch?: string;  // "low" | "medium" | "high"
  volume?: string; // "soft" | "medium" | "loud"
}

export interface SaluteSpeechVoicePreset {
  provider: "salutespeech";
  voices_m: string[];
  voices_f: string[];
  rate?: number;   // 0.5–2.0
}

export interface ElevenLabsVoicePreset {
  provider: "elevenlabs";
  stability: number;       // 0–1
  similarity_boost: number;
  style: number;           // 0–1
}

export interface ProxyApiVoicePreset {
  provider: "proxyapi";
  voices_m: string[];
  voices_f: string[];
  model?: string;
  instructions?: string;
}

export type VoicePreset =
  | YandexVoicePreset
  | SaluteSpeechVoicePreset
  | ElevenLabsVoicePreset
  | ProxyApiVoicePreset;

// ─── Accentuation → ElevenLabs emotion params ────────────

export const ACCENTUATION_ELEVENLABS: Record<Accentuation, Pick<ElevenLabsVoicePreset, "stability" | "similarity_boost" | "style">> = {
  hyperthymic:   { stability: 0.25, similarity_boost: 0.70, style: 0.80 },
  schizoid:      { stability: 0.85, similarity_boost: 0.40, style: 0.10 },
  histerionic:   { stability: 0.15, similarity_boost: 0.75, style: 0.95 },
  epileptoid:    { stability: 0.80, similarity_boost: 0.60, style: 0.25 },
  depressive:    { stability: 0.70, similarity_boost: 0.50, style: 0.15 },
  anxious:       { stability: 0.30, similarity_boost: 0.55, style: 0.40 },
  emotive:       { stability: 0.35, similarity_boost: 0.70, style: 0.70 },
  cycloid:       { stability: 0.40, similarity_boost: 0.60, style: 0.55 },
  stuck:         { stability: 0.90, similarity_boost: 0.50, style: 0.10 },
  demonstrative: { stability: 0.20, similarity_boost: 0.75, style: 0.90 },
};

// ─── Accentuation → ProxyAPI (OpenAI TTS) instructions ───

export const ACCENTUATION_INSTRUCTIONS: Record<Accentuation, { ru: string; en: string }> = {
  hyperthymic:   { ru: "Говори бодро, энергично, с подъёмом и быстрым темпом", en: "Speak energetically, upbeat, fast pace with enthusiasm" },
  schizoid:      { ru: "Говори ровно, сдержанно, монотонно, без эмоций", en: "Speak in a flat, reserved, monotone manner with minimal emotion" },
  histerionic:   { ru: "Говори ярко, театрально, с резкими перепадами интонации", en: "Speak theatrically with dramatic pitch shifts and vivid expression" },
  epileptoid:    { ru: "Говори чётко, размеренно, властно, без спешки", en: "Speak clearly, measured, authoritative, unhurried" },
  depressive:    { ru: "Говори тихо, медленно, с грустью и усталостью в голосе", en: "Speak softly, slowly, with sadness and weariness" },
  anxious:       { ru: "Говори нервно, с колебаниями, чуть быстрее обычного", en: "Speak nervously, with hesitations, slightly faster than normal" },
  emotive:       { ru: "Говори тепло, мягко, с сопереживанием и плавными интонациями", en: "Speak warmly, gently, with empathy and smooth intonation" },
  cycloid:       { ru: "Говори с переменчивой интонацией — то живо, то устало", en: "Speak with shifting intonation — sometimes lively, sometimes tired" },
  stuck:         { ru: "Говори настойчиво, с нажимом, повторяя ключевые слова", en: "Speak insistently, with emphasis, repeating key words" },
  demonstrative: { ru: "Говори эффектно, с выразительными паузами и акцентами", en: "Speak dramatically with expressive pauses and accents" },
};

// ─── Accentuation → Yandex role mapping ──────────────────

export const ACCENTUATION_YANDEX_ROLE: Record<Accentuation, string> = {
  hyperthymic:   "good",
  schizoid:      "neutral",
  histerionic:   "evil",
  epileptoid:    "strict",
  depressive:    "whisper",
  anxious:       "neutral",
  emotive:       "friendly",
  cycloid:       "neutral",
  stuck:         "strict",
  demonstrative: "good",
};

// ─── Archetype → preferred Yandex voices ─────────────────

export const ARCHETYPE_YANDEX_VOICES: Record<Archetype, { m: string[]; f: string[] }> = {
  sage:      { m: ["zahar", "ermil", "alexander"], f: ["omazh", "julia"] },
  hero:      { m: ["alexander", "kirill", "madirus"], f: ["dasha", "alena"] },
  caregiver: { m: ["kirill", "anton"], f: ["alena", "jane"] },
  trickster: { m: ["filipp", "anton"], f: ["masha", "lera"] },
  lover:     { m: ["anton", "kirill"], f: ["dasha", "marina"] },
  rebel:     { m: ["madirus", "alexander"], f: ["lera", "dasha"] },
};

// ─── Archetype → preferred ProxyAPI (OpenAI) voices ──────

export const ARCHETYPE_PROXYAPI_VOICES: Record<Archetype, { m: string[]; f: string[] }> = {
  sage:      { m: ["onyx", "echo"], f: ["nova", "shimmer"] },
  hero:      { m: ["onyx", "fable"], f: ["nova", "alloy"] },
  caregiver: { m: ["echo", "fable"], f: ["shimmer", "nova"] },
  trickster: { m: ["fable", "echo"], f: ["alloy", "shimmer"] },
  lover:     { m: ["echo", "onyx"], f: ["shimmer", "nova"] },
  rebel:     { m: ["onyx", "fable"], f: ["alloy", "nova"] },
};

// ─── Segment type → TTS mode modifiers ──────────────────

export interface SegmentTtsModifier {
  rateMultiplier: number;   // applied on top of character speed
  volumeOffsetDb: number;   // dB offset
  instructions?: { ru: string; en: string };
}

export const SEGMENT_TYPE_TTS_MODIFIERS: Record<string, SegmentTtsModifier> = {
  dialogue:      { rateMultiplier: 1.0,  volumeOffsetDb: 0,  instructions: undefined },
  monologue:     { rateMultiplier: 0.95, volumeOffsetDb: -1, instructions: { ru: "Произнеси как внутренний монолог, чуть медленнее", en: "Deliver as an inner monologue, slightly slower" } },
  inner_thought: { rateMultiplier: 0.90, volumeOffsetDb: -3, instructions: { ru: "Тихо, задумчиво, как мысли вслух, близкий микрофон", en: "Quiet, contemplative, like thinking aloud, close mic" } },
  narrator:      { rateMultiplier: 1.0,  volumeOffsetDb: 0,  instructions: { ru: "Повествование, нейтральная подача", en: "Narration, neutral delivery" } },
  first_person:  { rateMultiplier: 1.0,  volumeOffsetDb: 0,  instructions: { ru: "Повествование от первого лица", en: "First-person narration" } },
  lyric:         { rateMultiplier: 0.85, volumeOffsetDb: -2, instructions: { ru: "Певуче, ритмично, с поэтической интонацией", en: "Melodic, rhythmic, with poetic intonation" } },
  epigraph:      { rateMultiplier: 0.90, volumeOffsetDb: -2, instructions: { ru: "Возвышенно, торжественно", en: "Elevated, solemn" } },
  footnote:      { rateMultiplier: 1.05, volumeOffsetDb: -2, instructions: { ru: "Быстро, информативно, нейтрально", en: "Quick, informative, neutral" } },
  telephone:     { rateMultiplier: 1.0,  volumeOffsetDb: -1, instructions: { ru: "Как по телефону — чуть приглушённо", en: "As if on the phone — slightly muffled" } },
  remark:        { rateMultiplier: 1.0,  volumeOffsetDb: 0,  instructions: undefined },
};

// ─── Scene mood → Narrator TTS instructions ─────────────
// These are applied to narrator/first_person segments to convey the scene atmosphere.

export interface MoodTtsPreset {
  rateMultiplier: number;
  roleHint?: string;           // Yandex role hint (if applicable)
  instructions: { ru: string; en: string };
}

export const MOOD_TTS_INSTRUCTIONS: Record<string, MoodTtsPreset> = {
  // Tension / action
  tense:       { rateMultiplier: 1.05, instructions: { ru: "Напряжённо, тревожно, с нарастающей энергией", en: "Tense, anxious, with rising energy" } },
  action:      { rateMultiplier: 1.10, instructions: { ru: "Динамично, энергично, быстрый темп повествования", en: "Dynamic, energetic, fast-paced narration" } },
  suspense:    { rateMultiplier: 0.95, instructions: { ru: "С нагнетанием, паузы между фразами, предчувствие", en: "Building tension, pauses between phrases, foreboding" } },
  // Calm / reflective
  calm:        { rateMultiplier: 0.95, instructions: { ru: "Спокойно, размеренно, мягкая интонация", en: "Calm, measured, soft intonation" } },
  reflective:  { rateMultiplier: 0.90, instructions: { ru: "Задумчиво, медленно, с паузами для осмысления", en: "Thoughtful, slow, with pauses for reflection" } },
  nostalgic:   { rateMultiplier: 0.90, roleHint: "good", instructions: { ru: "С теплотой и ностальгией, мягкий тон", en: "With warmth and nostalgia, gentle tone" } },
  // Emotional
  sad:         { rateMultiplier: 0.90, roleHint: "neutral", instructions: { ru: "Грустно, тихо, нисходящие интонации", en: "Sad, quiet, descending intonations" } },
  joyful:      { rateMultiplier: 1.05, roleHint: "good", instructions: { ru: "Радостно, бодро, с улыбкой в голосе", en: "Joyful, cheerful, with a smile in the voice" } },
  romantic:    { rateMultiplier: 0.95, instructions: { ru: "Нежно, интимно, с теплотой", en: "Tender, intimate, warm" } },
  angry:       { rateMultiplier: 1.05, roleHint: "evil", instructions: { ru: "Резко, жёстко, с внутренней агрессией", en: "Sharp, harsh, with underlying aggression" } },
  // Atmosphere
  dark:        { rateMultiplier: 0.95, roleHint: "evil", instructions: { ru: "Мрачно, зловеще, низкий тон", en: "Dark, ominous, low tone" } },
  mysterious:  { rateMultiplier: 0.90, instructions: { ru: "Загадочно, с интригой, понижая голос", en: "Mysterious, intriguing, lowering the voice" } },
  epic:        { rateMultiplier: 0.95, instructions: { ru: "Эпично, торжественно, масштабно", en: "Epic, solemn, grand scale" } },
  ironic:      { rateMultiplier: 1.0,  instructions: { ru: "С иронией и лёгкой усмешкой", en: "With irony and a slight smirk" } },
  dramatic:    { rateMultiplier: 0.95, instructions: { ru: "Драматично, с эмоциональным накалом", en: "Dramatic, with emotional intensity" } },
  humorous:    { rateMultiplier: 1.05, roleHint: "good", instructions: { ru: "С юмором, легко, игриво", en: "Humorous, light, playful" } },
  horror:      { rateMultiplier: 0.90, roleHint: "evil", instructions: { ru: "Пугающе, шёпотом, с жуткими паузами", en: "Frightening, whispered, with eerie pauses" } },
};

// ─── Scene type → Narrator pace/style hints ─────────────

export const SCENE_TYPE_NARRATOR_HINTS: Record<string, { ru: string; en: string }> = {
  action:            { ru: "Сцена действия — подчеркни динамику", en: "Action scene — emphasize dynamics" },
  dialogue:          { ru: "Диалоговая сцена — ровная подача между репликами", en: "Dialogue scene — steady delivery between lines" },
  description:       { ru: "Описательная сцена — выразительно, с акцентом на образах", en: "Descriptive scene — expressive, focus on imagery" },
  inner_monologue:   { ru: "Внутренний монолог — интимно, замедленно", en: "Inner monologue — intimate, slowed down" },
  lyrical_digression:{ ru: "Лирическое отступление — певуче, с паузами", en: "Lyrical digression — melodic, with pauses" },
  mixed:             { ru: "Смешанная сцена — адаптируй подачу к контексту", en: "Mixed scene — adapt delivery to context" },
};

/**
 * Build combined TTS context for a narrator segment based on scene mood + scene_type.
 * Returns rate multiplier, optional Yandex role override, and combined instruction string.
 */
export function buildSceneTtsContext(
  mood: string | null | undefined,
  sceneType: string | null | undefined,
  segmentType: string,
  lang: "ru" | "en" = "en",
): {
  rateMultiplier: number;
  roleHint?: string;
  instructions: string;
} {
  const parts: string[] = [];
  let rate = 1.0;
  let roleHint: string | undefined;

  // 1. Segment type modifier
  const segMod = SEGMENT_TYPE_TTS_MODIFIERS[segmentType];
  if (segMod) {
    rate *= segMod.rateMultiplier;
    if (segMod.instructions) parts.push(segMod.instructions[lang]);
  }

  // 2. Scene mood (overrides segment defaults for narrator-like segments)
  const moodKey = mood?.toLowerCase().replace(/\s+/g, "_");
  const moodPreset = moodKey ? MOOD_TTS_INSTRUCTIONS[moodKey] : undefined;
  if (moodPreset) {
    rate *= moodPreset.rateMultiplier;
    if (moodPreset.roleHint) roleHint = moodPreset.roleHint;
    parts.push(moodPreset.instructions[lang]);
  }

  // 3. Scene type hint (lighter, only for context)
  const stKey = sceneType?.toLowerCase().replace(/\s+/g, "_");
  const stHint = stKey ? SCENE_TYPE_NARRATOR_HINTS[stKey] : undefined;
  if (stHint) {
    parts.push(stHint[lang]);
  }

  return {
    rateMultiplier: Math.round(rate * 1000) / 1000,
    roleHint,
    instructions: parts.filter(Boolean).join(". "),
  };
}

// ─── Utility: build voice candidates for a character ─────

export interface VoiceCandidate {
  provider: string;
  voiceId: string;
  voiceName?: string;
  role?: string;
  score: number; // 0–100, higher = better match
  reason: string;
}

// Age-based preferences (same heuristic as matchVoice in CharactersPanel)
const AGE_VOICE_PREFS: Record<string, Record<string, string[]>> = {
  female: {
    child:  ["masha", "julia"],
    teen:   ["masha", "lera"],
    young:  ["dasha", "lera", "marina"],
    adult:  ["alena", "jane", "marina"],
    elder:  ["omazh", "julia"],
    infant: ["masha"],
  },
  male: {
    child:  ["filipp"],
    teen:   ["filipp", "anton"],
    young:  ["anton", "alexander"],
    adult:  ["kirill", "alexander", "madirus"],
    elder:  ["zahar", "ermil"],
    infant: ["filipp"],
  },
};

/**
 * Suggest up to `limit` voice candidates based on character psycho profile.
 * Always returns at least 1 candidate via age/gender fallback.
 */
export function suggestVoiceCandidates(
  opts: {
    gender: string;
    ageGroup: string;
    temperament: string | null;
    speechTags: string[];
    psychoTags: string[];
    provider: string;
  },
  limit = 3,
): VoiceCandidate[] {
  const accentuation = detectAccentuation(opts.psychoTags);
  const archetype = detectArchetype(opts.psychoTags);
  const candidates: VoiceCandidate[] = [];
  const g = opts.gender === "female" ? "f" : "m";
  const seen = new Set<string>();

  const addCandidate = (c: VoiceCandidate) => {
    const key = `${c.provider}:${c.voiceId}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  };

  if (opts.provider === "yandex" || !opts.provider) {
    const role = accentuation ? ACCENTUATION_YANDEX_ROLE[accentuation] : undefined;

    // 1. Archetype-based voices (highest priority)
    if (archetype) {
      const archVoices = ARCHETYPE_YANDEX_VOICES[archetype]?.[g] ?? [];
      for (const voiceId of archVoices) {
        addCandidate({
          provider: "yandex", voiceId, role,
          score: 90, reason: `archetype:${archetype}`,
        });
      }
    }

    // 2. Age/gender fallback
    const gKey = opts.gender === "female" ? "female" : "male";
    const ageVoices = AGE_VOICE_PREFS[gKey]?.[opts.ageGroup] ?? AGE_VOICE_PREFS[gKey]?.["adult"] ?? [];
    for (const voiceId of ageVoices) {
      addCandidate({
        provider: "yandex", voiceId, role,
        score: 60, reason: `age:${opts.ageGroup}`,
      });
    }
  }

  if (opts.provider === "proxyapi") {
    // 1. Archetype voices
    if (archetype) {
      const archVoices = ARCHETYPE_PROXYAPI_VOICES[archetype]?.[g] ?? [];
      for (const voiceId of archVoices) {
        const instr = accentuation ? ACCENTUATION_INSTRUCTIONS[accentuation] : undefined;
        addCandidate({
          provider: "proxyapi", voiceId,
          score: 90, reason: `archetype:${archetype}`,
          role: instr?.en,
        });
      }
    }
    // 2. Gender fallback
    const fallback = g === "f" ? ["nova", "shimmer", "alloy"] : ["onyx", "echo", "fable"];
    for (const voiceId of fallback) {
      addCandidate({
        provider: "proxyapi", voiceId,
        score: 50, reason: "gender match",
      });
    }
  }

  // Sort by score desc, take top N
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}

// ─── Tag parsers ─────────────────────────────────────────

/** Try to detect accentuation from psycho_tags like "#гипертим" or "#hyperthymic" */
export function detectAccentuation(tags: string[]): Accentuation | null {
  const lower = tags.map(t => t.replace(/^#/, "").toLowerCase());
  for (const acc of ACCENTUATION_OPTIONS) {
    if (lower.includes(acc)) return acc;
    const ruLabel = ACCENTUATION_LABELS[acc].ru.toLowerCase();
    if (lower.includes(ruLabel)) return acc;
  }
  return null;
}

/** Try to detect archetype from psycho_tags like "#мудрец" or "#sage" */
export function detectArchetype(tags: string[]): Archetype | null {
  const lower = tags.map(t => t.replace(/^#/, "").toLowerCase());
  for (const arch of ARCHETYPE_OPTIONS) {
    if (lower.includes(arch)) return arch;
    const ruLabel = ARCHETYPE_LABELS[arch].ru.toLowerCase();
    if (lower.includes(ruLabel)) return arch;
  }
  return null;
}

// ─── Accentuation/Archetype → OmniVoice Advanced Params (Phase 2) ─

import {
  DEFAULT_ADVANCED_PARAMS,
  type OmniVoiceAdvancedParams,
} from "@/components/voicelab/omnivoice/constants";

/**
 * Per-accentuation BASE for OmniVoice generation knobs.
 *
 * Driving idea (Phase 2 — to be tuned empirically):
 *   • num_step           — accentuations that need crisp diction & control
 *                          (epileptoid, schizoid, stuck) get more steps.
 *                          Hyperthymic/histerionic accept fewer steps for
 *                          spontaneity.
 *   • guidance_scale     — accentuations with strong "tight" delivery
 *                          (epileptoid, stuck, schizoid) get higher CFG.
 *                          Emotive/cycloid keep CFG closer to default.
 *   • t_shift            — kept neutral (1.0) — only modulated by archetype.
 *   • position_temperature / class_temperature — kept at base 1.0 here;
 *                          archetype layer modulates them for timbre.
 *   • denoise            — off by default; only theatrical/dramatic
 *                          accentuations request it for cleaner take.
 */
export const ACCENTUATION_OMNIVOICE_PARAMS: Record<Accentuation, OmniVoiceAdvancedParams> = {
  hyperthymic:   { guidance_scale: 2.8, num_step: 28, t_shift: 1.0, position_temperature: 1.0, class_temperature: 1.0, denoise: false },
  schizoid:      { guidance_scale: 3.5, num_step: 40, t_shift: 1.0, position_temperature: 1.0, class_temperature: 1.0, denoise: false },
  histerionic:   { guidance_scale: 2.5, num_step: 28, t_shift: 1.0, position_temperature: 1.0, class_temperature: 1.0, denoise: true  },
  epileptoid:    { guidance_scale: 3.8, num_step: 44, t_shift: 1.0, position_temperature: 1.0, class_temperature: 1.0, denoise: false },
  depressive:    { guidance_scale: 3.2, num_step: 36, t_shift: 1.0, position_temperature: 1.0, class_temperature: 1.0, denoise: false },
  anxious:       { guidance_scale: 2.7, num_step: 32, t_shift: 1.0, position_temperature: 1.0, class_temperature: 1.0, denoise: false },
  emotive:       { guidance_scale: 3.0, num_step: 36, t_shift: 1.0, position_temperature: 1.0, class_temperature: 1.0, denoise: false },
  cycloid:       { guidance_scale: 3.0, num_step: 32, t_shift: 1.0, position_temperature: 1.0, class_temperature: 1.0, denoise: false },
  stuck:         { guidance_scale: 3.6, num_step: 40, t_shift: 1.0, position_temperature: 1.0, class_temperature: 1.0, denoise: false },
  demonstrative: { guidance_scale: 2.6, num_step: 32, t_shift: 1.0, position_temperature: 1.0, class_temperature: 1.0, denoise: true  },
};

/**
 * Per-archetype timbral modulation applied ON TOP of accentuation base.
 *
 * We modulate position_temperature & class_temperature (the "liveliness"
 * knobs) and very mildly t_shift, leaving num_step / guidance_scale to
 * the accentuation layer which controls structural delivery.
 *
 * Multipliers are clamped against the slider ranges in the resolver below.
 */
type ArchetypeMod = {
  positionTempMul: number;
  classTempMul: number;
  tShift: number; // absolute, not multiplier
};

export const ARCHETYPE_OMNIVOICE_MODIFIERS: Record<Archetype, ArchetypeMod> = {
  sage:      { positionTempMul: 0.85, classTempMul: 0.85, tShift: 1.00 }, // measured, contemplative
  hero:      { positionTempMul: 1.05, classTempMul: 1.00, tShift: 1.00 }, // confident, slightly assertive
  caregiver: { positionTempMul: 0.95, classTempMul: 0.95, tShift: 1.00 }, // warm, gentle
  trickster: { positionTempMul: 1.30, classTempMul: 1.25, tShift: 1.05 }, // playful, unpredictable
  lover:     { positionTempMul: 1.10, classTempMul: 1.10, tShift: 1.05 }, // expressive, intimate
  rebel:     { positionTempMul: 1.20, classTempMul: 1.15, tShift: 0.95 }, // edgy, defiant
};

const PARAM_RANGES: Record<keyof OmniVoiceAdvancedParams, { min: number; max: number }> = {
  guidance_scale:       { min: 1.0, max: 7.0 },
  num_step:             { min: 4,   max: 64  },
  t_shift:              { min: 0.5, max: 2.0 },
  position_temperature: { min: 0.1, max: 2.0 },
  class_temperature:    { min: 0.1, max: 2.0 },
  denoise:              { min: 0,   max: 1   }, // unused, kept for type-uniformity
};

const clamp = (v: number, k: keyof OmniVoiceAdvancedParams) => {
  const r = PARAM_RANGES[k];
  return Math.min(r.max, Math.max(r.min, v));
};

/**
 * Compute OmniVoice Advanced params from psychotype:
 *   1. Start from accentuation base (or DEFAULT if unknown).
 *   2. Apply archetype modulation to temperature/t_shift.
 *   3. Round to slider step (num_step → int; others → 2 decimals).
 *
 * Returns the FULL 6-field snapshot ready to write into
 * `voice_config.omnivoice_advanced.params` (Snapshot+source storage).
 */
export function resolveOmniVoiceAdvanced(
  accentuation: Accentuation | null,
  archetype: Archetype | null,
): OmniVoiceAdvancedParams {
  const base: OmniVoiceAdvancedParams = accentuation
    ? { ...ACCENTUATION_OMNIVOICE_PARAMS[accentuation] }
    : { ...DEFAULT_ADVANCED_PARAMS };

  const mod = archetype ? ARCHETYPE_OMNIVOICE_MODIFIERS[archetype] : null;
  if (mod) {
    base.position_temperature = clamp(base.position_temperature * mod.positionTempMul, "position_temperature");
    base.class_temperature    = clamp(base.class_temperature    * mod.classTempMul,    "class_temperature");
    base.t_shift              = clamp(mod.tShift,                                       "t_shift");
  }

  // Round for clean slider snapping
  return {
    guidance_scale:       Math.round(base.guidance_scale       * 10) / 10,
    num_step:             Math.round(base.num_step),
    t_shift:              Math.round(base.t_shift              * 100) / 100,
    position_temperature: Math.round(base.position_temperature * 100) / 100,
    class_temperature:    Math.round(base.class_temperature    * 100) / 100,
    denoise:              base.denoise,
  };
}

/**
 * Convenience: resolve directly from a character's psycho_tags.
 * Returns `null` if neither accentuation nor archetype could be detected
 * (caller should keep current Advanced values untouched in that case).
 */
export function resolveOmniVoiceAdvancedFromTags(
  psychoTags: string[] | null | undefined,
): { params: OmniVoiceAdvancedParams; accentuation: Accentuation | null; archetype: Archetype | null } | null {
  const tags = psychoTags ?? [];
  const accentuation = detectAccentuation(tags);
  const archetype    = detectArchetype(tags);
  if (!accentuation && !archetype) return null;
  return {
    params: resolveOmniVoiceAdvanced(accentuation, archetype),
    accentuation,
    archetype,
  };
}
