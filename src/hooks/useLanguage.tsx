import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type Lang = "ru" | "en";

interface LanguageContextType {
  lang: Lang;
  isRu: boolean;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = "app-language";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return (localStorage.getItem(STORAGE_KEY) as Lang) || "ru";
    } catch {
      return "ru";
    }
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
  };

  const toggleLang = () => setLang(lang === "ru" ? "en" : "ru");

  return (
    <LanguageContext.Provider value={{ lang, isRu: lang === "ru", setLang, toggleLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
