import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(rootDir, "../..");

export default defineConfig({
  root: rootDir,
  base: "./",
  plugins: [vue()],
  build: {
    chunkSizeWarningLimit: 4300,
    rollupOptions: {
      input: "index.html",
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@xterm")) return "vendor-terminal"
          if (id.includes("node_modules/vue") || id.includes("node_modules/pinia")) return "vendor-vue"
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    strictPort: true,
    fs: {
      allow: [rootDir, repoRoot],
    },
  },
});
