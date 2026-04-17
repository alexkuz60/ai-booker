/**
 * omniVoiceInstructions — Build English voice-design instructions
 * for OmniVoice / OpenAI gpt-4o-mini-tts from Booker character profiles.
 *
 * Two-layer architecture:
 *   1) Deterministic mapping (this module) covers ~80% of profile fields
 *      using static EN dictionaries — fast, free, offline.
 *   2) AI-translated free-text fields (`description`, `speech_style`)
 *      are produced by the `translate-character-fields` edge function
 *      and cached in `voice_config.omnivoice_cache` (handled elsewhere).
 *
 * The model (gpt-4o-mini-tts) responds best to ENGLISH, concise (≤300 chars),
 * delivery-focused prompts. We split the final prompt into:
 *   • Character Base — stable across scenes (gender, age, temperament, archetype, accentuation, speech tags)
 *   • Scene Context — dynamic (mood, segment_type, scene_type)
 */
import type { CharacterIndex } from "@/pages/parser/types";

/* ─── EN dictionaries ──────────────────────────────────────── */

const GENDER_EN: Record<string, string> = {
  male: "male",
  female: "female",
  unknown: "",
};

const AGE_EN: Record<string, string> = {
  infant: "very young child, around 3 years old",
  child: "child, around 8 years old",
  teen: "teenage, around 15",
  young: "young adult, around 25",
  adult: "middle-aged, around 40",
  elder: "elderly, around 65",
  unknown: "",
};

const TEMPERAMENT_EN: Record<string, string> = {
  sanguine: "warm and energetic, with a hint of smile in the voice",
  choleric: "intense and assertive, slightly fast-paced",
  melancholic: "thoughtful and slightly melancholic, measured pace",
  phlegmatic: "calm and steady, even tempo",
};

/** Archetypes — keys must match `ARCHETYPE_OPTIONS` from psychotypeVoicePresets.ts */
const ARCHETYPE_EN: Record<string, string> = {
  hero: "confident heroic delivery",
  sage: "wise and reflective tone",
  innocent: "innocent and trusting voice",
  explorer: "curious and adventurous tone",
  rebel: "defiant and edgy delivery",
  magician: "mysterious and captivating tone",
  everyman: "down-to-earth conversational tone",
  lover: "warm passionate delivery",
  jester: "playful and witty tone",
  caregiver: "gentle nurturing voice",
  ruler: "authoritative commanding tone",
  creator: "imaginative expressive delivery",
};

/** Accentuations (Leonhard) — keys must match `ACCENTUATION_OPTIONS` */
const ACCENTUATION_EN: Record<string, string> = {
  hyperthymic: "high-energy, optimistic, fast-paced",
  dysthymic: "low-key, somber, slow",
  cyclothymic: "shifting between bright and gloomy moods",
  emotive: "emotionally expressive, sensitive",
  demonstrative: "theatrical, attention-grabbing",
  pedantic: "precise, careful, almost rigid",
  anxious: "tense, slightly hesitant, cautious",
  excitable: "explosive, easily roused",
  stuck: "intense, brooding, slow to release emotion",
  exalted: "ecstatic, elevated, dramatic peaks",
};

/**
 * Known speech-tag tokens (Russian + English) → English phrase.
 * Lookup is case-insensitive and ignores leading "#".
 */
const SPEECH_TAG_EN: Record<string, string> = {
  // tempo
  быстро: "fast pace",
  медленно: "slow pace",
  отрывисто: "clipped staccato delivery",
  тянет: "drawling delivery",
  // volume / register
  громко: "loud",
  тихо: "quiet",
  шёпот: "whispered",
  шепот: "whispered",
  крик: "shouted",
  // texture
  хрипло: "raspy",
  хрипит: "raspy",
  визгливо: "shrill",
  мягко: "soft",
  грубо: "rough",
  // disfluency
  заикается: "slight stutter on hard consonants",
  картавит: "slight uvular 'r'",
  шепелявит: "slight lisp",
  // accent
  акцент: "noticeable accent",
  // english passthroughs
  fast: "fast pace",
  slow: "slow pace",
  whisper: "whispered",
  raspy: "raspy",
  shrill: "shrill",
  stutter: "slight stutter",
  lisp: "slight lisp",
};

