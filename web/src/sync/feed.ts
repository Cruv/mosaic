import { startWhep, type WhepSession } from '../net/whep';
import { FrameBuffer, type Frame } from './frameBuffer';
import { readTimecode, makeScratch, type TimecodeScratch, TC_CROP_FRACTION } from './timecode';
import type { TimeSync } from '../net/timeSync';
import type { SyncConfig } from './config';

export type FeedState = 'connecting' | 'live' | 'error' | 'closed';

/**
 * One published feed: a hidden WHEP `<video>` plus the producer side of the sync
 * engine. On every presented frame (requestVideoFrameCallback) it reads the
 * capture time (timecode primary, getStats fallback), crops the timecode band,
 * and copies the frame into the ring buffer tagged with that capture time.
 */
export class Feed {
  readonly video: HTMLVideoElement;
  readonly buffer: FrameBuffer;
  state: FeedState = 'connecting';
  lastError = '';
  latencyMs = NaN; // smoothed end-to-end latency = serverNow - captureMs
  hasTimecode = false;
  audioLevel = 0; // 0..1, for active-audio switching
  fps = 0;

  private session: WhepSession | null = null;
  private scratch: TimecodeScratch = makeScratch();
  private rvfc = 0;
  private statsTimer = 0;
  private tcStreak = 0; // hysteresis to latch hasTimecode on/off
  private lastNow = 0;
  private statsLatencyMs = NaN; // fallback latency from estimatedPlayoutTimestamp
  private destroyed = false;

  constructor(
    readonly name: string,
    private cfg: SyncConfig,
    private time: TimeSync,
    parent: HTMLElement,
  ) {
    const v = document.createElement('video');
    v.muted = true; // enables autoplay; program audio is handled separately
    v.autoplay = true;
    v.playsInline = true;
    (v as any).disablePictureInPicture = true;
    v.style.cssText = 'position:absolute;width:2px;height:2px;opacity:0;pointer-events:none;';
    parent.appendChild(v);
    this.video = v;

    const frames = Math.ceil((cfg.maxBufferMs / 1000) * 65) + 6;
    this.buffer = new FrameBuffer(frames);
  }

  async start(url: string): Promise<void> {
    try {
      const s = await startWhep(url);
      if (this.destroyed) {
        s.close();
        return;
      }
      this.session = s;
      this.video.srcObject = s.stream;
      // Minimize the browser's own jitter buffer — we do the buffering ourselves,
      // so its extra delay is pure double-buffering. Biggest single latency win.
      const hint = Math.max(0, (this.cfg.playoutDelayMs ?? 0) / 1000);
      for (const r of s.pc.getReceivers()) {
        try {
          (r as unknown as { playoutDelayHint: number }).playoutDelayHint = hint;
        } catch {
          /* not supported in this browser */
        }
      }
      s.pc.addEventListener('connectionstatechange', () => {
        const st = s.pc.connectionState;
        if (st === 'failed' || st === 'disconnected' || st === 'closed') {
          if (!this.destroyed) {
            this.state = 'error';
            this.lastError = st;
          }
        }
      });
      await this.video.play().catch(() => {});
      this.state = 'live';
      this.scheduleFrame();
      this.statsTimer = window.setInterval(() => void this.pollStats(), this.cfg.statsPollMs);
    } catch (e) {
      this.state = 'error';
      this.lastError = (e as Error).message;
    }
  }

  private scheduleFrame(): void {
    const cb = (now: number, meta: VideoFrameCallbackMetadata) => {
      if (this.destroyed) return;
      this.onFrame(now, meta);
      this.rvfc = this.video.requestVideoFrameCallback(cb);
    };
    this.rvfc = this.video.requestVideoFrameCallback(cb);
  }

