/**
 * ProjectStorage — абстракция локального хранилища проекта книги.
 *
 * V2 layout (единственная актуальная структура):
 *   📁 BookTitle/
 *   ├── project.json              — метаданные проекта
 *   ├── characters.json           — глобальный реестр персонажей
 *   ├── scene_index.json          — индекс сцен (sceneId → chapterId)
 *   ├── 📁 source/
 *   │   └── book.pdf / book.docx / book.fb2
 *   ├── 📁 structure/
 *   │   ├── toc.json              — оглавление (TocChapter[])
 *   │   ├── chapters.json         — chapterIndex → uuid
 *   │   └── characters.json       — (legacy, только для миграции)
 *   ├── 📁 chapters/
 *   │   └── {chapterId}/
 *   │       ├── content.json      — сцены главы
 *   │       └── 📁 scenes/
 *   │           └── {sceneId}/
 *   │               ├── storyboard.json
 *   │               ├── characters.json
 *   │               ├── atmospheres.json
 *   │               └── 📁 audio/
 *   │                   ├── 📁 tts/          — {segmentId}.mp3
 *   │                   ├── 📁 atmosphere/   — атмосферные слои
 *   │                   └── 📁 renders/      — финальные рендеры
 *   └── 📁 montage/
 *
 * ⚠️  Плоские папки V1 (scenes/, audio/) в корне — устаревшие артефакты.
 *     Код НЕ читает и НЕ пишет в них. Безопасно удалять вручную.
 */

// ─── Interface ───────────────────────────────────────────

export interface ProjectStorage {
  /** Human-readable project root name */
  readonly projectName: string;
  /** Whether the storage is ready */
  readonly isReady: boolean;

  // JSON operations
  readJSON<T = unknown>(path: string): Promise<T | null>;
  writeJSON(path: string, data: unknown): Promise<void>;

  // Binary operations
  readBlob(path: string): Promise<Blob | null>;
  writeBlob(path: string, blob: Blob, mimeType?: string): Promise<void>;

  // File management
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  listDir(path: string): Promise<string[]>;

  // Bulk export/import (for cloud sync)
  exportZip(): Promise<Blob>;
  importZip(zip: Blob): Promise<void>;
}

// ─── Pipeline progress ───────────────────────────────────

/** Flat map of pipeline step IDs → completion status. */
export type PipelineProgress = Record<string, boolean>;

/** All known pipeline step IDs (for defaults). */
export const PIPELINE_STEP_IDS = [
  "file_uploaded",
  "opfs_created",
  "toc_extracted",
  "scenes_analyzed",
  "characters_extracted",
  "profiles_done",
  "storyboard_done",
  "inline_edit",
  "synthesis_done",
  "mix_done",
  "scene_render",
  "chapter_assembly",
  "mastering",
  "final_render",
  // Translation pipeline
  "trans_activated",
  "trans_literal_done",
  "trans_literary_done",
  "trans_critique_done",
  "trans_export_done",
] as const;

export type PipelineStepId = (typeof PIPELINE_STEP_IDS)[number];

export function createEmptyPipelineProgress(): PipelineProgress {
  const p: PipelineProgress = {};
  for (const id of PIPELINE_STEP_IDS) p[id] = false;
  return p;
}

// ─── Project metadata ────────────────────────────────────

export interface ProjectMeta {
  version: number;
  bookId: string;
  title: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  language: "ru" | "en";
  /** File format of the source book — strict type from fileFormatUtils */
  fileFormat?: "pdf" | "docx" | "fb2";

  /** Source file metadata (replaces physical source/ folder) */
  source?: {
    /** Display title (e.g. "Собачье сердце") */
    title: string;
    /** Original filename as uploaded (e.g. "Собачье сердце.fb2") */
    fileName: string;
    /** Detected format */
    format: "pdf" | "docx" | "fb2";
  };

  // ─── Pipeline progress (единый источник готовности) ──────
  pipelineProgress?: PipelineProgress;