/** Psycho tags that subtly color delivery (most psycho meta is captured by archetype/accentuation) */
const PSYCHO_TAG_EN: Record<string, string> = {
  невротик: "slightly anxious undertone",
  паникер: "tense and rushed",
  паникёр: "tense and rushed",
  лидер: "commanding undertone",
  мечтатель: "dreamy distant tone",
  циник: "dry sardonic edge",
  романтик: "warm romantic tone",
  философ: "measured contemplative delivery",
};

/** Mood (scene-level) → short EN phrase */
const MOOD_EN: Record<string, string> = {
  tense: "tense",
  anxious: "anxious",
  calm: "calm",
  peaceful: "calm",
  joyful: "joyful",
  happy: "joyful",
  sad: "sad",
  melancholic: "melancholic",
  angry: "angry",
  fearful: "fearful",
  scary: "fearful",
  romantic: "romantic",
  mysterious: "mysterious",
  triumphant: "triumphant",
  ironic: "ironic",
  // RU passthroughs
  напряжённый: "tense",
  напряженный: "tense",
  спокойный: "calm",
  весёлый: "joyful",
  веселый: "joyful",
  грустный: "sad",
  злой: "angry",
  страшный: "fearful",
  романтичный: "romantic",
  таинственный: "mysterious",
};

/** Segment type → manner hint */
const SEGMENT_TYPE_EN: Record<string, string> = {
  dialogue: "in conversation",
  monologue: "delivering a monologue",
  inner_thought: "as inner thought, reflective and quiet",
  first_person: "as first-person narration",
  telephone: "over a phone, slightly compressed",
  narrator: "as narrator",
  epigraph: "as epigraph, formal and measured",
  lyric: "lyrical, almost sung",
  footnote: "as footnote commentary, neutral",
  remark: "as a brief aside",
};

/** Scene type → background tone (used sparingly) */
const SCENE_TYPE_EN: Record<string, string> = {
  action: "with urgency",
  dialogue: "conversational",
  inner_monologue: "introspective",
  description: "descriptive and even",
  lyrical_digression: "lyrical and reflective",
  remark: "matter-of-fact",
};

/* ─── Helpers ──────────────────────────────────────────────── */