  private onFrame(now: number, _meta: VideoFrameCallbackMetadata): void {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return;
    const serverNow = this.time.serverNow();

    // fps from presentation cadence (mediaTime is unreliable for WebRTC)
    if (this.lastNow) {
      const dt = now - this.lastNow;
      if (dt > 0) this.fps = this.fps ? this.fps * 0.9 + (1000 / dt) * 0.1 : 1000 / dt;
    }
    this.lastNow = now;

    // 1) capture time — timecode primary, getStats fallback
    let captureMs: number | null = null;
    if (this.cfg.useTimecode) {
      const tc = readTimecode(this.video, this.scratch);
      if (tc != null) {
        captureMs = tc;
        this.tcStreak = Math.min(8, this.tcStreak + 1);
        if (this.tcStreak >= 3) this.hasTimecode = true;
      } else {
        this.tcStreak = Math.max(-8, this.tcStreak - 1);
        if (this.tcStreak <= -4) this.hasTimecode = false;
      }
    } else {
      this.hasTimecode = false;
    }
    if (captureMs == null) {
      const lat = Number.isFinite(this.statsLatencyMs) ? this.statsLatencyMs : 0;
      captureMs = serverNow - lat;
    }

    // 2) smoothed end-to-end latency
    const inst = serverNow - captureMs;
    this.latencyMs = Number.isFinite(this.latencyMs) ? this.latencyMs * 0.85 + inst * 0.15 : inst;

    // 3) crop the timecode band + its compression-ringing margin (only when
    //    present) and buffer the frame
    const cropTop = this.hasTimecode ? Math.round(vh * TC_CROP_FRACTION) : 0;
    const srcH = vh - cropTop;
    const bw = this.cfg.bufferWidth;
    const bh = Math.max(2, Math.round((bw * srcH) / vw));
    this.buffer.ensureSize(bw, bh);
    this.buffer.push(captureMs, (ctx, w, h) => {
      ctx.drawImage(this.video, 0, cropTop, vw, srcH, 0, 0, w, h);
    });
  }

  private async pollStats(): Promise<void> {
    const pc = this.session?.pc;
    if (!pc) return;
    try {
      const stats = await pc.getStats();
      stats.forEach((r: any) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video' && typeof r.estimatedPlayoutTimestamp === 'number') {
          const sn = this.time.serverNow();
          // estimatedPlayoutTimestamp is an NTP capture time of the playing frame.
          // Only trust it if it reads as a plausible absolute unix-ms near the
          // server clock (i.e. RTCP SR survived and sender ~NTP-synced).
          if (r.estimatedPlayoutTimestamp > 1e12 && Math.abs(sn - r.estimatedPlayoutTimestamp) < 60000) {
            this.statsLatencyMs = sn - r.estimatedPlayoutTimestamp;
          }
        }
      });
      for (const rcv of pc.getReceivers()) {
        if (rcv.track?.kind === 'audio') {
          const ss = (rcv as any).getSynchronizationSources?.() ?? [];
          if (ss[0] && typeof ss[0].audioLevel === 'number') {
            this.audioLevel = this.audioLevel * 0.6 + ss[0].audioLevel * 0.4;
          }
        }
      }
    } catch {
      /* transient; try again next poll */
    }
  }

  pickFrame(targetCaptureMs: number): Frame | null {
    return this.buffer.pick(targetCaptureMs);
  }

  /** The capture time this feed would present at the target — used for skew metrics. */
  alignedCaptureAt(targetCaptureMs: number): number | null {
    return this.buffer.pick(targetCaptureMs)?.captureMs ?? null;
  }

  get live(): boolean {
    return this.state === 'live';
  }

  close(): void {
    this.destroyed = true;
    if (this.rvfc) {
      try {
        this.video.cancelVideoFrameCallback(this.rvfc);
      } catch {
        /* ignore */
      }
    }
    window.clearInterval(this.statsTimer);
    this.session?.close();
    this.video.srcObject = null;
    this.state = 'closed';
    try {
      this.video.remove();
    } catch {
      /* ignore */
    }
  }
}