  // ─── Art Translation ───────────────────────────────────
  /** Active translation languages (e.g. ["en"]). */
  translationLanguages?: string[];
}

export const PROJECT_META_VERSION = 1;

/** Known keys of ProjectMeta — anything else is legacy garbage */
const PROJECT_META_KEYS = new Set<string>([
  "version", "bookId", "title", "userId", "createdAt", "updatedAt",
  "language", "fileFormat", "source", "pipelineProgress", "translationLanguages",
  "usedImpulseIds",
]);

function normalizeTranslationLanguages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function readLegacyTargetLanguage(raw: Record<string, unknown>): string | null {
  if (typeof raw.targetLanguage === "string" && raw.targetLanguage.trim()) {
    return raw.targetLanguage.trim();
  }

  const translationProject = raw.translationProject;
  if (!translationProject || typeof translationProject !== "object") {
    return null;
  }

  const nestedTargetLanguage = (translationProject as Record<string, unknown>).targetLanguage;
  return typeof nestedTargetLanguage === "string" && nestedTargetLanguage.trim()
    ? nestedTargetLanguage.trim()
    : null;
}

export function getProjectTranslationLanguages(
  raw: Record<string, unknown> | null | undefined,
): string[] {
  if (!raw) return [];

  const explicit = normalizeTranslationLanguages(raw.translationLanguages);
  if (explicit.length > 0) return explicit;

  const legacy = readLegacyTargetLanguage(raw);
  return legacy ? [legacy] : [];
}

/**
 * Strip unknown/legacy fields from a project.json object.
 * Prevents zombie fields (e.g. translationProject, targetLanguage) from persisting forever via spread.
 */
export function sanitizeProjectMeta(raw: Record<string, unknown>): ProjectMeta {
  const clean: Record<string, unknown> = {};
  for (const key of PROJECT_META_KEYS) {
    if (key in raw) clean[key] = raw[key];
  }

  const translationLanguages = getProjectTranslationLanguages(raw);
  if (translationLanguages.length > 0) {
    clean.translationLanguages = translationLanguages;
  }

  return clean as unknown as ProjectMeta;
}

// ─── File System Access API types (Chromium) ─────────────

interface FileSystemDirectoryHandle {
  kind: "directory";
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
  entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
}

interface FileSystemFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}

// ─── Feature detection ───────────────────────────────────

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export function isOPFSSupported(): boolean {
  return typeof navigator !== "undefined" && "storage" in navigator && "getDirectory" in navigator.storage;
}

export type StorageBackend = "fs-access" | "opfs" | "none";

export function detectStorageBackend(): StorageBackend {
  if (isFileSystemAccessSupported()) return "fs-access";
  if (isOPFSSupported()) return "opfs";
  return "none";
}

// ─── Helper: navigate to subdirectory by path ────────────

