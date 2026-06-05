import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { Hub } from './hub.js';
import { FeedDiscovery } from './discovery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In the runtime image, static assets live at <app>/public (dist is <app>/dist).
const publicDir = path.resolve(__dirname, '..', 'public');
const appDir = path.join(publicDir, 'app');

const app = express();
const server = createServer(app);
const hub = new Hub();

// --- WebSocket: chat, reactions, roster, time-sync ---
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => hub.add(ws));

// --- Feed discovery (MediaMTX API polling) ---
const discovery = new FeedDiscovery(config, (feeds) => hub.setRoster(feeds));
discovery.start();

// --- HTTP ---
app.get('/healthz', (_req, res) => res.json({ ok: true, time: Date.now() }));

// Runtime config for the browser. The client derives the host from
// window.location.hostname; we only need to tell it the MediaMTX WebRTC port.
app.get('/api/config', (_req, res) => {
  res.json({
    mediamtxWebrtcPort: config.mediamtxWebrtcPort,
    hostIp: config.hostIp, // usually '' -> client uses location.hostname
    serverTime: Date.now(),
  });
});

// OBS browser-source overlay (the timecode strip). Served as static files.
app.use('/overlay', express.static(path.join(publicDir, 'overlay')));

// Built SPA + client-side routing fallback.
app.use(express.static(appDir));
app.get(/^(?!\/(api|ws|overlay|healthz)).*/, (_req, res) => {
  res.sendFile(path.join(appDir, 'index.html'));
});

server.listen(config.port, () => {
  console.log(`[mosaic] listening on :${config.port}`);
  console.log(`[mosaic] MediaMTX API: ${config.mediamtxApiUrl}  WHEP port: ${config.mediamtxWebrtcPort}`);
  console.log(`[mosaic] overlay: http://<host>:${config.port}/overlay/timecode.html?feed=<name>`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    discovery.stop();
    server.close(() => process.exit(0));
  });
}
