/**
 * ProjectStorage — абстракция локального хранилища проекта книги.
 *
 * V2 layout (единственная актуальная структура):
 *   📁 BookTitle/
 *   ├── project.json              — метаданные проекта
 *   ├── characters.json           — глобальный реестр персонажей
 *   ├── book_map.json             — карта книги (authoritative paths)
 *   ├── scene_index.json          — индекс сцен (sceneId → chapterId)
 *   ├── 📁 structure/
 *   │   ├── toc.json              — оглавление (TocChapter[])
 *   │   ├── chapters.json         — chapterIndex → uuid
 *   │   └── characters.json       — (legacy, только для миграции)
 *   ├── 📁 synopsis/
 *   ├── 📁 chapters/
 *   │   └── {chapterId}/
 *   │       ├── content.json      — сцены главы
 *   │       ├── 📁 renders/
 *   │       └── 📁 scenes/
 *   │           └── {sceneId}/
 *   │               ├── storyboard.json
 *   │               ├── characters.json
 *   │               ├── audio_meta.json
 *   │               ├── clip_plugins.json
 *   │               ├── mixer_state.json
 *   │               ├── atmospheres.json
 *   │               ├── 📁 tts/              — {segmentId}.mp3
 *   │               ├── 📁 audio/atmosphere/ — атмосферные слои
 *   │               └── 📁 {lang}/audio/tts/ — переводной TTS
 *
 * 🚫  Root-level legacy directories `audio/`, `source/`, `montage/`, `scenes/`
 *     are FORBIDDEN and must never be created by current code.
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

export function getProjectTranslationLanguages(
  raw: Record<string, unknown> | null | undefined,
): string[] {
  if (!raw) return [];
  return normalizeTranslationLanguages(raw.translationLanguages);
}

/**
 * Strip unknown fields from a project.json object.
 * Only keeps fields listed in PROJECT_META_KEYS.
 */
export function sanitizeProjectMeta(raw: Record<string, unknown>): ProjectMeta {
  const clean: Record<string, unknown> = {};
  for (const key of PROJECT_META_KEYS) {
    if (key in raw) clean[key] = raw[key];
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
  if (isOPFSSupported()) return "opfs";
  if (isFileSystemAccessSupported()) return "fs-access";
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

async function hasChildDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await parent.getDirectoryHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function resolveUniqueProjectName(
  parent: FileSystemDirectoryHandle,
  desiredName: string,
): Promise<string> {
  const baseName = desiredName.trim() || "BookProject";
  let candidate = baseName;
  let suffix = 2;

  while (await hasChildDirectory(parent, candidate)) {
    candidate = `${baseName} (${suffix})`;
    suffix += 1;
  }

  return candidate;
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
    const { ROOT_DIRS } = await import("@/lib/bookTemplateOPFS");
    const parent = await (window as any).showDirectoryPicker({ mode: "readwrite" });
    const uniqueProjectName = await resolveUniqueProjectName(parent, projectName);
    if (uniqueProjectName !== projectName) {
      console.warn(
        `[ProjectStorage] Project folder "${projectName}" already exists; creating fresh folder "${uniqueProjectName}" instead to avoid reusing stale OPFS data.`,
      );
    }
    const root = await parent.getDirectoryHandle(uniqueProjectName, { create: true });
    for (const d of ROOT_DIRS) {
      await root.getDirectoryHandle(d, { create: true });
    }
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

  /**
   * Request persistent storage from the browser.
   * Called automatically on project creation to prevent OPFS eviction.
   */
  static async requestPersistence(): Promise<boolean> {
    try {
      if (navigator.storage?.persist) {
        const granted = await navigator.storage.persist();
        if (granted) {
          console.info("[OPFS] Persistent storage granted");
        } else {
          console.warn("[OPFS] Persistent storage denied — data may be evicted under storage pressure");
        }
        return granted;
      }
    } catch (err) {
      console.warn("[OPFS] Failed to request persistence:", err);
    }
    return false;
  }

  /**
   * Builds the full directory tree from bookTemplateOPFS (single source of truth).
   *
   * @param overwrite — when true (Wipe-and-Deploy), deletes existing folder with the
   *   same name first instead of appending a numeric suffix.  This prevents
   *   "Собачье сердце (2)" duplicates on repeated server restores.
   *   Default: false (safe unique-name behaviour for normal uploads).
   */
  static async createNewProject(projectName: string, overwrite = false): Promise<OPFSStorage> {
    // Request persistent storage to prevent Chrome from evicting OPFS data
    void OPFSStorage.requestPersistence();

    const { ROOT_DIRS } = await import("@/lib/bookTemplateOPFS");
    const opfsRoot = await navigator.storage.getDirectory();

    let finalName = projectName;

    if (overwrite) {
      // Wipe-and-Deploy path: remove existing folder first, then reuse the name
      if (await hasChildDirectory(opfsRoot as unknown as FileSystemDirectoryHandle, projectName)) {
        try {
          await (opfsRoot as any).removeEntry(projectName, { recursive: true });
          console.log(`[ProjectStorage] Overwrite mode: deleted existing OPFS folder "${projectName}"`);
        } catch (err) {
          console.warn(`[ProjectStorage] Failed to delete existing folder "${projectName}", falling back to unique name`, err);
          finalName = await resolveUniqueProjectName(opfsRoot as unknown as FileSystemDirectoryHandle, projectName);
        }
      }
    } else {
      // Normal upload: never reuse an existing folder
      finalName = await resolveUniqueProjectName(opfsRoot as unknown as FileSystemDirectoryHandle, projectName);
      if (finalName !== projectName) {
        console.warn(
          `[ProjectStorage] OPFS project folder "${projectName}" already exists; creating fresh folder "${finalName}" instead to avoid inheriting legacy files.`,
        );
      }
    }

    const projectDir = await opfsRoot.getDirectoryHandle(finalName, { create: true }) as unknown as FileSystemDirectoryHandle;
    for (const d of ROOT_DIRS) {
      await projectDir.getDirectoryHandle(d, { create: true });
    }
    return new OPFSStorage(projectDir, finalName);
  }

  /**
   * Restore a project from a backup ZIP.
   * Creates an empty OPFS directory (or overwrites existing) and imports the ZIP contents.
   * No pre-created subdirectories — the ZIP defines the full structure.
   */
  static async restoreProjectFromBackup(projectName: string, zip: Blob): Promise<OPFSStorage> {
    const opfsRoot = await navigator.storage.getDirectory();
    // Delete existing project if present (full wipe before restore)
    try {
      await opfsRoot.removeEntry(projectName, { recursive: true });
    } catch {
      // Not found — fine
    }
    const projectDir = await opfsRoot.getDirectoryHandle(projectName, { create: true }) as unknown as FileSystemDirectoryHandle;
    const storage = new OPFSStorage(projectDir, projectName);
    await storage.importZip(zip);
    return storage;
  }

  /**
   * Open an existing project in OPFS WITHOUT creating anything.
   * Returns null if the directory does not exist.
   * Use this for read-only access and scanning.
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
