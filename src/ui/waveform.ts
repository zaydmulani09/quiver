/** Scrolling pulse trace — the ECG-looking strip under the BPM number. */
export class Waveform {
  private ctx: CanvasRenderingContext2D;
  private data: Float64Array = new Float64Array(0);
  private flash = 0;
  private dpr = 1;
  color = '#ff4d4d';

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  set(data: Float64Array): void { this.data = data; }
  beat(): void { this.flash = 1; }
  clear(): void { this.data = new Float64Array(0); this.flash = 0; }

  draw(): void {
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Baseline grid.