import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build` -> normal build for Tauri (dist/)
// `npm run build:single` -> one self-contained HTML file for browser preview (dist-single/)
export default defineConfig(({ mode }) => ({
  plugins: mode === "single" ? [react(), viteSingleFile()] : [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    outDir: mode === "single" ? "dist-single" : "dist",
    target: "es2021",
    assetsInlineLimit: mode === "single" ? 100_000_000 : 4096,
  },
}));
