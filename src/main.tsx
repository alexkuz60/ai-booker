import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// PWA service-worker guard: не регистрируем в iframe и на превью-доменах Lovable,
// чтобы не ломать редактор и не подсовывать stale-контент.
const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com") ||
  window.location.hostname === "localhost";

if (isPreviewHost || isInIframe) {
  // Снимаем уже зарегистрированные SW (если пользователь до этого ставил PWA)
  navigator.serviceWorker?.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
} else if ("serviceWorker" in navigator) {
  // Регистрация только на опубликованных доменах
  import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}

createRoot(document.getElementById("root")!).render(<App />);

