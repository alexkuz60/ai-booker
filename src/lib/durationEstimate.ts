import type { StudioChapter, StudioScene } from "./studioChapter";

// ─── Duration estimation ────────────────────────────────────
// T ≈ N / (C × S)
// N — total characters
// C — chars per second (Russian ≈ 13–15, default 14)
// S — speed coefficient (0.8 – 1.2, default 1.0)

const DEFAULT_CHARS_PER_SEC = 14;
const DEFAULT_SPEED = 1.0;

export function countChars(scenes: StudioScene[]): number {
  return scenes.reduce((sum, s) => sum + (s.content_preview?.length ?? 0), 0);
}

export function estimateDurationSec(
  charCount: number,
  charsPerSec = DEFAULT_CHARS_PER_SEC,
  speed = DEFAULT_SPEED
): number {
  if (charCount <= 0) return 0;
  return Math.round(charCount / (charsPerSec * speed));
}

export function formatDuration(totalSec: number): string {
  if (totalSec <= 0) return "0:00";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function estimateChapterDuration(chapter: StudioChapter, charsPerSec?: number, speed?: number) {
  const chars = countChars(chapter.scenes);
  const sec = estimateDurationSec(chars, charsPerSec, speed);
  return { chars, sec, formatted: formatDuration(sec) };
}

export function estimateSceneDuration(scene: StudioScene, charsPerSec?: number, speed?: number) {
  const chars = scene.content_preview?.length ?? 0;
  const sec = estimateDurationSec(chars, charsPerSec, speed);
  return { chars, sec, formatted: formatDuration(sec) };
}
