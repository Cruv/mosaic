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

// --- WHEP signaling proxy ---------------------------------------------------
// The browser does its SDP exchange against THIS server (same origin) and we
// relay it to MediaMTX. This sidesteps cross-origin CORS to MediaMTX's :8889
// (its preflight handling is fiddly) — the actual media still flows directly
// browser <-> MediaMTX over UDP, since the relayed SDP answer carries
// MediaMTX's own ICE candidates (HOST_IP:8189).
const MTX_WEBRTC = `http://127.0.0.1:${config.mediamtxWebrtcPort}`;

app.post('/whep/:feed', express.text({ type: '*/*', limit: '2mb' }), async (req, res) => {
  const target = `${MTX_WEBRTC}/${encodeURIComponent(req.params.feed)}/whep`;
  try {
    const up = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: typeof req.body === 'string' ? req.body : '',
    });
    const sdp = await up.text();
    const loc = up.headers.get('Location');
    if (loc) {
      // Rewrite the session resource to a same-origin path we can proxy DELETE to.
      const abs = new URL(loc, target);
      res.setHeader('Location', `/whep-resource?path=${encodeURIComponent(abs.pathname + abs.search)}`);
    }
    res.status(up.status).type('application/sdp').send(sdp);
  } catch (err) {
    res.status(502).type('text/plain').send(`whep proxy error: ${(err as Error).message}`);
  }
});

app.delete('/whep-resource', async (req, res) => {
  const p = typeof req.query.path === 'string' ? req.query.path : '';
  if (!p.startsWith('/') || !p.includes('/whep')) {
    res.status(400).end();
    return;
  }
  try {
    const up = await fetch(`${MTX_WEBRTC}${p}`, { method: 'DELETE' });
    res.status(up.status).end();
  } catch {
    res.status(502).end();
  }
});

// OBS browser-source overlay (the timecode strip). Served as static files.
app.use('/overlay', express.static(path.join(publicDir, 'overlay')));

// Built SPA + client-side routing fallback.
app.use(express.static(appDir));
app.get(/^(?!\/(api|ws|overlay|healthz|whep)).*/, (_req, res) => {
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
