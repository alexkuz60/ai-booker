import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api/omnivoice": {
        target: "http://127.0.0.1:8880",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/omnivoice/, ""),
      },
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      // Сервис-воркер выключен в dev. В preview Lovable он также не запустится из-за guard в main.tsx.
      devOptions: { enabled: false },
      includeAssets: ["favicon.ico", "apple-touch-icon.png"],
      manifest: {
        name: "Booker Studio",
        short_name: "Booker",
        description: "AI-Booker Studio — производство аудиокниг с ИИ",
        theme_color: "#6B46C1",
        background_color: "#0F0F12",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        lang: "ru",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        // Нельзя кэшировать OAuth-редиректы и edge-functions
        navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//, /^\/functions\//],
        // SW кэширует только лёгкий shell. Тяжёлые ассеты (WASM ORT, ONNX-модели,
        // hero-картинки) грузятся on-demand и хранятся в OPFS — не дублируем их в SW-кэше.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,ico,woff,woff2}"],
        globIgnores: [
          "**/assets/booker_*.webp",
          "**/*.wasm",
          "**/*.onnx",
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
