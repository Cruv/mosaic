import type { FeedInfo } from './types.js';
import type { Config } from './config.js';

/**
 * Polls the MediaMTX control API (/v3/paths/list) to discover which feeds are
 * currently being published. This is how drop-in / drop-out works: there is no
 * coordinated start — a feed appears in the roster the moment OBS starts
 * publishing to its path, and disappears when it stops.
 */
export class FeedDiscovery {
  private timer: NodeJS.Timeout | null = null;
  private feeds = new Map<string, FeedInfo>();
  private lastSignature = '';

  constructor(
    private cfg: Config,
    /** Called whenever the set of live feeds changes. */
    private onChange: (feeds: FeedInfo[]) => void,
  ) {}

  getFeeds(): FeedInfo[] {
    return [...this.feeds.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  start(): void {
    const tick = () => void this.poll();
    tick();
    this.timer = setInterval(tick, this.cfg.discoveryIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    let items: any[];
    try {
      const res = await fetch(`${this.cfg.mediamtxApiUrl}/v3/paths/list`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { items?: any[] };
      items = body.items ?? [];
    } catch (err) {
      // MediaMTX may not be up yet, or briefly unreachable. Keep the last roster
      // and try again next tick rather than flapping feeds off.
      if (this.feeds.size === 0) {
        // Only log while we have nothing, to avoid spamming.
        console.warn('[discovery] MediaMTX API unreachable:', (err as Error).message);
      }
      return;
    }

    const next = new Map<string, FeedInfo>();
    for (const item of items) {
      // Newer MediaMTX uses `available`; older uses `ready`. A published feed
      // also has a non-null source.
      const live = (item.available ?? item.ready) === true && item.source != null;
      if (!live) continue;

      const name: string = item.name;
      if (!name || name.startsWith('~')) continue; // skip regex/template path defs

      const existing = this.feeds.get(name);
      const codecs = extractCodecs(item);
      next.set(name, {
        name,
        since: existing?.since ?? parseTime(item.availableTime ?? item.readyTime) ?? Date.now(),
        codecs,
      });
    }

    this.feeds = next;
    const signature = [...next.keys()].sort().join('|');
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.onChange(this.getFeeds());
    }
  }
}

function extractCodecs(item: any): string[] | undefined {
  // tracks2: [{ codec: "H264", ... }]; legacy tracks: ["H264", "OPUS"] or similar.
  if (Array.isArray(item.tracks2)) {
    const c = item.tracks2.map((t: any) => t?.codec).filter(Boolean);
    return c.length ? c : undefined;
  }
  if (Array.isArray(item.tracks)) {
    const c = item.tracks.map((t: any) => (typeof t === 'string' ? t : t?.codec)).filter(Boolean);
    return c.length ? c : undefined;
  }
  return undefined;
}

function parseTime(s: unknown): number | undefined {
  if (typeof s !== 'string') return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : t;
}
