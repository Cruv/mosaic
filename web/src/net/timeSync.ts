/**
 * Estimates this client's offset to the Mosaic server's (NTP-disciplined) clock,
 * which is the shared timeline every feed is aligned against. Standard NTP trick:
 * keep the offset from the lowest-round-trip sample, since that's the least
 * asymmetric measurement. The min-RTT baseline is periodically relaxed so we can
 * re-discover a better sample if the network improves.
 */
export class TimeSync {
  private offset = 0; // serverNow ≈ Date.now() + offset
  private bestRtt = Infinity;
  private _synced = false;
  private _lastRtt = NaN;

  /** Rough initial offset from the welcome message (refined by pongs). */
  seed(serverTime: number): void {
    if (!this._synced) this.offset = serverTime - Date.now();
  }

  onPong(c0: number, s: number): void {
    const c1 = Date.now();
    const rtt = c1 - c0;
    this._lastRtt = rtt;
    if (rtt <= this.bestRtt) {
      this.bestRtt = rtt;
      this.offset = s - (c0 + c1) / 2;
      this._synced = true;
    }
  }

  /** Let the min-RTT baseline drift up slightly so a one-off lucky sample can't lock us. */
  relax(): void {
    if (this.bestRtt !== Infinity) this.bestRtt += 5;
  }

  /** Current best estimate of the server wall-clock, in ms. */
  serverNow(): number {
    return Date.now() + this.offset;
  }

  get synced(): boolean {
    return this._synced;
  }
  get offsetMs(): number {
    return this.offset;
  }
  get rttMs(): number {
    return this.bestRtt === Infinity ? NaN : this.bestRtt;
  }
  get lastRttMs(): number {
    return this._lastRtt;
  }
}
