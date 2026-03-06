import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

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
  return <Ctx.Provider value={{ ...state, setPageHeader }}>{children}</Ctx.Provider>;
}

export function usePageHeader() {
  return useContext(Ctx);
}
