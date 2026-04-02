/**
 * translationSynopsis — OPFS persistence for multi-level translation context.
 *
 * Three levels:
 * - Book meta: era, genre, style, authorNote
 * - Chapter synopsis: summary, tone, keyThemes
 * - Scene synopsis: events, characters (with profiles), mood, setting
 *
 * All files stored under `synopsis/` directory in the translation project.
 */

import type { ProjectStorage } from "@/lib/projectStorage";
import type { CharacterIndex } from "@/pages/parser/types";

// ─── Types ──────────────────────────────────────────────────────────

export interface BookMetaSynopsis {
  era: string;
  genre: string;
  style: string;
  authorNote: string;
}

export interface ChapterSynopsis {
  chapterId: string;
  summary: string;
  tone: string;
  keyThemes: string[];
}

export interface SceneSynopsisCharacter {
  name: string;
  gender: string;
  age_group: string;
  temperament: string | null;
  speech_style: string | null;
  speech_tags: string[];
  psycho_tags: string[];
  description: string | null;
}

export interface SceneSynopsis {
  sceneId: string;
  events: string;
  characters: SceneSynopsisCharacter[];
  mood: string;
  setting: string;
}

export interface TranslationContext {
  bookMeta: BookMetaSynopsis | null;
  chapterSynopsis: ChapterSynopsis | null;
  sceneSynopsis: SceneSynopsis | null;
}

// ─── Paths ──────────────────────────────────────────────────────────

export const synopsisPaths = {
  bookMeta: () => "synopsis/book-meta.json",
  chapter: (chapterId: string) => `synopsis/chapter-${chapterId}.json`,
  scene: (sceneId: string) => `synopsis/scene-${sceneId}.json`,
  excludedChars: (chapterId: string) => `synopsis/excluded-chars-${chapterId}.json`,
} as const;

// ─── Read helpers ───────────────────────────────────────────────────

export async function readBookMeta(
  storage: ProjectStorage,
): Promise<BookMetaSynopsis | null> {
  return storage.readJSON<BookMetaSynopsis>(synopsisPaths.bookMeta());
}

export async function readChapterSynopsis(
  storage: ProjectStorage,
  chapterId: string,
): Promise<ChapterSynopsis | null> {
  return storage.readJSON<ChapterSynopsis>(synopsisPaths.chapter(chapterId));
}

export async function readSceneSynopsis(
  storage: ProjectStorage,
  sceneId: string,
): Promise<SceneSynopsis | null> {
  return storage.readJSON<SceneSynopsis>(synopsisPaths.scene(sceneId));
}

export async function readExcludedChars(
  storage: ProjectStorage,
  chapterId: string,
): Promise<Set<string>> {
  const arr = await storage.readJSON<string[]>(synopsisPaths.excludedChars(chapterId));
  return new Set(arr ?? []);
}

// ─── Write helpers ──────────────────────────────────────────────────

export async function saveBookMeta(
  storage: ProjectStorage,
  data: BookMetaSynopsis,
): Promise<void> {
  await storage.writeJSON(synopsisPaths.bookMeta(), data);
}

export async function saveChapterSynopsis(
  storage: ProjectStorage,
  data: ChapterSynopsis,
): Promise<void> {
  await storage.writeJSON(synopsisPaths.chapter(data.chapterId), data);
}

export async function saveSceneSynopsis(
  storage: ProjectStorage,
  data: SceneSynopsis,
): Promise<void> {
  await storage.writeJSON(synopsisPaths.scene(data.sceneId), data);
}

// ─── Load full context for pipeline ─────────────────────────────────

export async function loadTranslationContext(
  storage: ProjectStorage,
  chapterId: string,
  sceneId: string,
): Promise<TranslationContext> {
  const [bookMeta, chapterSynopsis, sceneSynopsis] = await Promise.all([
    readBookMeta(storage),
    readChapterSynopsis(storage, chapterId),
    readSceneSynopsis(storage, sceneId),
  ]);
  return { bookMeta, chapterSynopsis, sceneSynopsis };
}

