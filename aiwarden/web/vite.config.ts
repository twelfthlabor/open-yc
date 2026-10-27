/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The collector (python -m aiwarden serve) serves the build from the Python package, so `pip install`
// needs no Node. Dev: run a collector on :8765 (npm run demo) and `npm run dev`; /api is proxied to it.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../src/aiwarden/static/app",
    emptyOutDir: true,
    assetsInlineLimit: 0, // the CSP allows no data: fonts or scripts
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 700,
  },
  server: { proxy: { "/api": "http://127.0.0.1:8765" } },
  test: { environment: "jsdom" },
});