const norm = (v: string | null | undefined) =>
  (v ?? "").toString().trim().toLowerCase().replace(/^#/, "");

const join = (parts: (string | undefined | null | false)[], sep = ", "): string =>
  parts.filter((p): p is string => !!p && p.trim().length > 0).join(sep);

/* ─── Public API ───────────────────────────────────────────── */

export interface OmniVoiceInstructionParts {
  /** Stable description of the character (gender + age + temperament + archetype + accentuation + tags + free-text EN). */
  base: string;
  /** Dynamic scene-level context (mood + segment type + scene type). May be empty. */
  scene: string;
  /** Final concatenated prompt sent to OmniVoice. */
  full: string;
}

export interface BuildBaseOptions {
  /** Pre-translated English description (from edge function cache). */
  descriptionEn?: string | null;
  /** Pre-translated English speech-style (from edge function cache). */
  speechStyleEn?: string | null;
  /** Hard cap on output length (default 220 chars). */
  maxLength?: number;
}

/**
 * Build the stable "Character Base" portion from a CharacterIndex profile.
 * Uses deterministic English dictionaries; free-text fields (description,
 * speech_style) are taken from pre-translated cache if provided.
 */
export function buildCharacterBaseInstruction(
  character: Pick<
    CharacterIndex,
    | "gender"
    | "age_group"
    | "temperament"
    | "speech_tags"
    | "psycho_tags"
  >,
  opts: BuildBaseOptions = {},
): string {
  const { descriptionEn, speechStyleEn, maxLength = 220 } = opts;

  const gender = GENDER_EN[norm(character.gender)] || "";
  const age = AGE_EN[norm(character.age_group)] || "";
  const temperament = TEMPERAMENT_EN[norm(character.temperament)] || "";

  // Archetype + accentuation are stored inside psycho_tags in the current schema;
  // we look them up explicitly so the dictionary entries take priority over the
  // generic PSYCHO_TAG_EN fallback.
  const psychoNorm = (character.psycho_tags ?? []).map(norm);
  const archetype = psychoNorm.map(t => ARCHETYPE_EN[t]).find(Boolean) || "";
  const accentuation = psychoNorm.map(t => ACCENTUATION_EN[t]).find(Boolean) || "";
  const psychoExtra = psychoNorm
    .map(t => PSYCHO_TAG_EN[t])
    .filter((v): v is string => !!v)
    .slice(0, 2);

  const speechExtras = (character.speech_tags ?? [])
    .map(t => SPEECH_TAG_EN[norm(t)])
    .filter((v): v is string => !!v)
    .slice(0, 3);

  // Headline: "{age} {gender} voice"  (e.g. "Middle-aged, around 40 male voice.")
  const headline = (() => {
    const subject = join([age, gender]);
    if (subject) return `${capitalize(subject)} voice.`;
    return "";
  })();

  // Personality: temperament + archetype + accentuation
  const personality = capitalizeSentence(join([temperament, archetype, accentuation], "; "));

  // Delivery flavor: speech_tags + psycho extras + free-text overrides
  const delivery = capitalizeSentence(
    join([
      ...speechExtras,
      ...psychoExtra,
      (speechStyleEn ?? "").trim(),
    ], "; "),
  );

  // Free-text description goes last as flavor sentence (kept short).
  const flavor = (descriptionEn ?? "").trim()
    ? capitalizeSentence(descriptionEn!.trim())
    : "";

  const sentences = [headline, personality, delivery, flavor]
    .map(s => endWithPeriod(s))
    .filter(s => s.length > 0);

  return clamp(sentences.join(" "), maxLength);
}

export interface BuildSceneOptions {
  /** Hard cap on output length (default 100 chars). */
  maxLength?: number;
}

/**
 * Build the dynamic "Scene Context" sentence.
 * Returns "" when no useful context is available.
 */
export function buildSceneContextInstruction(
  ctx: {
    mood?: string | null;
    sceneType?: string | null;
    segmentType?: string | null;
  },
  opts: BuildSceneOptions = {},
): string {
  const { maxLength = 100 } = opts;

  const mood = MOOD_EN[norm(ctx.mood)] || "";
  const segment = SEGMENT_TYPE_EN[norm(ctx.segmentType)] || "";
  const sceneTone = SCENE_TYPE_EN[norm(ctx.sceneType)] || "";

  if (!mood && !segment && !sceneTone) return "";

  // "Currently {mood}, {segment}, {sceneTone}."
  const parts: string[] = [];
  if (mood) parts.push(`currently ${mood}`);
  if (segment) parts.push(segment);
  if (sceneTone && sceneTone !== segment) parts.push(sceneTone);

  return clamp(endWithPeriod(capitalizeSentence(join(parts, ", "))), maxLength);
}

/**
 * Convenience: build both parts and the final concatenated prompt.
 */
export function buildOmniVoiceInstructions(
  character: Parameters<typeof buildCharacterBaseInstruction>[0],
  ctx: Parameters<typeof buildSceneContextInstruction>[0] = {},
  opts: BuildBaseOptions = {},
): OmniVoiceInstructionParts {
  const base = buildCharacterBaseInstruction(character, opts);
  const scene = buildSceneContextInstruction(ctx);
  const full = clamp(endWithPeriod(join([base, scene], " ")), 320);
  return { base, scene, full };
}

/**
 * Returns true when the character has any free-text RU field worth translating.
 */
export function needsFreeTextTranslation(
  character: Pick<CharacterIndex, "description" | "speech_style">,
): boolean {
  const d = (character.description ?? "").trim();
  const s = (character.speech_style ?? "").trim();
  return d.length > 0 || s.length > 0;
}

/**
 * Stable hash of the RU free-text fields — used as a cache key
 * inside `voice_config.omnivoice_cache.cached_from_hash`.
 * Cheap non-crypto hash; collision-resistant enough for our needs.
 */
export function hashFreeTextFields(
  character: Pick<CharacterIndex, "description" | "speech_style">,
): string {
  const payload = `${(character.description ?? "").trim()}\u0000${(character.speech_style ?? "").trim()}`;
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/* ─── Tiny string utilities (kept private) ─────────────────── */

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function capitalizeSentence(s: string): string {
  const t = s.trim();
  return t ? capitalize(t) : "";
}

function endWithPeriod(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  // Try to cut at last sentence boundary within the limit
  const slice = s.slice(0, max);
  const lastDot = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (lastDot > max * 0.6) return slice.slice(0, lastDot + 1).trim();
  return slice.trim().replace(/[,;:\s]+$/, "") + "…";
}
