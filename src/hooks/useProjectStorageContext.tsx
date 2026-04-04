import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useProjectStorage } from "@/hooks/useProjectStorage";

type ProjectStorageContextValue = ReturnType<typeof useProjectStorage>;

const ProjectStorageContext = createContext<ProjectStorageContextValue | null>(null);

export function ProjectStorageProvider({ children }: { children: ReactNode }) {
  const value = useProjectStorage();

  // Memoize context value to prevent cascading re-renders when parent re-renders
  // but none of the storage values actually changed.
  const stable = useMemo(
    () => value,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      value.storage,
      value.meta,
      value.backend,
      value.initialized,
      value.isOpen,
      value.loading,
      value.progressVersion,
      value.bumpProgressVersion,
      value.createProject,
      value.openProject,
      value.openProjectByName,
      value.importProjectFromZip,
      value.downloadProjectAsZip,
      value.closeProject,
      value.hardResetLocalData,
    ],
  );

  return <ProjectStorageContext.Provider value={stable}>{children}</ProjectStorageContext.Provider>;
}

export function useProjectStorageContext() {
  const ctx = useContext(ProjectStorageContext);
  if (!ctx) {
    throw new Error("useProjectStorageContext must be used within ProjectStorageProvider");
  }
  return ctx;
}
