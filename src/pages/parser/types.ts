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
  /** AI model that generated this profile ("клеймо мастера") */
  profiledBy?: string;
}

export type CharacterRole = "speaking" | "mentioned" | "crowd" | "system";

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
