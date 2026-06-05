# Multi-stage build: compile the React/Vite web app and the Node/TS server,
# then ship a single small runtime image that serves both.

# ---- Stage 1: build the web app (React + TS + Vite) -> /web/dist ----
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---- Stage 2: build the server (TS -> JS) -> /app/dist ----
FROM node:20-alpine AS server
WORKDIR /app
COPY server/package*.json ./
RUN npm install
COPY server/ ./
RUN npm run build

# ---- Stage 3: runtime ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# su-exec: drop root to PUID/PGID (LinuxServer.io-style). tzdata: make TZ resolve.
RUN apk add --no-cache su-exec tzdata
COPY server/package*.json ./
RUN npm install --omit=dev
COPY --from=server /app/dist ./dist
# Static assets: server-owned (overlay) first, then the built SPA.
COPY server/public ./public
COPY --from=web /web/dist ./public/app
COPY entrypoint.sh /entrypoint.sh
# Strip any CR (in case checked out with CRLF on Windows) so /bin/sh runs it.
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
