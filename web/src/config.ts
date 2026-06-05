// Runtime configuration resolved from the Mosaic server at startup.

export interface RuntimeConfig {
  /** WebSocket URL for the control plane (chat / roster / reactions / time-sync). */
  wsUrl: string;
  /** Base URL of the MediaMTX WebRTC server, e.g. http://192.168.1.50:8889 */
  whepBase: string;
  mediamtxWebrtcPort: number;
}

let cfg: RuntimeConfig | null = null;

export async function loadConfig(): Promise<RuntimeConfig> {
  if (cfg) return cfg;

  let mediamtxWebrtcPort = 8889;
  let hostIp = '';
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const j = await res.json();
      mediamtxWebrtcPort = Number(j.mediamtxWebrtcPort) || mediamtxWebrtcPort;
      hostIp = typeof j.hostIp === 'string' ? j.hostIp : '';
    }
  } catch {
    // Fall back to defaults; the server may be momentarily unavailable.
  }

  const isHttps = location.protocol === 'https:';
  // The browser reaches MediaMTX at the same host it loaded the page from
  // (that's HOST_IP when viewers browse to http://HOST_IP:<port>). An explicit
  // hostIp from the server overrides this if set.
  const mediaHost = hostIp || location.hostname;

  cfg = {
    wsUrl: `${isHttps ? 'wss' : 'ws'}://${location.host}/ws`,
    whepBase: `${location.protocol}//${mediaHost}:${mediamtxWebrtcPort}`,
    mediamtxWebrtcPort,
  };
  return cfg;
}

export function whepUrl(feedName: string): string {
  if (!cfg) throw new Error('config not loaded');
  return `${cfg.whepBase}/${encodeURIComponent(feedName)}/whep`;
}
