// Runtime configuration. The viewer talks to the Mosaic server for everything
// it can (UI, WebSocket, and WHEP signaling via a same-origin proxy), so there
// are no cross-origin URLs to configure. Media (WebRTC UDP) still flows directly
// to MediaMTX via the ICE candidates carried in the proxied SDP answer.

export interface RuntimeConfig {
  /** WebSocket URL for the control plane (chat / roster / reactions / time-sync). */
  wsUrl: string;
}

let cfg: RuntimeConfig | null = null;

export async function loadConfig(): Promise<RuntimeConfig> {
  if (cfg) return cfg;
  const isHttps = location.protocol === 'https:';
  cfg = { wsUrl: `${isHttps ? 'wss' : 'ws'}://${location.host}/ws` };
  return cfg;
}

/** Same-origin WHEP endpoint; the Mosaic server proxies it to MediaMTX. */
export function whepUrl(feedName: string): string {
  return `/whep/${encodeURIComponent(feedName)}`;
}
