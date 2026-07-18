import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The dashboard API is served by the Node server (default port 3457). In dev,
// Vite runs on 5173 and proxies /api to that server so the SPA can use
// same-origin relative fetches in both dev and production.
const API_TARGET = process.env.SWARM_API ?? "http://localhost:3457";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
    },
  },
});
