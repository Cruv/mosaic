/**
 * Tunable knobs for the sync engine. These are the latency/sync tradeoff dials
 * the product spec calls for: bigger buffers absorb more jitter and align more
 * tightly, at the cost of being further behind live.
 */
export interface SyncConfig {
  /** Capture/buffer resolution width in px (height follows the feed aspect).
   *  Frames are copied into JS-managed canvases to delay them, so this bounds
   *  memory. Raise for sharper program output; lower to save RAM. */
  bufferWidth: number;
  /** Ring-buffer time depth: the most we can delay a feed to align it. */
  maxBufferMs: number;
  /** Floor for how far behind live we present (the jitter-buffer baseline). */
  targetBehindLiveMs: number;
  /** Ceiling for how far behind live we present. */
  maxBehindLiveMs: number;
  /** Extra delay added on top of the slowest feed's measured latency — the
   *  "Sync buffer" knob. Absorbs jitter and holds alignment; lower = less latency. */
  jitterMarginMs: number;
  /** Browser WebRTC jitter-buffer hint (ms). 0 = minimize it so we don't
   *  double-buffer on top of our own engine buffer (big latency win on a LAN).
   *  Raise if a jittery/remote network causes stutter. */
  playoutDelayMs: number;
  /** Delay program audio to match the buffered (delayed) program video. */
  alignAudio: boolean;
  /** Master switch: timecode-primary (true) vs getStats-only coarse mode (false). */
  useTimecode: boolean;
  /** How often to poll getStats for fallback latency + audio levels. */
  statsPollMs: number;
}

export const defaultSyncConfig: SyncConfig = {
  bufferWidth: 640,
  maxBufferMs: 1000,
  targetBehindLiveMs: 400,
  maxBehindLiveMs: 800,
  jitterMarginMs: 60,
  playoutDelayMs: 0,
  alignAudio: true,
  useTimecode: true,
  statsPollMs: 500,
};

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
