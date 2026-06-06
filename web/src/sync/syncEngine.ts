import { Feed } from './feed';
import { type SyncConfig, defaultSyncConfig } from './config';
import type { TimeSync } from '../net/timeSync';
import { AudioController } from './audioController';
import { RoundRobinStrategy, type SwitchStrategy, type FeedSnapshot } from '../switch/strategy';

interface Surface {
  id: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  feedName: string;
}

export interface FeedMetric {
  name: string;
  state: string;
  live: boolean;
  latencyMs: number;
  hasTimecode: boolean;
  audioLevel: number;
  fps: number;
  /** Capture time (server ms) this feed presents at the shared target. */
  alignedCaptureMs: number | null;
}

export interface SyncMetrics {
  synced: boolean; // is the client time-synced to the server?
  serverNow: number;
  targetLatencyMs: number; // how far behind live we present
  /** Inter-feed alignment error: spread of presented capture times across
   *  timecode-synced feeds. This is THE headline sync-quality number. */
  residualSkewMs: number;
  syncedFeeds: number;
  feeds: FeedMetric[];
}

/**
 * The sync engine. Producers (Feed) fill per-feed buffers tagged by capture
 * time; this consumer computes a single shared target time (anchored to the
 * most-delayed feed + jitter margin, clamped to the behind-live window) and
 * draws every registered surface from the buffered frame matching that target —
 * so all visible feeds show the same captured instant. It also drives program
 * selection (swappable strategy + manual pin) and program-audio alignment.
 */
export class SyncEngine {
  private feeds = new Map<string, Feed>();
  private surfaces = new Map<string, Surface>();
  private hidden: HTMLDivElement;
  private raf = 0;
  private cfg: SyncConfig;
  private strategy: SwitchStrategy = new RoundRobinStrategy();
  private manual: string | null = null;
  private _program: string | null = null;
  private audio = new AudioController();
  private smoothedTarget = NaN;
  private lastStrategyEval = 0;
  private metrics: SyncMetrics = {
    synced: false,
    serverNow: 0,
    targetLatencyMs: 0,
    residualSkewMs: 0,
    syncedFeeds: 0,
    feeds: [],
  };
  onProgramChange?: (name: string | null) => void;

  constructor(
    private time: TimeSync,
    private urlFor: (name: string) => string,
    cfg?: Partial<SyncConfig>,
  ) {
    this.cfg = { ...defaultSyncConfig, ...cfg };
    const d = document.createElement('div');
    d.id = 'mosaic-hidden-videos';
    d.style.cssText = 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;';
    document.body.appendChild(d);
    this.hidden = d;
  }

  start(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }
  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Reconcile the live feed set with the roster (drop-in / drop-out). */
  setRoster(names: string[]): void {
    for (const n of names) {
      if (!this.feeds.has(n)) {
        const f = new Feed(n, this.cfg, this.time, this.hidden);
        this.feeds.set(n, f);
        void f.start(this.urlFor(n));
      }
    }
    for (const n of [...this.feeds.keys()]) {
      if (!names.includes(n)) {
        this.feeds.get(n)!.close();
        this.feeds.delete(n);
        if (this._program === n) this.setProgramInternal(null);
        if (this.manual === n) this.manual = null;
      }
    }
  }

  registerSurface(id: string, canvas: HTMLCanvasElement, feedName: string): void {
    const ctx = canvas.getContext('2d', { alpha: false });
    this.surfaces.set(id, { id, canvas, ctx, feedName });
  }
  unregisterSurface(id: string): void {
    this.surfaces.delete(id);
  }

  setManualProgram(name: string | null): void {
    this.manual = name;
    if (name) this.setProgramInternal(name);
  }
  get manualProgram(): string | null {
    return this.manual;
  }

  setStrategy(s: SwitchStrategy): void {
    this.strategy = s;
    s.reset?.();
  }
  get strategyId(): string {
    return this.strategy.id;
  }

  get program(): string | null {
    return this._program;
  }
  get config(): SyncConfig {
    return this.cfg;
  }
  setConfig(p: Partial<SyncConfig>): void {
    this.cfg = { ...this.cfg, ...p };
    for (const f of this.feeds.values()) (f as any).cfg = this.cfg;
  }
  setVolume(v: number): void {
    this.audio.setVolume(v);
  }
  resumeAudio(): Promise<void> {
    return this.audio.resume();
  }
  getMetrics(): SyncMetrics {
    return this.metrics;
  }

  private setProgramInternal(name: string | null): void {
    if (this._program === name) return;
    this._program = name;
    const f = name ? this.feeds.get(name) ?? null : null;
    this.audio.setProgram(f ? f.video : null);
    this.onProgramChange?.(name);
  }

