// Shared types and helpers for transferring a chapter from Parser → Studio
// К4: NEVER store scene text content in sessionStorage — only pointers.

export interface StudioScene {
  id?: string; // DB id from book_scenes
  scene_number: number;
  title: string;
  scene_type: string;
  mood: string;
  bpm: number;
  content_preview?: string;
  content?: string;
  /** Cached character count — survives K4 content stripping for duration estimates */
  char_count?: number;
}

export interface StudioChapter {
  chapterId?: string;
  chapterTitle: string;
  bookTitle: string;
  bookId?: string;
  scenes: StudioScene[];
}

const STUDIO_CHAPTER_KEY = "studio-active-chapter";

/**
 * Save chapter pointer to sessionStorage.
 * К4: content and content_preview are ALWAYS stripped — OPFS is the only source.
 */
export function saveStudioChapter(chapter: StudioChapter) {
  // К4: strip all text content — only pointers (IDs, indices, titles) go to sessionStorage.
  const light: StudioChapter = {
    ...chapter,
    scenes: chapter.scenes.map(({ content, content_preview, ...rest }) => rest),
  };
  try {
    sessionStorage.setItem(STUDIO_CHAPTER_KEY, JSON.stringify(light));
  } catch { /* payload is small (no content), ignore */ }
}

export function loadStudioChapter(): StudioChapter | null {
  const raw = sessionStorage.getItem(STUDIO_CHAPTER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StudioChapter;
  } catch {
    return null;
  }
}

export function clearStudioChapter() {
  sessionStorage.removeItem(STUDIO_CHAPTER_KEY);
}
