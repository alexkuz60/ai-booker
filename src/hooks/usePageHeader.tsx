import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

interface PageHeaderState {
  title?: string;
  subtitle?: string;
  headerRight?: ReactNode;
}

interface PageHeaderCtx extends PageHeaderState {
  setPageHeader: (state: PageHeaderState) => void;
}

const Ctx = createContext<PageHeaderCtx>({
  setPageHeader: () => {},
});

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageHeaderState>({});
  const setPageHeader = useCallback((s: PageHeaderState) => setState(s), []);

  // Memoize context value to prevent unnecessary consumer re-renders
  const value = useMemo(
    () => ({ ...state, setPageHeader }),
    [state, setPageHeader],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageHeader() {
  return useContext(Ctx);
}