async function getSubDir(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  const parts = path.split("/").filter(Boolean);
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

function splitPath(path: string): { dir: string; file: string } {
  const normalized = path.replace(/^\/+/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) return { dir: "", file: normalized };
  return { dir: normalized.slice(0, lastSlash), file: normalized.slice(lastSlash + 1) };
}

// ─── LocalFSStorage (File System Access API) ─────────────

export class LocalFSStorage implements ProjectStorage {
  private root: FileSystemDirectoryHandle;
  private _isReady = true;

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root;
  }

  get projectName(): string {
    return this.root.name;
  }

  get isReady(): boolean {
    return this._isReady;
  }

  // ── JSON ─────────────────────────────────────────────

  async readJSON<T = unknown>(path: string): Promise<T | null> {
    try {
      const { dir, file } = splitPath(path);
      const parent = dir ? await getSubDir(this.root, dir, false) : this.root;
      const handle = await parent.getFileHandle(file);
      const f = await handle.getFile();
      const text = await f.text();
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  async writeJSON(path: string, data: unknown): Promise<void> {
    const { dir, file } = splitPath(path);
    const parent = dir ? await getSubDir(this.root, dir, true) : this.root;
    const handle = await parent.getFileHandle(file, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  }

  // ── Blob ─────────────────────────────────────────────

  async readBlob(path: string): Promise<Blob | null> {
    try {
      const { dir, file } = splitPath(path);
      const parent = dir ? await getSubDir(this.root, dir, false) : this.root;
      const handle = await parent.getFileHandle(file);
      return await handle.getFile();
    } catch {
      return null;
    }
  }

  async writeBlob(path: string, blob: Blob): Promise<void> {
    const { dir, file } = splitPath(path);
    const parent = dir ? await getSubDir(this.root, dir, true) : this.root;
    const handle = await parent.getFileHandle(file, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  // ── File management ──────────────────────────────────

  async exists(path: string): Promise<boolean> {
    try {
      const { dir, file } = splitPath(path);
      const parent = dir ? await getSubDir(this.root, dir, false) : this.root;
      await parent.getFileHandle(file);
      return true;
    } catch {
      // Could also be a directory
      try {
        const { dir, file } = splitPath(path);
        const parent = dir ? await getSubDir(this.root, dir, false) : this.root;
        await parent.getDirectoryHandle(file);
        return true;
      } catch {
        return false;
      }
    }
  }

  async delete(path: string): Promise<void> {
    try {
      const { dir, file } = splitPath(path);
      const parent = dir ? await getSubDir(this.root, dir, false) : this.root;
      await parent.removeEntry(file, { recursive: true });
    } catch {
      // Ignore if not found
    }
  }

  async listDir(path: string): Promise<string[]> {
    try {
      const dir = path ? await getSubDir(this.root, path, false) : this.root;
      const names: string[] = [];
      for await (const [name] of dir.entries()) {
        names.push(name);
      }
      return names.sort();
    } catch {
      return [];
    }
  }

  // ── Bulk export/import (ZIP) ─────────────────────────

  async exportZip(): Promise<Blob> {
    const { exportProjectZip } = await import("./projectZip");
    return exportProjectZip(this);
  }

  async importZip(zip: Blob): Promise<void> {
    const { importProjectZip } = await import("./projectZip");
    await importProjectZip(this, zip);
  }

  // ── Static factories ─────────────────────────────────

  /** Open an existing project folder */
  static async openProject(): Promise<LocalFSStorage> {
    const root = await (window as any).showDirectoryPicker({ mode: "readwrite" });
    return new LocalFSStorage(root);
  }

  /** Create a new project inside a user-chosen parent folder */
  static async createProject(projectName: string): Promise<LocalFSStorage> {
    const parent = await (window as any).showDirectoryPicker({ mode: "readwrite" });
    const root = await parent.getDirectoryHandle(projectName, { create: true });
    // Pre-create directory structure
    // source/ directory no longer needed — metadata in project.json
    await root.getDirectoryHandle("structure", { create: true });
    await root.getDirectoryHandle("chapters", { create: true });
    await root.getDirectoryHandle("montage", { create: true });
    return new LocalFSStorage(root);
  }
}

// ─── OPFSStorage (fallback for Firefox/Safari) ───────────

export class OPFSStorage implements ProjectStorage {
  private root: FileSystemDirectoryHandle;
  private _projectName: string;

  constructor(root: FileSystemDirectoryHandle, projectName: string) {
    this.root = root;
    this._projectName = projectName;
  }

  get projectName(): string {
    return this._projectName;
  }

  get isReady(): boolean {
    return true;
  }

  async readJSON<T = unknown>(path: string): Promise<T | null> {
    try {
      const { dir, file } = splitPath(path);
      const parent = dir ? await getSubDir(this.root, dir, false) : this.root;
      const handle = await parent.getFileHandle(file);
      const f = await handle.getFile();
      return JSON.parse(await f.text()) as T;
    } catch {
      return null;
    }
  }

  async writeJSON(path: string, data: unknown): Promise<void> {
    const { dir, file } = splitPath(path);
    const parent = dir ? await getSubDir(this.root, dir, true) : this.root;
    const handle = await parent.getFileHandle(file, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  }

  async readBlob(path: string): Promise<Blob | null> {
    try {
      const { dir, file } = splitPath(path);
      const parent = dir ? await getSubDir(this.root, dir, false) : this.root;
      const handle = await parent.getFileHandle(file);
      return await handle.getFile();
    } catch {
      return null;
    }
  }

  async writeBlob(path: string, blob: Blob): Promise<void> {
    const { dir, file } = splitPath(path);
    const parent = dir ? await getSubDir(this.root, dir, true) : this.root;
    const handle = await parent.getFileHandle(file, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async exists(path: string): Promise<boolean> {
    try {
      const { dir, file } = splitPath(path);
      const parent = dir ? await getSubDir(this.root, dir, false) : this.root;
      await parent.getFileHandle(file);
      return true;
    } catch {
      try {
        const { dir, file } = splitPath(path);
        const parent = dir ? await getSubDir(this.root, dir, false) : this.root;
        await parent.getDirectoryHandle(file);
        return true;
      } catch {
        return false;
      }
    }
  }

  async delete(path: string): Promise<void> {
    try {
      const { dir, file } = splitPath(path);
      const parent = dir ? await getSubDir(this.root, dir, false) : this.root;
      await parent.removeEntry(file, { recursive: true });
    } catch {}
  }

  async listDir(path: string): Promise<string[]> {
    try {
      const dir = path ? await getSubDir(this.root, path, false) : this.root;
      const names: string[] = [];
      for await (const [name] of dir.entries()) {
        names.push(name);
      }
      return names.sort();
    } catch {
      return [];
    }
  }

  async exportZip(): Promise<Blob> {
    const { exportProjectZip } = await import("./projectZip");
    return exportProjectZip(this);
  }

  async importZip(zip: Blob): Promise<void> {
    const { importProjectZip } = await import("./projectZip");
    await importProjectZip(this, zip);
  }

  /** Create or open project in OPFS (creates directories if missing) */
  static async openOrCreate(projectName: string): Promise<OPFSStorage> {
    const opfsRoot = await navigator.storage.getDirectory();
    const projectDir = await opfsRoot.getDirectoryHandle(projectName, { create: true }) as unknown as FileSystemDirectoryHandle;
    // Ensure subdirs
    // source/ directory no longer needed — metadata in project.json
    await projectDir.getDirectoryHandle("structure", { create: true });
    await projectDir.getDirectoryHandle("chapters", { create: true });
    await projectDir.getDirectoryHandle("montage", { create: true });
    return new OPFSStorage(projectDir, projectName);
  }

  /**
   * Open an existing project in OPFS WITHOUT creating anything.
   * Returns null if the directory does not exist.
   * Use this for scanning / searching — never openOrCreate.
   */
  static async openExisting(projectName: string): Promise<OPFSStorage | null> {
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      const projectDir = await opfsRoot.getDirectoryHandle(projectName, { create: false }) as unknown as FileSystemDirectoryHandle;
      return new OPFSStorage(projectDir, projectName);
    } catch {
      return null;
    }
  }

  /** Delete a project directory from OPFS by name */
  static async deleteProject(projectName: string): Promise<void> {
    const opfsRoot = await navigator.storage.getDirectory();
    try {
      await opfsRoot.removeEntry(projectName, { recursive: true });
    } catch (err: any) {
      if (err?.name !== "NotFoundError") {
        throw err;
      }
    }
  }

  /** List all projects in OPFS */
  static async listProjects(): Promise<string[]> {
    const opfsRoot = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const [name, handle] of (opfsRoot as any).entries()) {
      if (handle.kind === "directory") names.push(name);
    }
    return names.sort();
  }
}
