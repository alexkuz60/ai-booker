// Shared types and helpers for transferring a chapter from Parser → Studio

export interface StudioScene {
  scene_number: number;
  title: string;
  scene_type: string;
  mood: string;
  bpm: number;
  content_preview?: string;
}

export interface StudioChapter {
  chapterTitle: string;
  bookTitle: string;
  scenes: StudioScene[];
}

const STUDIO_CHAPTER_KEY = "studio-active-chapter";

export function saveStudioChapter(chapter: StudioChapter) {
  sessionStorage.setItem(STUDIO_CHAPTER_KEY, JSON.stringify(chapter));
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
