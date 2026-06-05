# Changelog

All notable changes to Mosaic are documented here. Versions follow `vMAJOR.MINOR.PATCH`.
Each `v*` tag is published as a GitHub Release (notes below + auto-generated "What's Changed").

## v0.1.0

Initial prototype release — a runnable, end-to-end vertical slice.

### Highlights
- **Frame-level sync engine (the core).** Each feed's true capture time is read from an
  invisible, burned-in timecode band; every visible feed is aligned to the most-delayed feed on a
  shared server-clock timeline, with continuous drift correction and a live inter-feed **skew**
  readout. Targets ~1–2 frames of inter-feed alignment.
- **WHIP/WebRTC ingest via MediaMTX; in-browser WHEP playback.** Streamers drop in/out at any time
  — dynamic discovery via the MediaMTX API, no coordinated start.
- **Director viewer.** Auto-switch (round-robin / active-audio) behind a swappable strategy
  interface, manual pin, picture-in-picture overlays, roster thumbnails, fullscreen, volume.
- **Real-time chat + emoji reactions** over WebSocket; reactions float over the program view.
- **Self-hosted, one command.** docker-compose (host networking), LinuxServer.io-style
  `PUID`/`PGID`/`TZ`, and a multi-arch image published to GHCR.

### Streamer setup
Add one OBS Browser source (the timecode overlay) — **no output-resolution change required**; the
viewer crops the strip automatically. See the README for WHIP server/token and encoder settings.

### Known limitations
- Frame-accurate sync requires the timecode overlay; without it, the engine falls back to coarse
  WebRTC-stats timing (and the feed is tagged approximate).
- The WebCodecs path (true frame-exact, requires HTTPS) is documented as the next step.
- Program-only audio; single shared chat room; no accounts (display name only).

See the README for the full architecture, the measured-alignment details, and the latency/sync
tradeoff knobs.
