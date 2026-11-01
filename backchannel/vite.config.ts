import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Two pages: the landing page (index.html) and the console (app.html).
// `--mode demo` builds the hosted read-only demo, which replays a recorded run instead of
// talking to a local server.
export default defineConfig(({ mode }) => ({
  root: "web",
  base: "/",
  plugins: [react()],
  define: { __DEMO__: JSON.stringify(mode === "demo") },
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, "web/index.html"), app: resolve(import.meta.dirname, "web/app.html") },
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:47321", changeOrigin: false } },
  },
  test: { root: ".", include: ["tests/**/*.test.ts"], testTimeout: 15_000 },
}));