  private tick = (): void => {
    const serverNow = this.time.serverNow();

    // 1) shared target latency: slowest live feed + margin, clamped to the
    //    behind-live window and to what the buffer can actually hold.
    let maxLat = 0;
    let anyLat = false;
    for (const f of this.feeds.values()) {
      if (f.live && Number.isFinite(f.latencyMs)) {
        maxLat = Math.max(maxLat, f.latencyMs);
        anyLat = true;
      }
    }
    // behind-live = slowest feed's MEASURED latency + a small jitter/alignment
    // buffer (the "Sync buffer" control). With one feed that's just its latency +
    // buffer; with several, faster feeds are held back to match the slowest. We
    // never add a blind floor on top, so latency tracks what's actually needed.
    let target = anyLat ? maxLat + this.cfg.jitterMarginMs : this.cfg.targetBehindLiveMs;
    target = Math.min(target, this.cfg.maxBufferMs - 30);
    this.smoothedTarget = Number.isFinite(this.smoothedTarget)
      ? this.smoothedTarget * 0.9 + target * 0.1
      : target;
    const targetCapture = serverNow - this.smoothedTarget;

    // 2) program selection (throttled), manual pin wins
    if (serverNow - this.lastStrategyEval > 250) {
      this.lastStrategyEval = serverNow;
      this.evaluateProgram(serverNow);
    }

    // 3) draw every registered surface from the buffered frame at the target
    for (const s of this.surfaces.values()) {
      if (!s.ctx) continue;
      const f = this.feeds.get(s.feedName);
      const frame = f ? f.pickFrame(targetCapture) : null;
      if (frame && frame.valid && frame.canvas.width > 0) {
        if (s.canvas.width !== frame.canvas.width || s.canvas.height !== frame.canvas.height) {
          s.canvas.width = frame.canvas.width;
          s.canvas.height = frame.canvas.height;
        }
        s.ctx.drawImage(frame.canvas, 0, 0);
      } else {
        if (s.canvas.width < 2) {
          s.canvas.width = 320;
          s.canvas.height = 180;
        }
        s.ctx.fillStyle = '#0a0a0f';
        s.ctx.fillRect(0, 0, s.canvas.width, s.canvas.height);
      }
    }

    // 4) program audio delay = how much we delayed the program video
    if (this._program) {
      const pf = this.feeds.get(this._program);
      if (pf) {
        const d = (this.smoothedTarget - (Number.isFinite(pf.latencyMs) ? pf.latencyMs : 0)) / 1000;
        this.audio.setDelaySeconds(this.cfg.alignAudio ? Math.max(0, d) : 0);
      }
    }

    // 5) metrics + residual inter-feed skew across timecode-synced feeds
    const feedMetrics: FeedMetric[] = [];
    const aligned: number[] = [];
    let syncedFeeds = 0;
    for (const f of this.feeds.values()) {
      const a = f.live ? f.alignedCaptureAt(targetCapture) : null;
      if (f.live && f.hasTimecode && a != null) {
        aligned.push(a);
        syncedFeeds++;
      }
      feedMetrics.push({
        name: f.name,
        state: f.state,
        live: f.live,
        latencyMs: f.latencyMs,
        hasTimecode: f.hasTimecode,
        audioLevel: f.audioLevel,
        fps: f.fps,
        alignedCaptureMs: a,
      });
    }
    const skew = aligned.length >= 2 ? Math.max(...aligned) - Math.min(...aligned) : 0;
    feedMetrics.sort((a, b) => a.name.localeCompare(b.name));
    this.metrics = {
      synced: this.time.synced,
      serverNow,
      targetLatencyMs: this.smoothedTarget,
      residualSkewMs: skew,
      syncedFeeds,
      feeds: feedMetrics,
    };

    this.raf = requestAnimationFrame(this.tick);
  };

  private evaluateProgram(serverNow: number): void {
    // Manual pin takes priority while its feed is live.
    if (this.manual) {
      if (this.feeds.get(this.manual)?.live) {
        if (this._program !== this.manual) this.setProgramInternal(this.manual);
        return;
      }
      this.manual = null; // pinned feed dropped out
    }
    const snapshot: FeedSnapshot[] = [...this.feeds.values()].map((f) => ({
      name: f.name,
      live: f.live,
      audioLevel: f.audioLevel,
      latencyMs: f.latencyMs,
    }));
    const pick = this.strategy.pickProgram({ feeds: snapshot, serverNow, current: this._program });
    if (pick && pick !== this._program) this.setProgramInternal(pick);
    else if (!pick && this._program && !this.feeds.get(this._program)?.live) this.setProgramInternal(null);
  }

  destroy(): void {
    this.stop();
    for (const f of this.feeds.values()) f.close();
    this.feeds.clear();
    this.surfaces.clear();
    try {
      this.hidden.remove();
    } catch {
      /* ignore */
    }
  }
}
