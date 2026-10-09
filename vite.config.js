import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 3000,
    rolldownOptions: { output: { codeSplitting: false } },
  },
  server: { port: 5173, strictPort: true },
  optimizeDeps: { entries: ["index.html"] },
});
