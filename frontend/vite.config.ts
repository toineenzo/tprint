import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Output filenames are deliberately unhashed. The bundle is served by FastAPI
// through a Jinja shell (app/templates/base.html), so a hashed name would mean
// teaching Python to read Vite's manifest. Cache-busting instead rides on
// ?v={{ build_date }}, which templating.py already exposes and which changes
// on every Docker image build.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "../app/static/dist"),
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, "src/main.tsx"),
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "app-[name].js",
        assetFileNames: "app.[ext]",
      },
    },
  },
});
