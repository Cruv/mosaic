export const config = {
  port: Number(process.env.MOSAIC_PORT ?? 8080),
  /** MediaMTX control API base, polled for live-feed discovery. */
  mediamtxApiUrl: (process.env.MEDIAMTX_API_URL ?? 'http://127.0.0.1:9997').replace(/\/$/, ''),
  /** MediaMTX WebRTC (WHIP/WHEP) port — handed to the browser so it can build WHEP URLs. */
  mediamtxWebrtcPort: Number(process.env.MEDIAMTX_WEBRTC_PORT ?? 8889),
  /**
   * Optional explicit LAN IP for the browser to reach MediaMTX. Usually unset —
   * the browser derives the host from window.location.hostname, which equals
   * HOST_IP when viewers browse to http://HOST_IP:<port>.
   */
  hostIp: process.env.HOST_IP ?? '',
  /** How often to poll MediaMTX for the live-feed roster. */
  discoveryIntervalMs: Number(process.env.MOSAIC_DISCOVERY_MS ?? 1000),
};

export type Config = typeof config;
