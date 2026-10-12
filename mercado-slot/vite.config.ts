import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  build: {
    outDir: "../dist-mercado",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      transform: {
        define: {
          "import.meta.url": "__mercado_module_url__",
          "import.meta.resolve": "undefined",
        },
      },
      output: {
        format: "iife",
        name: "MercadoGame",
        codeSplitting: false,
        intro:
          "var __mercado_module_url__ = (document.currentScript && document.currentScript.src) || new URL('index.html', document.baseURI).href;",
      },
    },
  },
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
  preview: { host: "127.0.0.1", port: 4180, strictPort: true },
});
