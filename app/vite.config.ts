import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Same-origin proxy so `/auth/*` calls carry the httpOnly refresh + CSRF
  // cookies in dev (ADR 0007). Everything else hits API_BASE directly with a
  // bearer token, so only auth + its websockets are proxied here.
  server: {
    proxy: {
      "/auth": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
});
