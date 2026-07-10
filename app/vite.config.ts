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
    // Hosts allowed to reach the dev server (Vite's DNS-rebinding guard).
    // Needed when the dev server is fronted by a tunnel/custom domain
    // (e.g. a Cloudflare tunnel). Use a leading dot to allow all subdomains.
    allowedHosts: ["qagent.chuongnd.click", ".chuongnd.click"],
    proxy: {
      // Same-origin API access. The frontend calls `/api/*` (see API_BASE in
      // lib/api.ts) and Vite forwards to the backend with the `/api` prefix
      // stripped. This keeps everything one origin — so it works behind a
      // single tunnel with no CORS — and the `/api` prefix avoids colliding
      // with the SPA's own client routes (`/runs`, `/projects`, …). `ws: true`
      // also carries the `/api/ws/*` websockets.
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      // Auth stays same-origin on its own path so the httpOnly refresh + CSRF
      // cookies flow (ADR 0007).
      "/auth": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
    port: 5173
  },
});
