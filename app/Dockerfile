# syntax=docker/dockerfile:1

# Q-Agent frontend.
#
# Stage 1 builds the Vite/React SPA; stage 2 serves the static bundle with nginx
# on :5174. nginx also reverse-proxies the same-origin /api, /auth and websocket
# paths to the api container (nginx.conf), so the whole app stays one origin
# behind a single Cloudflare tunnel — exactly like the Vite dev proxy.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# VITE_API_BASE is intentionally left unset → the client defaults to the
# same-origin "/api" prefix that nginx proxies to the backend.
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 5174
