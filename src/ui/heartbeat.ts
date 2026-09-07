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

  /** Audio track for recordings (only meaningful while enabled). */
  get track(): MediaStreamTrack | null {
    return this.enabled && this.dest ? this.dest.stream.getAudioTracks()[0] ?? null : null;
  }

  beat(): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.thump(t, 58, 0.16, 1.0);        // lub
    this.thump(t + 0.14, 46, 0.12, 0.55); // dub
    try { navigator.vibrate?.(18); } catch { /* not available */ }
  }

  private thump(at: number, freq: number, length: number, level: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.6, at);
    osc.frequency.exponentialRampToValueAtTime(freq, at + 0.05);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(filter).connect(gain).connect(this.master!);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }
}
