// ─── Parser Types & Constants ─────────────────────────────────

export interface Scene {
  id?: string;
  scene_number: number;
  title: string;
  content_preview?: string;
  content?: string;
  scene_type: string;
  mood: string;
  bpm: number;
  /** Character count of scene content, updated after every edit */
  char_count?: number;
  /** Scene content was edited in Parser after initial analysis — Studio data may be stale */
  dirty?: boolean;
}

export interface Chapter {
  chapter_number: number;
  title: string;
  scenes: Scene[];
}

export interface Part {
  part_number: number;
  title: string;
  chapters: Chapter[];
}

export interface BookStructure {
  book_title: string;
  parts?: Part[];
  chapters?: Chapter[];
}

export type SectionType = "content" | "preface" | "afterword" | "endnotes" | "appendix";

export interface TocChapter {
  title: string;
  startPage: number;
  endPage: number;
  level: number;
  partTitle?: string;
  sectionType: SectionType;
}

export type Step = "library" | "upload" | "extracting_toc" | "workspace" | "error";
export type ChapterStatus = "pending" | "analyzing" | "done" | "error";

export interface BookRecord {
  id: string;
  title: string;
  file_name: string;
  file_path: string | null;
  status: string;
  created_at: string;
  updated_at?: string;
  chapter_count?: number;
  scene_count?: number;
  file_format?: "pdf" | "docx" | "fb2";
}

// ─── Classification ──────────────────────────────────────────

const SECTION_PATTERNS: { type: SectionType; patterns: RegExp[] }[] = [
  {
    type: "preface",
    patterns: [
      /предисловие/i, /введение/i, /вступление/i, /от\s+автора/i, /пролог/i,
      /preface/i, /foreword/i, /introduction/i, /prologue/i,
    ],
  },
  {
    type: "afterword",
    patterns: [
      /послесловие/i, /заключение/i, /эпилог/i, /от\s+переводчика/i, /от\s+редактора/i,
      /afterword/i, /epilogue/i, /conclusion/i, /postscript/i,
    ],
  },
  {
    type: "endnotes",
    patterns: [
      /примечани/i, /сноск/i, /комментари/i, /ссылк/i, /библиограф/i, /литератур/i,
      /указатель/i, /глоссарий/i, /словарь/i,
      /notes/i, /references/i, /bibliography/i, /glossary/i, /index/i, /endnotes/i, /footnotes/i,
    ],
  },
  {
    type: "appendix",
    patterns: [/приложен/i, /дополнен/i, /аппендикс/i, /appendix/i, /supplement/i],
  },
];

export function classifySection(title: string): SectionType {
  for (const { type, patterns } of SECTION_PATTERNS) {
    if (patterns.some(p => p.test(title))) return type;
  }
  return "content";
}

/** Normalize levels: demote orphaned entries whose parent level doesn't exist */
export function normalizeLevels(entries: TocChapter[]): TocChapter[] {
  const result = entries.map(e => ({ ...e }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      if (result[i].level === 0) continue;
      const parentLevel = result[i].level - 1;
      let parentFound = false;
      for (let j = i - 1; j >= 0; j--) {
        if (result[j].sectionType !== result[i].sectionType) continue;
        if (result[j].level === parentLevel) { parentFound = true; break; }
        if (result[j].level < parentLevel) break;
      }
      if (!parentFound) {
        result[i].level--;
        changed = true;
      }
    }
  }
  return result;
}

export const SECTION_ICONS: Record<SectionType, string> = {
  content: "📖",
  preface: "📝",
  afterword: "📜",
  endnotes: "🔗",
  appendix: "📎",
};

export const SCENE_TYPE_COLORS: Record<string, string> = {
  action: "bg-red-500/20 text-red-400 border-red-500/30",
  dialogue: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  lyrical_digression: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  description: "bg-green-500/20 text-green-400 border-green-500/30",
  inner_monologue: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  remark: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  mixed: "bg-muted text-muted-foreground border-border",
};

// ─── Characters (local-first) ────────────────────────────────

export interface CharacterAppearance {
  chapterIdx: number;
  chapterTitle: string;
  sceneNumbers: number[];
}

export interface CharacterProfile {
  age_group?: string;
  temperament?: string;
  speech_style?: string;
  description?: string;
  /** Tags for TTS voice casting: speech manner (e.g. #отрывисто #быстро) */
  speech_tags?: string[];
  /** Tags for psychotype classification (e.g. #паникер #невротик) */
  psycho_tags?: string[];
  /** AI model that generated this profile ("клеймо мастера") */
  profiledBy?: string;
}

export type CharacterRole = "speaking" | "mentioned" | "crowd" | "system";

