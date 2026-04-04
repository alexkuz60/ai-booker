import { useState, useCallback, useEffect } from "react";
import {
  type ProjectStorage,
  type ProjectMeta,
  type StorageBackend,
  PROJECT_META_VERSION,
  detectStorageBackend,
  LocalFSStorage,
  OPFSStorage,
} from "@/lib/projectStorage";
import { downloadBlob } from "@/lib/projectZip";
import { readSceneIndex } from "@/lib/sceneIndex";
import { readBookMap } from "@/lib/bookMap";

const LAST_PROJECT_KEY = "booker_last_project";

const LOCAL_RESET_KEYS = [
  LAST_PROJECT_KEY,
  "parser-active-book",
  "parser-nav-state",
  // К4: docx_chapter_texts and docx_html removed — now in-memory only
];

interface UseProjectStorageReturn {
  /** Current storage instance (null = no project open) */
  storage: ProjectStorage | null;
  /** Project metadata */
  meta: ProjectMeta | null;
  /** Which backend is available */
  backend: StorageBackend;
  /** Whether local storage init/restore phase is completed */
  initialized: boolean;
  /** Whether a project is currently open */
  isOpen: boolean;
  /** Loading state */
  loading: boolean;
  /** Monotonically increasing counter — bumped whenever pipeline progress changes */
  progressVersion: number;
  /** Bump progressVersion so consumers re-read pipeline progress */
  bumpProgressVersion: () => void;

  /** Create new project (opens folder picker on Chromium) */
  createProject: (title: string, bookId: string, userId: string, language: "ru" | "en") => Promise<ProjectStorage>;
  /** Open existing project folder */
  openProject: () => Promise<ProjectStorage>;
  /** Open specific OPFS project by directory name and make it active */
  openProjectByName: (projectName: string) => Promise<ProjectStorage | null>;
  /** Open project from a ZIP file (cross-browser) */
  importProjectFromZip: (file: File) => Promise<ProjectStorage>;
  /** Download current project as ZIP */
  downloadProjectAsZip: () => Promise<void>;
  /** Close current project */
  closeProject: () => void;
  /** Hard-reset all locally persisted parser data for this browser */
  hardResetLocalData: () => Promise<void>;
}

