import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 3000,
    // HTMLPreview re-injects inline scripts as classic scripts. A single IIFE
    // also works in the normal module entry, without leaking bundled globals.
    rolldownOptions: {
      transform: {
        define: {
          "import.meta.url": "__penalty_module_url__",
          "import.meta.resolve": "undefined",
        },
      },
      output: {
        format: "iife",
        name: "PenaltyGame",
        codeSplitting: false,
        intro:
          "var __penalty_module_url__ = (document.currentScript && document.currentScript.src) || new URL('standalone.html', document.baseURI).href;",
      },
    },
  },
  server: { port: 5173, strictPort: true },
  optimizeDeps: { entries: ["index.html"] },
});
