import { createContext, useContext, useState, useCallback, useMemo, useRef, type ReactNode } from "react";

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

  // Compare before setting to avoid unnecessary re-renders
  const setPageHeader = useCallback((s: PageHeaderState) => {
    setState(prev => {
      if (prev.title === s.title && prev.subtitle === s.subtitle && prev.headerRight === s.headerRight) {
        return prev; // same values — skip re-render
      }
      return s;
    });
  }, []);

  const value = useMemo(
    () => ({ ...state, setPageHeader }),
    [state, setPageHeader],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageHeader() {
  return useContext(Ctx);
}