export function useProjectStorage(): UseProjectStorageReturn {
  const [storage, setStorage] = useState<ProjectStorage | null>(null);
  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [progressVersion, setProgressVersion] = useState(0);
  const backend = detectStorageBackend();

  const bumpProgressVersion = useCallback(() => {
    setProgressVersion(v => v + 1);
  }, []);

  // ── Create new project ──────────────────────────────────

  const createProject = useCallback(async (
    title: string,
    bookId: string,
    userId: string,
    language: "ru" | "en",
  ): Promise<ProjectStorage> => {
    setLoading(true);
    try {
      const folderName = title.replace(/[<>:"/\\|?*]/g, "_").trim() || "BookProject";

      let store: ProjectStorage;
      if (backend === "fs-access") {
        store = await LocalFSStorage.createProject(folderName);
      } else {
        store = await OPFSStorage.openOrCreate(folderName);
      }

      const projectMeta: ProjectMeta = {
        version: PROJECT_META_VERSION,
        bookId,
        title,
        userId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        language,
      };

      await store.writeJSON("project.json", projectMeta);
      await readSceneIndex(store);
      await readBookMap(store);
      setStorage(store);
      setMeta(projectMeta);

      try {
        localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify({
          name: store.projectName,
          backend,
          bookId,
        }));
      } catch {}

      return store;
    } finally {
      setLoading(false);
    }
  }, [backend]);

  // ── Open existing project ───────────────────────────────

  const openProject = useCallback(async (): Promise<ProjectStorage> => {
    setLoading(true);
    try {
      let store: ProjectStorage;
      if (backend === "fs-access") {
        store = await LocalFSStorage.openProject();
      } else {
        const projects = await OPFSStorage.listProjects();
        if (projects.length === 0) throw new Error("No projects found");
        const maybeStore = await OPFSStorage.openExisting(projects[0]);
        if (!maybeStore) throw new Error("Failed to open OPFS project: " + projects[0]);
        store = maybeStore;
      }

      const projectMeta = await store.readJSON<ProjectMeta>("project.json");
      if (!projectMeta) {
        throw new Error("Not a valid Booker project (project.json not found)");
      }

      setStorage(store);
      setMeta(projectMeta);

      try {
        localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify({
          name: store.projectName,
          backend,
          bookId: projectMeta.bookId,
        }));
      } catch {}

      return store;
    } finally {
      setLoading(false);
    }
  }, [backend]);

  const openProjectByName = useCallback(async (projectName: string): Promise<ProjectStorage | null> => {
    if (!projectName) return null;

    if (backend !== "opfs") {
      if (storage?.projectName === projectName && meta) {
        await readSceneIndex(storage);
        await readBookMap(storage);
        return storage;
      }
      return null;
    }

    setLoading(true);
    try {
      // Open directly by name — no need to scan all projects
      const store = await OPFSStorage.openExisting(projectName);
      if (!store) {
        return null;
      }
      const projectMeta = await store.readJSON<ProjectMeta>("project.json");
      if (!projectMeta) {
        throw new Error("Not a valid Booker project (project.json not found)");
      }

      await readSceneIndex(store);
      await readBookMap(store);

      setStorage(store);
      setMeta(projectMeta);

      try {
        localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify({
          name: store.projectName,
          backend,
          bookId: projectMeta.bookId,
        }));
      } catch {}

      return store;
    } finally {
      setLoading(false);
    }
  }, [backend, storage, meta]);

  // ── Import project from ZIP ─────────────────────────────

  const importProjectFromZip = useCallback(async (file: File): Promise<ProjectStorage> => {
    setLoading(true);
    try {
      // Derive project name from ZIP filename
      const projectName = file.name.replace(/\.zip$/i, "").trim() || "ImportedProject";

      let store: ProjectStorage;
      if (backend === "fs-access") {
        store = await LocalFSStorage.createProject(projectName);
      } else {
        store = await OPFSStorage.openOrCreate(projectName);
      }

      await store.importZip(file);

      const projectMeta = await store.readJSON<ProjectMeta>("project.json");
      if (!projectMeta) {
        throw new Error("ZIP does not contain a valid Booker project (project.json not found)");
      }

      setStorage(store);
      setMeta(projectMeta);

      try {
        localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify({
          name: store.projectName,
          backend,
          bookId: projectMeta.bookId,
        }));
      } catch {}

      return store;
    } finally {
      setLoading(false);
    }
  }, [backend]);

  // ── Download project as ZIP ─────────────────────────────

  const downloadProjectAsZip = useCallback(async () => {
    if (!storage) throw new Error("No project open");
    setLoading(true);
    try {
      const zipBlob = await storage.exportZip();
      const fileName = `${storage.projectName || "project"}.zip`;
      downloadBlob(zipBlob, fileName);
    } finally {
      setLoading(false);
    }
  }, [storage]);

  // ── Close project ───────────────────────────────────────

  const closeProject = useCallback(() => {
    setStorage(null);
    setMeta(null);
    try { localStorage.removeItem(LAST_PROJECT_KEY); } catch {}
  }, []);

  const hardResetLocalData = useCallback(async () => {
    setLoading(true);
    try {
      setStorage(null);
      setMeta(null);

      if (backend === "opfs") {
        const projectNames = await OPFSStorage.listProjects();
        await Promise.all(projectNames.map((projectName) => OPFSStorage.deleteProject(projectName)));
      }

      for (const key of LOCAL_RESET_KEYS) {
        try { localStorage.removeItem(key); } catch {}
        try { sessionStorage.removeItem(key); } catch {}
      }
    } finally {
      setLoading(false);
    }
  }, [backend]);


  // ── Auto-restore OPFS project on mount ──────────────────

  useEffect(() => {
    let cancelled = false;

    if (backend !== "opfs") {
      setInitialized(true);
      return () => {
        cancelled = true;
      };
    }

    const bootstrap = async () => {
      try {
        const saved = localStorage.getItem(LAST_PROJECT_KEY);
        if (!saved) return;

        let targetName: string | null = null;
        try {
          const { name, backend: savedBackend } = JSON.parse(saved);
          if (savedBackend === "opfs" && name) {
            targetName = name;
          }
        } catch {
          console.warn("[ProjectStorage] Corrupted LAST_PROJECT_KEY, ignoring");
          return;
        }

        if (!targetName) return;

        const store = await OPFSStorage.openExisting(targetName);
        if (!store) {
          console.warn("[ProjectStorage] Saved OPFS project not found:", targetName);
          return;
        }
        const rawMeta = await store.readJSON<Record<string, unknown>>("project.json");
        if (!rawMeta) {
          console.warn("[ProjectStorage] project.json missing in", targetName);
          return;
        }

        // Migrate legacy translation fields → translationLanguages before sanitizing
        if (!rawMeta.translationLanguages || !(rawMeta.translationLanguages as string[]).length) {
          const legacyLang =
            (rawMeta.targetLanguage as string) ||
            ((rawMeta.translationProject as Record<string, unknown>)?.targetLanguage as string);
          if (legacyLang) {
            rawMeta.translationLanguages = [legacyLang];
            console.info("[ProjectStorage] Migrated legacy targetLanguage →", legacyLang);
          }
        }

        // Sanitize — strip zombie fields (translationProject, targetLanguage, etc.)
        const { sanitizeProjectMeta } = await import("@/lib/projectStorage");
        const projectMeta = sanitizeProjectMeta(rawMeta) as ProjectMeta;
        await store.writeJSON("project.json", projectMeta);

        // One book = one folder. No multi-candidate resolution.
        // Use exactly the project from LAST_PROJECT_KEY.
        await readSceneIndex(store);
        await readBookMap(store);

        if (!cancelled) {
          setStorage(store);
          setMeta(projectMeta);
          try {
            localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify({
              name: targetName,
              backend,
              bookId: projectMeta.bookId,
            }));
          } catch {}
          console.info("[ProjectStorage] Restored project:", targetName, "bookId:", projectMeta.bookId);
        }
      } catch (err) {
        console.warn("[ProjectStorage] Bootstrap error:", err);
      } finally {
        if (!cancelled) setInitialized(true);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [backend]);

  return {
    storage,
    meta,
    backend,
    initialized,
    isOpen: !!storage,
    loading,
    progressVersion,
    bumpProgressVersion,
    createProject,
    openProject,
    openProjectByName,
    importProjectFromZip,
    downloadProjectAsZip,
    closeProject,
    hardResetLocalData,
  };
}