// ─── Build context block for system prompt ──────────────────────────

export function buildContextBlock(
  ctx: TranslationContext,
  isRu: boolean,
): string {
  const parts: string[] = [];

  if (ctx.bookMeta) {
    const b = ctx.bookMeta;
    const label = isRu ? "=== КОНТЕКСТ КНИГИ ===" : "=== BOOK CONTEXT ===";
    const lines = [label];
    if (b.era) lines.push(`${isRu ? "Эпоха" : "Era"}: ${b.era}`);
    if (b.genre) lines.push(`${isRu ? "Жанр" : "Genre"}: ${b.genre}`);
    if (b.style) lines.push(`${isRu ? "Стиль" : "Style"}: ${b.style}`);
    if (b.authorNote) lines.push(`${isRu ? "Примечание" : "Note"}: ${b.authorNote}`);
    parts.push(lines.join("\n"));
  }

  if (ctx.chapterSynopsis) {
    const c = ctx.chapterSynopsis;
    const label = isRu ? "=== ГЛАВА ===" : "=== CHAPTER ===";
    const lines = [label];
    if (c.summary) lines.push(c.summary);
    if (c.tone) lines.push(`${isRu ? "Тон" : "Tone"}: ${c.tone}`);
    if (c.keyThemes.length) lines.push(`${isRu ? "Темы" : "Themes"}: ${c.keyThemes.join(", ")}`);
    parts.push(lines.join("\n"));
  }

  if (ctx.sceneSynopsis) {
    const s = ctx.sceneSynopsis;
    const label = isRu ? "=== СЦЕНА ===" : "=== SCENE ===";
    const lines = [label];
    if (s.events) lines.push(s.events);
    if (s.mood) lines.push(`${isRu ? "Настроение" : "Mood"}: ${s.mood}`);
    if (s.setting) lines.push(`${isRu ? "Место" : "Setting"}: ${s.setting}`);

    if (s.characters.length) {
      lines.push("");
      lines.push(isRu ? "Персонажи сцены:" : "Scene characters:");
      for (const ch of s.characters) {
        const meta = [ch.gender, ch.age_group].filter(Boolean).join(", ");
        const traits: string[] = [];
        if (ch.temperament) traits.push(ch.temperament);
        if (ch.speech_style) traits.push(`${isRu ? "стиль" : "style"}: ${ch.speech_style}`);
        if (ch.speech_tags.length) traits.push(ch.speech_tags.join(" "));
        if (ch.psycho_tags.length) traits.push(ch.psycho_tags.join(" "));
        const desc = ch.description ? ` — ${ch.description}` : "";
        lines.push(`- ${ch.name} (${meta}): ${traits.join("; ")}${desc}`);
      }
    }
    parts.push(lines.join("\n"));
  }

  return parts.join("\n\n");
}

// ─── Extract character profiles for scene synopsis ──────────────────

export function extractSceneCharacterProfiles(
  characters: CharacterIndex[],
  sceneCharIds: Set<string>,
): SceneSynopsisCharacter[] {
  return characters
    .filter((c) => sceneCharIds.has(c.id))
    .map((c) => ({
      name: c.name,
      gender: c.gender,
      age_group: c.age_group,
      temperament: c.temperament ?? null,
      speech_style: c.speech_style ?? null,
      speech_tags: c.speech_tags ?? [],
      psycho_tags: c.psycho_tags ?? [],
      description: c.description
        ? c.description.split(/[.!?]/).slice(0, 2).join(". ").trim() || c.description
        : null,
    }));
}

// ─── Defaults ───────────────────────────────────────────────────────

export function emptyBookMeta(): BookMetaSynopsis {
  return { era: "", genre: "", style: "", authorNote: "" };
}

export function emptyChapterSynopsis(chapterId: string): ChapterSynopsis {
  return { chapterId, summary: "", tone: "", keyThemes: [] };
}

export function emptySceneSynopsis(sceneId: string): SceneSynopsis {
  return { sceneId, events: "", characters: [], mood: "", setting: "" };
}
