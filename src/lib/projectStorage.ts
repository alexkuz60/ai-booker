/**
 * ProjectStorage — абстракция локального хранилища проекта книги.
 *
 * Структура папок проекта:
 *   📁 BookTitle/
 *   ├── project.json          — метаданные проекта (bookId, title, userId, etc.)
 *   ├── 📁 source/
 *   │   └── book.pdf          — исходный PDF
 *   ├── 📁 structure/
 *   │   ├── toc.json          — оглавление (TocChapter[])
 *   │   ├── parts.json        — части книги
 *   │   ├── chapters.json     — главы
 *   │   └── characters.json   — персонажи
 *   ├── 📁 scenes/
 *   │   ├── scene_{id}.json   — сцена с сегментами и фразами
 *   │   └── ...
 *   ├── 📁 audio/
 *   │   ├── 📁 tts/           — синтезированные сегменты
 *   │   │   └── {segmentId}.mp3
 *   │   ├── 📁 atmosphere/    — атмосферные слои
 *   │   └── 📁 renders/       — финальные рендеры сцен
 *   └── 📁 montage/
 *       └── ...               — данные монтажа
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

// ─── Project metadata ────────────────────────────────────

export interface ProjectMeta {
  version: number;
  bookId: string;
  title: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  language: "ru" | "en";
}

export const PROJECT_META_VERSION = 1;

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
    // TODO: implement with a lightweight ZIP library when needed
    throw new Error("exportZip not yet implemented");
  }

  async importZip(_zip: Blob): Promise<void> {
    throw new Error("importZip not yet implemented");
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
    await root.getDirectoryHandle("source", { create: true });
    await root.getDirectoryHandle("structure", { create: true });
    await root.getDirectoryHandle("scenes", { create: true });
    const audio = await root.getDirectoryHandle("audio", { create: true });
    await audio.getDirectoryHandle("tts", { create: true });
    await audio.getDirectoryHandle("atmosphere", { create: true });
    await audio.getDirectoryHandle("renders", { create: true });
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
    throw new Error("exportZip not yet implemented");
  }

  async importZip(_zip: Blob): Promise<void> {
    throw new Error("importZip not yet implemented");
  }

  /** Create or open project in OPFS */
  static async openOrCreate(projectName: string): Promise<OPFSStorage> {
    const opfsRoot = await navigator.storage.getDirectory();
    const projectDir = await opfsRoot.getDirectoryHandle(projectName, { create: true }) as unknown as FileSystemDirectoryHandle;
    // Ensure subdirs
    await projectDir.getDirectoryHandle("source", { create: true });
    await projectDir.getDirectoryHandle("structure", { create: true });
    await projectDir.getDirectoryHandle("scenes", { create: true });
    const audio = await projectDir.getDirectoryHandle("audio", { create: true });
    await audio.getDirectoryHandle("tts", { create: true });
    await audio.getDirectoryHandle("atmosphere", { create: true });
    await audio.getDirectoryHandle("renders", { create: true });
    await projectDir.getDirectoryHandle("montage", { create: true });
    return new OPFSStorage(projectDir, projectName);
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
