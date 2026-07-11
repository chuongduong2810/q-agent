import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";

// Dev-only stopgap: serve the Local Agent installers from the repo `downloads/`
// dir at `/downloads/*`, mirroring the production nginx route. Lets the dev
// server (when it's what a Cloudflare tunnel fronts) hand out the installer;
// in real production the docker `web`/nginx container serves this instead.
function serveDownloads(): PluginOption {
  const dir = path.resolve(__dirname, "../downloads");
  return {
    name: "serve-downloads",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith("/downloads/")) return next();
        const rel = decodeURIComponent(req.url.split("?")[0].slice("/downloads/".length));
        const filePath = path.join(dir, rel);
        if (filePath !== dir && !filePath.startsWith(dir + path.sep)) {
          res.statusCode = 403;
          return res.end("Forbidden");
        }
        fs.stat(filePath, (err, st) => {
          if (err || !st.isFile()) {
            res.statusCode = 404;
            return res.end("Not found");
          }
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Content-Disposition", "attachment");
          res.setHeader("Content-Length", String(st.size));
          fs.createReadStream(filePath).pipe(res);
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), serveDownloads()],
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
