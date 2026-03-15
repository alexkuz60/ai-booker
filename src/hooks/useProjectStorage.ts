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

const LAST_PROJECT_KEY = "booker_last_project";

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

  /** Create new project (opens folder picker on Chromium) */
  createProject: (title: string, bookId: string, userId: string, language: "ru" | "en") => Promise<ProjectStorage>;
  /** Open existing project folder */
  openProject: () => Promise<ProjectStorage>;
  /** Open project from a ZIP file (cross-browser) */
  importProjectFromZip: (file: File) => Promise<ProjectStorage>;
  /** Download current project as ZIP */
  downloadProjectAsZip: () => Promise<void>;
  /** Close current project */
  closeProject: () => void;

  /** Save PDF source file into project */
  saveSourcePDF: (file: File) => Promise<void>;
  /** Read source PDF from project */
  readSourcePDF: () => Promise<File | null>;
}

export function useProjectStorage(): UseProjectStorageReturn {
  const [storage, setStorage] = useState<ProjectStorage | null>(null);
  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const backend = detectStorageBackend();

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
        store = await OPFSStorage.openOrCreate(projects[0]);
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

  // ── PDF helpers ─────────────────────────────────────────

  const saveSourcePDF = useCallback(async (file: File) => {
    if (!storage) throw new Error("No project open");
    await storage.writeBlob("source/book.pdf", file);
  }, [storage]);

  const readSourcePDF = useCallback(async (): Promise<File | null> => {
    if (!storage) return null;
    const blob = await storage.readBlob("source/book.pdf");
    if (!blob) return null;
    return new File([blob], "book.pdf", { type: "application/pdf" });
  }, [storage]);

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

        const { name, backend: savedBackend } = JSON.parse(saved);
        if (savedBackend !== "opfs" || !name) return;

        const store = await OPFSStorage.openOrCreate(name);
        const projectMeta = await store.readJSON<ProjectMeta>("project.json");

        if (!cancelled && projectMeta) {
          setStorage(store);
          setMeta(projectMeta);
        }
      } catch {
        // ignore bootstrap errors, app can still work without restored project
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
    createProject,
    openProject,
    importProjectFromZip,
    downloadProjectAsZip,
    closeProject,
    saveSourcePDF,
    readSourcePDF,
  };
}
