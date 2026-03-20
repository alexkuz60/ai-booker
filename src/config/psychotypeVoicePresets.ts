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
