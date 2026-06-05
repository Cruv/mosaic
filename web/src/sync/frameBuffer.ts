/**
 * A per-feed ring of decoded frames, each tagged with the wall-clock instant it
 * was captured (server-clock ms). This is what lets us DELAY a feed that is
 * running ahead: a live `<video srcObject=MediaStream>` cannot be seeked, so we
 * copy each frame into a canvas here and the compositor later draws whichever
 * buffered frame matches the shared target time.
 *
 * The band has already been cropped off before frames reach the buffer, so
 * surfaces never show the timecode strip.
 */
export interface Frame {
  captureMs: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  valid: boolean;
}

export class FrameBuffer {
  private slots: Frame[] = [];
  private writeIdx = 0;
  private w = 0;
  private h = 0;

  constructor(private capacity: number) {}

  /** Set/resize the backing canvases when the feed resolution is known. */
  ensureSize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    for (const s of this.slots) {
      s.canvas.width = w;
      s.canvas.height = h;
      s.valid = false;
    }
  }

  get width() {
    return this.w;
  }
  get height() {
    return this.h;
  }

  /** Draw a new frame into the next slot via the supplied paint callback. */
  push(captureMs: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    if (this.w === 0 || this.h === 0) return;
    let slot = this.slots[this.writeIdx];
    if (!slot) {
      const canvas = document.createElement('canvas');
      canvas.width = this.w;
      canvas.height = this.h;
      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!;
      slot = { captureMs: 0, canvas, ctx, valid: false };
      this.slots[this.writeIdx] = slot;
    }
    paint(slot.ctx, this.w, this.h);
    slot.captureMs = captureMs;
    slot.valid = true;
    this.writeIdx = (this.writeIdx + 1) % this.capacity;
  }

  /**
   * Pick the frame to present for a target capture time. Prefers the newest
   * frame at-or-before the target (so we never show a frame "from the future");
   * if the target is older than everything buffered we show the oldest we have,
   * and if we're behind (target newer than newest) we show the newest.
   */
  pick(targetMs: number): Frame | null {
    let atOrBefore: Frame | null = null;
    let oldest: Frame | null = null;
    let newest: Frame | null = null;
    for (const s of this.slots) {
      if (!s.valid) continue;
      if (!oldest || s.captureMs < oldest.captureMs) oldest = s;
      if (!newest || s.captureMs > newest.captureMs) newest = s;
      if (s.captureMs <= targetMs && (!atOrBefore || s.captureMs > atOrBefore.captureMs)) {
        atOrBefore = s;
      }
    }
    return atOrBefore ?? oldest ?? newest;
  }

  newestCaptureMs(): number | null {
    let m: number | null = null;
    for (const s of this.slots) if (s.valid && (m === null || s.captureMs > m)) m = s.captureMs;
    return m;
  }

  reset(): void {
    for (const s of this.slots) s.valid = false;
    this.writeIdx = 0;
  }
}
