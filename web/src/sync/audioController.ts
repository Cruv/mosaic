/**
 * Program audio with alignment delay. The program *video* is presented delayed
 * (held in the frame buffer to align with the other feeds), so its *audio* must
 * be delayed by the same amount or it would lead the picture. We route the
 * program element through a WebAudio DelayNode to re-sync A/V.
 *
 * If WebAudio is unavailable (or createMediaElementSource fails), we fall back to
 * plain element audio (undelayed) so the viewer still hears the program.
 */
export class AudioController {
  private ctx: AudioContext | null = null;
  private delay: DelayNode | null = null;
  private gain: GainNode | null = null;
  private sources = new Map<HTMLVideoElement, MediaElementAudioSourceNode>();
  private current: HTMLVideoElement | null = null;
  private usingGraph = false;
  private volume = 1;

  /** Call from a user gesture so audio playback / AudioContext is allowed. */
  async resume(): Promise<void> {
    this.ensureGraph();
    if (this.ctx && this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }

  private ensureGraph(): void {
    if (this.ctx) return;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctx();
      this.delay = this.ctx.createDelay(2.0);
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.delay.connect(this.gain).connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setProgram(video: HTMLVideoElement | null): void {
    if (video === this.current) return;
    if (this.current) {
      const prev = this.sources.get(this.current);
      if (prev) {
        try {
          prev.disconnect();
        } catch {
          /* ignore */
        }
      }
      this.current.muted = true;
    }
    this.current = video;
    this.usingGraph = false;
    if (!video) return;

    this.ensureGraph();
    if (this.ctx && this.delay) {
      try {
        let src = this.sources.get(video);
        if (!src) {
          src = this.ctx.createMediaElementSource(video);
          this.sources.set(video, src);
        }
        src.connect(this.delay);
        video.muted = false; // output is now rerouted through the graph
        this.usingGraph = true;
        return;
      } catch {
        /* fall through to element audio */
      }
    }
    // Fallback: direct (undelayed) element audio.
    video.muted = false;
    video.volume = this.volume;
  }

  setDelaySeconds(s: number): void {
    if (!this.usingGraph || !this.delay || !this.ctx) return;
    const v = Math.max(0, Math.min(2, s));
    try {
      this.delay.delayTime.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    } catch {
      this.delay.delayTime.value = v;
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain && this.ctx) {
      try {
        this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
      } catch {
        this.gain.gain.value = this.volume;
      }
    }
    if (this.current) this.current.volume = this.volume;
  }
}
