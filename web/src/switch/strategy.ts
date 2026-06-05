/**
 * The "live director": picks which feed is the program. Kept behind a tiny
 * interface so the logic can be swapped/upgraded without touching the engine or
 * UI. Manual pinning is handled in the engine (it bypasses the strategy).
 */

export interface FeedSnapshot {
  name: string;
  live: boolean;
  /** 0..1 short-term audio loudness (from getSynchronizationSources). */
  audioLevel: number;
  latencyMs: number;
}

export interface SwitchContext {
  feeds: FeedSnapshot[];
  serverNow: number;
  current: string | null;
}

export interface SwitchStrategy {
  readonly id: string;
  readonly label: string;
  /** Return the feed name that should be program, or null to keep current. */
  pickProgram(ctx: SwitchContext): string | null;
  reset?(): void;
}

const liveNames = (ctx: SwitchContext) => ctx.feeds.filter((f) => f.live).map((f) => f.name).sort();

/** Rotate through live feeds on a fixed interval. */
export class RoundRobinStrategy implements SwitchStrategy {
  readonly id = 'round-robin';
  readonly label = 'Round-robin';
  private lastSwitch = 0;
  constructor(private intervalMs = 8000) {}

  pickProgram(ctx: SwitchContext): string | null {
    const names = liveNames(ctx);
    if (names.length === 0) return null;
    if (ctx.current == null || !names.includes(ctx.current)) {
      this.lastSwitch = ctx.serverNow;
      return names[0];
    }
    if (ctx.serverNow - this.lastSwitch < this.intervalMs) return ctx.current;
    this.lastSwitch = ctx.serverNow;
    const idx = names.indexOf(ctx.current);
    return names[(idx + 1) % names.length];
  }
  reset() {
    this.lastSwitch = 0;
  }
}

/** Cut to whoever is loudest, with hysteresis + a minimum hold time so it
 *  doesn't flicker on every transient. A reasonable stand-in "auto-director". */
export class ActiveAudioStrategy implements SwitchStrategy {
  readonly id = 'active-audio';
  readonly label = 'Active audio';
  private lastSwitch = 0;
  constructor(
    private minHoldMs = 1500,
    private margin = 0.06,
  ) {}

  pickProgram(ctx: SwitchContext): string | null {
    const live = ctx.feeds.filter((f) => f.live);
    if (live.length === 0) return null;
    let loudest = live[0];
    for (const f of live) if (f.audioLevel > loudest.audioLevel) loudest = f;

    if (ctx.current == null || !live.some((f) => f.name === ctx.current)) {
      this.lastSwitch = ctx.serverNow;
      return loudest.name;
    }
    if (loudest.name === ctx.current) return ctx.current;
    if (ctx.serverNow - this.lastSwitch < this.minHoldMs) return ctx.current;

    const cur = live.find((f) => f.name === ctx.current);
    if (cur && loudest.audioLevel - cur.audioLevel < this.margin) return ctx.current;
    this.lastSwitch = ctx.serverNow;
    return loudest.name;
  }
  reset() {
    this.lastSwitch = 0;
  }
}

export function makeStrategies(): SwitchStrategy[] {
  return [new RoundRobinStrategy(), new ActiveAudioStrategy()];
}