// ─── Voice config stored alongside character ─────────────────

/** Snapshot of OmniVoice generation knobs persisted per-character. */
export interface OmniVoiceAdvancedSnapshot {
  /** Full params snapshot (all 6 fields, never partial) */
  params: {
    guidance_scale: number;
    num_step: number;
    t_shift: number;
    position_temperature: number;
    class_temperature: number;
    denoise: boolean;
  };
  /** Where the values came from — drives "Re-apply auto" UX hints */
  source: "auto" | "manual" | "preset:draft" | "preset:standard" | "preset:final";
  /** ISO timestamp of last write */
  updatedAt: string;
}

export interface OmniVoiceCache {
  /** AI-translated English description (≤80 chars) */
  description_en?: string;
  /** AI-translated English speech-style (≤80 chars) */
  speech_style_en?: string;
  /** FNV-1a hash of RU source fields — invalidates cache when source changes */
  cached_from_hash?: string;
  /** Last user-edited "Character Base" override (overrides auto-generated text) */
  base_override?: string;
  /** Last user-edited "Scene Context" override (overrides auto-generated text) */
  scene_override?: string;
}

export interface CharacterVoiceConfig {
  provider?: string;
  voice_id?: string;
  role?: string;
  speed?: number;
  pitch?: number;
  volume?: number;
  is_extra?: boolean;
  model?: string;
  instructions?: string;
  stability?: number;
  similarity_boost?: number;
  style?: number;
  /** OmniVoice / gpt-4o-mini-tts auto-fill cache (translations + user overrides) */
  omnivoice_cache?: OmniVoiceCache;
  /** OmniVoice generation parameters (Phase 2: psychotype → params mapping) */
  omnivoice_advanced?: OmniVoiceAdvancedSnapshot;
}

/**
 * Full character record stored in characters/index.json.
 * Superset of the old LocalCharacter — adds voice_config, sort_order, color, age_group, etc.
 */
export interface CharacterIndex {
  id: string;
  name: string;
  aliases: string[];
  gender: "male" | "female" | "unknown";
  role?: CharacterRole;
  age_group: string;                  // adult | child | elder | teen | unknown
  temperament?: string | null;
  speech_style?: string | null;
  description?: string | null;
  speech_tags: string[];
  psycho_tags: string[];
  sort_order: number;
  color?: string | null;
  /** Contextual age hint extracted from text (e.g. "старик", "ребёнок") */
  age_hint?: string;
  /** Contextual manner/emotion hint from text (e.g. "хрипло", "визгливо") */
  manner_hint?: string;
  /** AI model that extracted this character */
  extractedBy?: string;
  /** Whether this character's name/alias was confirmed in the actual scene text */
  textConfirmed?: boolean;
  /** Psychological profile (merged into top-level fields but kept for compat) */
  profile?: CharacterProfile;
  /** Per-chapter appearances (Parser provenance) */
  appearances: CharacterAppearance[];
  /** Number of scenes the character appears in */
  sceneCount: number;
  /** TTS voice config (Studio provenance) */
  voice_config: CharacterVoiceConfig;
}

/** Per-scene character map: characters/scene_{id}.json */
export interface SceneCharacterMap {
  sceneId: string;
  updatedAt: string;
  speakers: Array<{
    characterId: string;
    role_in_scene: "speaker" | "mentioned";
    segment_ids: string[];
  }>;
  typeMappings: Array<{
    segmentType: string;
    characterId: string;
  }>;
}

/**
 * @deprecated Use CharacterIndex instead. Kept for migration compatibility.
 */
export interface LocalCharacter {
  id: string;
  name: string;
  aliases: string[];
  gender?: "male" | "female" | "unknown";
  /** Role classification: speaking (has dialogue), mentioned (only referenced), crowd (anonymous voice), system (Narrator/Commentator) */
  role?: CharacterRole;
  /** Contextual age hint extracted from text (e.g. "старик", "ребёнок") — mostly for crowd */
  age_hint?: string;
  /** Contextual manner/emotion hint from text (e.g. "хрипло", "визгливо") — mostly for crowd */
  manner_hint?: string;
  appearances: CharacterAppearance[];
  /** Number of scenes the character appears in */
  sceneCount: number;
  /** AI model that extracted this character ("клеймо мастера") */
  extractedBy?: string;
  /** Whether this character's name/alias was confirmed in the actual scene text */
  textConfirmed?: boolean;
  /** Psychological profile generated by AI */
  profile?: CharacterProfile;
}

export const NAV_WIDTH_KEY = "parser-nav-width";
export const ACTIVE_BOOK_KEY = "parser-active-book";
export const NAV_STATE_KEY = "parser-nav-state";
