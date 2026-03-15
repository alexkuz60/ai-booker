import { createContext, useContext, type ReactNode } from "react";
import { useProjectStorage } from "@/hooks/useProjectStorage";

type ProjectStorageContextValue = ReturnType<typeof useProjectStorage>;

const ProjectStorageContext = createContext<ProjectStorageContextValue | null>(null);

export function ProjectStorageProvider({ children }: { children: ReactNode }) {
  const value = useProjectStorage();
  return <ProjectStorageContext.Provider value={value}>{children}</ProjectStorageContext.Provider>;
}

export function useProjectStorageContext() {
  const ctx = useContext(ProjectStorageContext);
  if (!ctx) {
    throw new Error("useProjectStorageContext must be used within ProjectStorageProvider");
  }
  return ctx;
}
