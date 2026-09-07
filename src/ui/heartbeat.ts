/**
 * Synthesised "lub-dub" for each detected beat, plus a haptic tick on phones.
 * No audio assets: two short low-frequency thumps shaped with exponential envelopes.
 * Exposes a MediaStream so recordings can carry the sound.
 */
export class Heartbeat {
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private master: GainNode | null = null;
  enabled = false;

  static get supported(): boolean {
    return typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);
  }

  /** Must be called from a user gesture the first time. */
  async enable(): Promise<void> {
    if (!this.ctx) {
      const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.dest = this.ctx.createMediaStreamDestination();
      this.master.connect(this.dest);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }
