# Mosaic — synchronized multi-stream viewer

Mosaic is a self-hosted, local/community version of a live esports broadcast. Multiple people
push their OBS feeds to your server over WebRTC; viewers watch them in a browser as a single,
**time-aligned multi-camera experience**. A "program" feed auto-switches like a live director, or
a viewer pins a feed / arranges picture-in-picture — and every visible feed shows the *same captured
instant*, so reactions and chat land together for everyone.

The **sync engine is the point of the product.** It deliberately runs a few hundred ms behind live
so it can align independent feeds to within roughly **1–2 frames** of each other. This README
documents how it works, the alignment it actually achieves, and exactly where the residual error
comes from.

---

## Contents

- [Architecture](#architecture)
- [Usage](#usage)
- [Parameters](#parameters)
- [Connecting OBS (streamer setup)](#connecting-obs-streamer-setup)
- [Using the viewer](#using-the-viewer)
- [How the sync engine works](#how-the-sync-engine-works)
- [Sync quality: alignment, latency, and error sources](#sync-quality-alignment-latency-and-error-sources)
- [Local development (no Docker)](#local-development-no-docker)
- [Known limitations & roadmap](#known-limitations--roadmap)
- [Repository layout](#repository-layout)

---

## Architecture

Three planes — a **media plane** (MediaMTX moves the WebRTC bytes), a **control plane** (the Mosaic
Node server does discovery, chat, and time-sync), and a **presentation plane** (the browser viewer,
where the sync engine lives).

```
                       ┌──────────────────────────── MEDIA PLANE ───────────────────────────┐
 [OBS streamer] ──WHIP/WebRTC──▶ [MediaMTX] ──WHEP/WebRTC──▶  [Browser viewer · N feeds]
   + timecode overlay              │                               ▲
     (OBS browser source)          │ Control API /v3/paths/list    │ WebSocket
        │                          ▼   (live-feed discovery)       │ (roster · chat · reactions
        └─────────────────▶ [Mosaic server · Node/TS] ◀────────────┘  · NTP-style time-sync)
                              CONTROL PLANE
```

- **MediaMTX** — pure WebRTC relay. WHIP ingest at `:8889/<feed>/whip`, WHEP playback at
  `:8889/<feed>/whep`, control API at `:9997`. No app logic.
- **Mosaic server** (`server/`) — polls MediaMTX's API ~1 Hz to maintain the live-feed roster (this
  is how drop-in/drop-out works — there is no coordinated start); a WebSocket hub for chat, reactions,
  roster push, and a time-sync service clients use to estimate their offset to the server's
  NTP-disciplined clock; also serves the built viewer and the timecode overlay, and proxies WHEP
  signaling to MediaMTX so the browser stays same-origin (no cross-origin CORS).
- **Web viewer** (`web/`) — a WHEP `RTCPeerConnection` per feed and the **sync engine**: it measures
  each feed's true capture time, aligns every visible feed to a common target presentation time
  derived from the most-delayed feed, and presents frames against that shared timeline. Plus the UI:
  program view with a swappable auto-director, manual pin, PiP, roster, fullscreen, volume, chat,
  reactions, and a live sync HUD.

**Where sync happens:** the shared timeline is the server's clock. Each feed's per-frame capture time
is read off a timecode band burned into the video by an OBS browser-source overlay; the engine then
delays the leading feeds (holding their frames in a buffer) so they all present the same captured
instant. See [How the sync engine works](#how-the-sync-engine-works).

---

## Usage

Set **`HOST_IP`** (this box's LAN IP) and you're done — viewers open `http://<HOST_IP>:8080` and
streamers point OBS at `http://<HOST_IP>:8889/<name>/whip` (see
[Connecting OBS](#connecting-obs-streamer-setup)). The image is published multi-arch (amd64 + arm64)
to GHCR and follows LinuxServer.io (`PUID`/`PGID`/`TZ`) conventions. Run it on a Linux host (TrueNAS
SCALE box or a Linux VM) whose clock is NTP-disciplined (`chrony`/`systemd-timesyncd`) — that clock
is the shared timeline every feed aligns to.

> **Testing with two OBS streamers?** [**TESTING.md**](TESTING.md) is a copy-paste walkthrough you
> can hand straight to a friend.

> **Host networking is required** (not bound behind Nginx Proxy Manager like my other stacks): WebRTC
> media can't traverse Docker's NAT or a reverse proxy. You *can* still front the `:8080` web UI with
> NPM (proxy to `127.0.0.1:8080`) for TLS on the UI itself.

First grab the MediaMTX config into your stack folder:

```bash
mkdir -p mediamtx
curl -fsSL https://raw.githubusercontent.com/Cruv/mosaic/main/mediamtx/mediamtx.yml -o mediamtx/mediamtx.yml
```

### docker-compose (recommended)

```yaml
---
services:
  mediamtx:
    image: bluenviron/mediamtx:latest
    container_name: mosaic-mediamtx
    network_mode: host
    environment:
      - TZ=Etc/UTC
      - MTX_WEBRTCADDITIONALHOSTS=192.168.1.50    # <-- this box's LAN IP
      - MTX_AUTHINTERNALUSERS_0_PASS=changeme     # OBS publish password
    volumes:
      - ./mediamtx/mediamtx.yml:/mediamtx.yml:ro
    restart: unless-stopped

  mosaic:
    image: ghcr.io/cruv/mosaic:latest
    container_name: mosaic
    network_mode: host
    depends_on:
      - mediamtx
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Etc/UTC
      - HOST_IP=192.168.1.50                       # <-- same LAN IP
      - MOSAIC_PORT=8080
      - MEDIAMTX_API_URL=http://127.0.0.1:9997
      - MEDIAMTX_WEBRTC_PORT=8889
    restart: unless-stopped
```

```bash
docker compose up -d
```

> The image (`ghcr.io/cruv/mosaic`) is public, so this pulls with no login. The repo also ships this
> compose with values read from a `.env` (`cp .env.example .env`); to build locally instead of
> pulling, uncomment `build: .` under the `mosaic` service and run `docker compose up --build -d`.

### docker cli

```bash
docker run -d --name mosaic-mediamtx --network host \
  -e TZ=Etc/UTC \
  -e MTX_WEBRTCADDITIONALHOSTS=192.168.1.50 \
  -e MTX_AUTHINTERNALUSERS_0_PASS=changeme \
  -v "$(pwd)/mediamtx/mediamtx.yml:/mediamtx.yml:ro" \
  --restart unless-stopped \
  bluenviron/mediamtx:latest

docker run -d --name mosaic --network host \
  -e PUID=1000 -e PGID=1000 -e TZ=Etc/UTC \
  -e HOST_IP=192.168.1.50 \
  -e MOSAIC_PORT=8080 \
  -e MEDIAMTX_API_URL=http://127.0.0.1:9997 \
  -e MEDIAMTX_WEBRTC_PORT=8889 \
  --restart unless-stopped \
  ghcr.io/cruv/mosaic:latest
```

### Public access (NPM + Let's Encrypt)

Want a remote friend to join with just a browser + OBS — no Tailscale? Front Mosaic with Nginx Proxy
Manager + a Let's Encrypt cert. That handles HTTPS/secure-context and removes the "OBS rejects
self-signed cert" blocker. **But NPM only proxies the HTTP/WebSocket signaling — the WebRTC _media_
is UDP and bypasses the proxy.** You need both halves:

**1. Signaling (NPM + TLS)** — two proxy hosts, each with a cert and **Websockets Support** enabled:

| Domain | Forward to | Used by |
| --- | --- | --- |
| `watch.example.com` | `127.0.0.1:8080` | viewers (UI, WebSocket, WHEP signaling) |
| `ingest.example.com` | `127.0.0.1:8889` | OBS publish |

Viewers open `https://watch.example.com`; OBS **Server** = `https://ingest.example.com/<name>/whip`.
The web app auto-upgrades to `wss://` and uses a same-origin `/whep` path under HTTPS — no config
change needed. (Serving over HTTPS also makes the viewer a *secure context*, unlocking the WebCodecs
upgrade path.)

**2. Media (UDP — the part NPM can't carry):**
- **Port-forward `8189/udp`** on your router to this host.
- Advertise your public address and enable STUN. In `.env` set `HOST_IP=<your.public.ip>` (or both
  LAN + public: `MTX_WEBRTCADDITIONALHOSTS=192.168.1.50,<public-ip>`), and uncomment the STUN entry
  in `mediamtx/mediamtx.yml`.
- If a viewer is behind a **strict/symmetric NAT** and media still won't connect, add a **TURN**
  relay (e.g. `coturn`) to `webrtcICEServers2` — STUN alone can't punch every NAT.

**Heads-up:** this exposes the server publicly — keep `MEDIAMTX_PUBLISH_PASS` set, and decide whether
viewing should stay open to the LAN-default "anyone". (Single domain instead of two? You'd add a Node
WHIP proxy or an NPM regex location for `/<name>/whip` → `:8889`.)

---

## Parameters

Container settings (compose `environment:` / docker `-e`), LinuxServer.io style. Both services share
the **host network**, so there are no `-p` mappings — the ports below are what each service binds.

| Parameter | Function |
| :---: | --- |
| `--network host` | **Required** on both services. WebRTC (ICE/UDP) can't traverse Docker NAT or a reverse proxy. |
| `-e HOST_IP=192.168.1.50` | **Required.** This box's LAN IP — advertised as the WebRTC ICE candidate and used by browsers to reach WHEP media. On the `mediamtx` service the same value is `MTX_WEBRTCADDITIONALHOSTS`. |
| `-e PUID=1000` | UserID the `mosaic` container runs as. |
| `-e PGID=1000` | GroupID the `mosaic` container runs as. |
| `-e TZ=Etc/UTC` | Timezone, e.g. `America/Indiana/Indianapolis`. |
| `-e MOSAIC_PORT=8080` | Web UI + WebSocket (chat / roster / reactions / time-sync). |
| `-e MEDIAMTX_WEBRTC_PORT=8889` | MediaMTX WHIP/WHEP port (must match `webrtcAddress` in `mediamtx.yml`). |
| `-e MEDIAMTX_PUBLISH_PASS=changeme` | OBS publish password on the `mediamtx` service (`MTX_AUTHINTERNALUSERS_0_PASS`). OBS bearer token = `streamer:<this>`; viewers need none. |
| `-v .../mediamtx/mediamtx.yml:/mediamtx.yml:ro` | MediaMTX config (ships in the repo). |

**Ports in use:** `8080` web UI + WebSocket + WHEP signaling · `8889` OBS WHIP ingest + ICE-TCP ·
`8189/udp` WebRTC media · `9997` MediaMTX API (localhost only).

### Sync engine knobs

In the viewer's controls, or `web/src/sync/config.ts` for defaults: `targetBehindLiveMs` (400),
`maxBehindLiveMs` (800), `maxBufferMs` (1000), `jitterMarginMs` (150), `bufferWidth` (640 — frame
buffer resolution; bounds memory, raise for sharper program output), `alignAudio` (true),
`useTimecode` (true), `statsPollMs` (500).

---

## Connecting OBS (streamer setup)

### 1. Stream settings (required)

**Settings → Stream:**

| Field | Value |
| --- | --- |
| **Service** | `WHIP` |
| **Server** | `http://<HOST_IP>:8889/<your-name>/whip` — pick any unique `<your-name>` (it becomes your feed key) |
| **Bearer Token** | `streamer:<MEDIAMTX_PUBLISH_PASS>` (default `streamer:changeme`; viewers need no token) |

> **TLS note:** WHIP to a non-localhost host may require HTTPS depending on OBS build, and OBS
> rejects self-signed certs. On a trusted LAN, plain `http://` to the LAN IP generally works. For
> remote streamers, terminate real TLS in front of MediaMTX (reverse proxy / valid cert).

### 2. Encoder settings (recommended, for low-latency WebRTC)

**Settings → Output (Advanced):**

| Setting | Value | Why |
| --- | --- | --- |
| Encoder | x264 | Most reliable with OBS WHIP |
| Rate Control | **CBR** | WebRTC congestion control/jitter buffers assume a steady rate |
| Bitrate | 2,500–6,000 kbps @ 1080p30 (higher OK on LAN) | — |
| Keyframe Interval | **1–2 s** (not 0/auto) | Bounds WHEP join latency and loss recovery |
| Profile | **baseline** | No B-frames in baseline |
| Tune | **zerolatency** | Disables lookahead/frame reordering |
| B-frames | **0** | Reordering adds latency |

### 3. The timecode overlay (enables frame-accurate sync)

> **Do streamers change their output resolution? No.** In the default (crop) mode you keep your
> normal 1080p/720p output and just **add one Browser source**. The viewer crops the strip
> automatically — the only ask is to keep essential content out of the top ~3.5% of the frame.
> (Resolution only changes in the optional zero-loss *overscan* mode below.)

This is what lets the viewer measure each feed's true capture time. **Add a Browser source** to your
scene:

- **URL:** `http://<HOST_IP>:8080/overlay/timecode.html` (append `?debug=1` while setting up to see
  the sync status)
- **Width / Height:** match your output canvas (e.g. 1920 × 1080), **Position:** 0, 0
- Leave "Shutdown source when not visible" **off**

The overlay paints a thin, high-contrast band across the **very top** of the frame. **Viewers never
see it** — Mosaic crops that strip off before displaying every feed. You only need to keep your own
content out of the top ~3.5% of the frame. (The overlay disciplines itself to the *Mosaic server*
clock, so your PC's clock does **not** need to be accurate — only the server's does.)

**Two ways to run it:**

- **Crop mode (default):** leave the top ~3.5% clear; the viewer clips it (a tiny zoom-to-fill, no
  black bar). Simplest — no resolution change.
- **Overscan mode (zero image loss):** set your OBS output to **1920 × 1104** so the band lives in
  24 extra px *above* your 1080 content; the viewer crops back to a pristine 1080.

> **No overlay?** The feed still works — the engine falls back to coarse WebRTC-stats timing and the
> roster tags it `~` instead of `TC`. It just won't hit the frame-level target. See below.

---

## Using the viewer

Open `http://<HOST_IP>:8080`, enter a display name, and watch.

- **Program view** — the synchronized program feed. The **auto-director** picks it (round-robin or
  active-audio, selectable in the controls bar). Click **Program** on any roster tile to pin it
  manually; click **Auto** to hand control back to the director.
- **Picture-in-picture** — click **PiP** on a roster tile to overlay it; the **⟲** button cycles it
  between corners, **✕** removes it. Every PiP is aligned to the same timeline as the program.
- **Roster** — live thumbnails. Each tile shows the feed's latency and a sync badge: **TC** =
  timecode-synced (frame-accurate), **~** = approximate (no overlay).
- **Controls** — director strategy, volume, the **Behind live** slider (the latency/sync tradeoff),
  **Align audio**, **Timecode** on/off, and the **Sync HUD** toggle.
- **Sync HUD** (bottom-right) — the live engine readout, including **inter-feed skew**, the headline
  alignment-quality number.
- **Chat & reactions** — real-time chat plus an emoji bar; reactions float over the program view for
  everyone simultaneously.

---

## How the sync engine works

The goal: every visible feed displays the **same captured wall-clock instant** at the same moment.

1. **Shared clock.** The browser (and the OBS overlay) estimate their offset to the Mosaic server's
   NTP-disciplined clock via an NTP-style WebSocket ping/pong, keeping the lowest-round-trip sample.
   All times below are in this shared server-clock domain.
2. **Per-frame capture time.** The OBS overlay burns the server-clock time into a thin luma band at
   the top of each frame. In the viewer, every presented frame (via
   `requestVideoFrameCallback`) is sampled: the band is GPU-downscaled to one pixel per cell and
   decoded back to the exact capture time. This number inherently includes encode + network +
   jitter-buffer + decode latency — exactly the quantity we must equalize.
3. **Buffer + align.** A live `<video srcObject=MediaStream>` can't be seeked, so each feed copies
   its frames (band cropped off) into a ring buffer tagged by capture time. The engine computes a
   single **target** = `serverNow − targetLatency`, where `targetLatency` = the slowest live feed's
   latency + a jitter margin, clamped to the behind-live window. Each surface (program, PiP,
   thumbnails) then draws the buffered frame whose capture time matches the target — so leading feeds
   are held back to match the most-delayed one.
4. **Continuous drift correction.** Because the engine re-selects the frame *by capture time* on
   every compositor tick, per-feed clock drift and jitter are corrected continuously, not just at
   join time.
5. **Audio.** The program feed's audio is routed through a WebAudio delay equal to the video buffer
   delay, so A/V stays in sync despite the deliberate video latency.

**Fallback (no overlay / `Timecode` off):** the engine reads `getStats().estimatedPlayoutTimestamp`
(the RTP→NTP mapping derived from RTCP Sender Reports) and applies a per-feed constant delay. This is
coarse and only works if RTCP SR survives the relay (see below).

---

## Sync quality: alignment, latency, and error sources

> **Read the real number live.** The Sync HUD's **inter-feed skew** is the *measured* spread of
> presented capture times across timecode-synced feeds, computed continuously from your actual
> streams. Watch it after the buffers fill (a few seconds after a feed joins). The numbers below are
> what to expect and why.

### Alignment achieved

- **With the timecode overlay (the design target):** the engine presents every timecode-synced feed
  by exact capture time, so steady-state inter-feed skew is bounded by frame quantization and clock
  residual — typically **~1–2 frames (≈16–33 ms @ 30 fps), often single-digit ms** on a quiet LAN.
  This is the product's headline capability.
- **Without the overlay (fallback):** alignment is coarse — **tens of ms to >100 ms**, and only if
  RTCP SR is present; otherwise feeds are shown near-live and tagged `~`/unsynced.

### Latency-behind-live (the tradeoff)

Tight sync **requires** running behind live, to absorb jitter and give the leading feeds room to be
held back. Default target is **400 ms behind live**, tunable **250–800 ms** with the *Behind live*
slider (`maxBufferMs` caps how far a feed can be delayed; default 1000 ms). Lower = closer to live but
looser/less jitter-tolerant; higher = rock-solid alignment further behind live. **The product
deliberately prioritizes inter-feed sync over minimizing latency.**

### Where the residual error comes from

1. **Per-feed jitter buffers (dominant).** Each WebRTC receive path has its own adaptive jitter
   buffer that varies with that feed's network jitter. This is the main reason uncorrected feeds
   drift by tens–hundreds of ms, and it's exactly what the deliberate buffer-to-slowest design
   neutralizes. Bigger margins absorb more of it.
2. **Timecode sampling quantization (~1 frame).** We learn capture time only at frame cadence, so
   there's up to ~1 frame of inherent uncertainty per read.
3. **Clock-sync residual (a few ms on LAN).** Server NTP discipline + the WebSocket offset estimate.
   Small on a LAN; grows with WAN RTT/asymmetry.
4. **Timecode band corruption.** Very low bitrate or covering the band breaks a read (checksum
   fails); the engine simply falls back for that frame. Mitigated by large high-contrast cells.

### Why not the "pure" RTCP-SR path?

The original spec called for deriving capture time from RTP→NTP via RTCP Sender Reports. We verified
this is **not reliably recoverable through this stack**: OBS's WHIP stack (libdatachannel) doesn't
emit the `abs-capture-time` extension; browsers never expose the raw SR mapping to JS (only the
coarse, derived `estimatedPlayoutTimestamp`); and MediaMTX's SR/`abs-capture-time` forwarding is
undocumented (one user measured **zero** SR packets through it). The burned-in timecode is the robust
substitute that achieves the *same goal* (absolute per-feed capture time) and is measured end-to-end
off the displayed pixels. The SR path remains wired up as the fallback for when it does work.

---

## Local development (no Docker)

Run MediaMTX (Docker or a binary) reachable on `:8889`/`:9997`, then:

```bash
# server (terminal 1)
cd server && npm install && npm run build && npm start   # serves :8080 + WS

# web (terminal 2) — Vite dev server with HMR, proxies /api + /ws to :8080
cd web && npm install && npm run dev                      # opens :5173

# codec self-test (encode↔decode roundtrip, no browser needed)
cd web && npm run selftest
```

Open `http://localhost:5173`. (For WHEP to localhost, browse from the same machine, or set `HOST_IP`.)

### Releasing

Add a `## vX.Y.Z` section to `CHANGELOG.md`, then tag and push:

```bash
git tag -a v1.2.3 -m "v1.2.3" && git push origin v1.2.3
```

Pushing the tag triggers two workflows: `docker-publish.yml` builds and pushes the multi-arch image
to `ghcr.io/cruv/mosaic`, and `release.yml` cuts a GitHub Release using that CHANGELOG section plus
GitHub's auto-generated "What's Changed".

---

## Known limitations & roadmap

- **WebCodecs upgrade (frame-exact).** The slice presents via `<video>` + `requestVideoFrameCallback`
  + canvas buffering, which runs on a plain-http LAN. WebCodecs (`VideoDecoder` + WebRTC Encoded
  Transform) would give true frame-exact buffering with GPU-backed `VideoFrame`s and no resolution
  cap — but it requires a **secure context (HTTPS)**, so it's the documented next step, not the
  default.
- **Buffer resolution.** Delayed frames are copied into JS-managed canvases at `bufferWidth` (640px
  default) to bound memory, so the program view is upscaled from that. Raise `bufferWidth` for
  sharper output (more RAM); WebCodecs removes this tradeoff entirely.
- **Fallback accuracy.** Without the overlay, sync relies on `estimatedPlayoutTimestamp`, which is
  coarse and SR-dependent (see above). The overlay is the path that hits the target.
- **Audio is program-only.** PiP/non-program feeds are muted; only the program feed plays (delay-aligned).
- **Single shared chat room; no persistence, no accounts** — display name only, by design for the prototype.

---

## Repository layout

```
mosaic/
├─ docker-compose.yml          # 2 services, host network, GHCR image (TrayGen-style)
├─ Dockerfile                  # multi-stage: build web + server → one runtime image
├─ entrypoint.sh               # PUID/PGID/TZ (LinuxServer.io-style)
├─ .env.example
├─ CHANGELOG.md                # per-version notes (drives GitHub Releases)
├─ .github/workflows/
│   ├─ docker-publish.yml      # multi-arch GHCR publish on push/tag
│   └─ release.yml             # GitHub Release from CHANGELOG on v* tags
├─ mediamtx/mediamtx.yml       # WHIP/WHEP + API config
├─ server/                     # Node/TS control plane
│  └─ src/ (index, hub, discovery, config, types)
│  └─ public/overlay/timecode.html   # the OBS browser-source overlay
└─ web/                        # React/TS viewer
   └─ src/
      ├─ net/      (whep, connection, timeSync, protocol, config)
      ├─ sync/     (syncEngine, feed, frameBuffer, timecode, audioController, config)  ← the core
      ├─ switch/   (strategy: round-robin, active-audio)
      └─ ui/       (App, ProgramView, Roster, Controls, Chat, SyncHud, …)
```
