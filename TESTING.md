# Testing Mosaic with two OBS streamers

A step-by-step to get two people publishing OBS feeds and watching them in sync.
**Part 2 is self-contained — copy/paste it to your friend.**

## What you need

- A **server**: the machine running Mosaic (your TrueNAS SCALE box, or any Linux host with Docker).
  Note its LAN IP — referred to below as `SERVER_IP` (e.g. `192.168.1.50`).
- **Two computers** on the same network as the server, each with **OBS Studio 30+** and a webcam.
- **Chrome or Edge** on each computer (for watching — the frame-level sync uses a Chrome API).

> Friend not on your network? See [Remote friend](#remote-friend-not-on-your-lan) at the bottom.

---

## Part 1 — Start the Mosaic server (you, once)

On the server box:

```bash
git clone https://github.com/Cruv/mosaic.git
cd mosaic
cp .env.example .env
#   edit .env and set HOST_IP to this box's LAN IP, e.g.  HOST_IP=192.168.1.50
docker compose up -d
```

Open `http://SERVER_IP:8080` — you should see the Mosaic viewer ("No feeds live yet").

Make sure these ports are reachable on the server (open them in the firewall):

| Port | Use |
| --- | --- |
| `8080/tcp` | Web UI + WebSocket + WHEP signaling |
| `8889/tcp` | OBS WHIP publish + WebRTC ICE-TCP |
| `8189/udp` | WebRTC media |

---

## Part 2 — Connect OBS  ←  copy/paste this to each streamer

> Replace `SERVER_IP` with the server's IP, and pick a **unique** `NAME` for yourself
> (letters/numbers only, e.g. `alex`). Two streamers must **not** use the same name.

**1. Stream** — OBS → Settings → **Stream**:
- **Service:** `WHIP`
- **Server:** `http://SERVER_IP:8889/NAME/whip`
- **Bearer Token:** `streamer:changeme`

**2. Encoder** — OBS → Settings → **Output** → Output Mode = **Advanced**, Streaming tab:
- **Encoder:** `x264`
- **Rate Control:** `CBR`
- **Bitrate:** `3000`–`6000` Kbps
- **Keyframe Interval:** `1` s
- **CPU Usage Preset:** `veryfast`
- **Profile:** `baseline`
- **Tune:** `zerolatency`

(These keep WebRTC latency low so the sync engine has room to work.)

**3. Add the sync overlay** — OBS → **Sources** → **+** → **Browser**:
- **URL:** `http://SERVER_IP:8080/overlay/timecode.html`
- **Width:** `1920`  **Height:** `1080` (match your Base/Output resolution)
- Position it at **top-left (0, 0)** so it covers the whole canvas.
- Setup tip: temporarily use `http://SERVER_IP:8080/overlay/timecode.html?debug=1` — it shows
  `synced: true` once it's talking to the server. Then switch back to the plain URL.

> This paints a thin barcode strip across the very top of your video. **Viewers never see it** —
> Mosaic crops it off before display. Just keep important content out of the top ~3–4% of your scene.
> No resolution change is needed.

**4. Go live** — click **Start Streaming**.

**5. Watch** — open `http://SERVER_IP:8080` in Chrome/Edge, enter a display name, click **Watch**.

---

## Part 3 — Verify the sync

With both streamers live:

1. In the **Feeds** panel you should see **two thumbnails**, each with a green **`TC`** badge
   (timecode-synced). A yellow **`~`** means that feed's overlay isn't being read — recheck step 3.
2. Click **PiP** on the second feed so both are on screen at once.
3. Open the **Sync HUD** (button in the controls bar) and watch **"Inter-feed skew."** After a few
   seconds it should settle to roughly **16–50 ms (1–2 frames)** — that's the measured alignment
   between the feeds.
4. Try the director: **Program** pins a feed, **Auto** returns to auto-switching, and the
   **Behind live** slider trades latency for tighter sync.
5. Open the viewer on the **other computer** too and try **chat** + the **emoji reactions** — they
   land on both screens together.

**Objective sync check:** hold a phone stopwatch (with milliseconds) where **both** cameras can see
it, PiP both feeds, and compare the readout — the two feeds should show the same time.

---

## Remote friend (not on your LAN)?

The media is WebRTC, so the computers need a network path to the server. Two ways:

### Option A — Tailscale (quickest; everyone installs one app)

Puts all machines on a virtual LAN — no port-forwarding, TLS, or STUN/TURN:

1. Install Tailscale on the **server and both computers**; sign all into the same tailnet.
2. On the server: `tailscale ip -4` → note the `100.x.y.z` address.
3. Set `HOST_IP=100.x.y.z` in `.env`, then `docker compose up -d`.
4. Everyone uses that **Tailscale IP** as `SERVER_IP` throughout Part 2.

### Option B — Public via Nginx Proxy Manager + Let's Encrypt (friend installs nothing)

Your friend needs only a browser + OBS. You provide a real cert (which also fixes OBS's
self-signed-cert refusal). **Important: NPM proxies only the HTTP/WebSocket _signaling_ — the WebRTC
_media_ is UDP and bypasses NPM, so you must also forward the media port.** One-time setup on your side:

**1. DNS** — point two subdomains at your home public IP (use Dynamic DNS if it isn't static):
`watch.example.com` and `ingest.example.com`.

**2. Router port-forwards** → the Mosaic host:

| Forward | To | Why |
| --- | --- | --- |
| `443/tcp` | NPM | HTTPS (you likely already have this) |
| `80/tcp` | NPM | Let's Encrypt HTTP challenge (or use a DNS challenge) |
| `8189/udp` | Mosaic host | **WebRTC media — NPM cannot do this for you** |

`8889` does **not** need forwarding — OBS reaches it through NPM on 443.

**3. NPM → add two Proxy Hosts.** For each: *Details* tab scheme `http`; *SSL* tab → request a new
Let's Encrypt cert + "Force SSL":

| Domain | Forward Hostname / Port | Extra |
| --- | --- | --- |
| `watch.example.com` | `127.0.0.1` : `8080` | turn on **Websockets Support** |
| `ingest.example.com` | `127.0.0.1` : `8889` | — |

(If NPM runs on a different box than Mosaic, use the Mosaic host's LAN IP instead of `127.0.0.1`.)

**4. Advertise your public address + enable STUN.** In `.env` set
`MTX_WEBRTCADDITIONALHOSTS=<LAN_IP>,<PUBLIC_IP>` (the comma-list keeps LAN viewing working too),
uncomment the `stun:` line under `webrtcICEServers2` in `mediamtx/mediamtx.yml`, then
`docker compose up -d`.

**5. Connect.** Your friend follows **Part 2** with two changes:
- **OBS → Server:** `https://ingest.example.com/<name>/whip` (Bearer Token unchanged)
- **Watch at:** `https://watch.example.com`

**6. If a friend's video won't connect** (strict/symmetric NAT, or UDP blocked on their network), add
a **TURN** relay (e.g. `coturn`) to `webrtcICEServers2` and `docker compose up -d`. STUN alone can't
traverse every NAT.

> **Security:** you're now public. Keep `MEDIAMTX_PUBLISH_PASS` set, and note the default config lets
> *anyone* view — lock that down in `mediamtx.yml` auth if you don't want an open door. Bonus: serving
> over HTTPS makes the viewer a secure context, which unlocks the WebCodecs upgrade path.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Feed never appears in the roster | Confirm OBS shows "Streaming". Re-check the **Server URL** ends in `/whip` and the **Bearer Token** is exactly `streamer:changeme`. Make sure your `NAME` is unique. |
| Thumbnail stays black | UDP **8189** must be reachable from the viewer to the server — check the server firewall. |
| Badge shows `~` instead of `TC` | The overlay must sit at `0,0` covering the whole canvas, with nothing opaque over the top strip. Load it with `?debug=1` and confirm `synced: true`. |
| Skew stays high (>100 ms) | Raise **Behind live** in the controls; confirm both OBS encoders use `zerolatency` + `CBR`; congested Wi-Fi widens jitter (prefer Ethernet). |
| Video is choppy | Lower the OBS bitrate, use wired Ethernet, keep Keyframe Interval at `1` s. |
| OBS won't connect from another network | Use **Tailscale** (above). |
