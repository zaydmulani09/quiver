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
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2 + 0.5); ctx.lineTo(w, h / 2 + 0.5);
    ctx.stroke();

    const n = this.data.length;
    if (n < 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = `${12 * this.dpr}px "Geist Mono", ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('waiting for signal', w / 2, h / 2 + 4 * this.dpr);
      return;
    }

    const amp = h * 0.32;
    const path = new Path2D();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = h / 2 - Math.max(-1.6, Math.min(1.6, this.data[i])) * amp;
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Glow.
    ctx.strokeStyle = this.color;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 6 * this.dpr;
    ctx.stroke(path);
    // Core line.
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.6 * this.dpr;
    ctx.stroke(path);

    // Fade the oldest part into the background.
    const fade = ctx.createLinearGradient(0, 0, w * 0.35, 0);
    fade.addColorStop(0, 'rgba(14,14,16,1)');
    fade.addColorStop(1, 'rgba(14,14,16,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w * 0.35, h);

    // Leading dot with a beat flash.
    const lx = w, ly = h / 2 - Math.max(-1.6, Math.min(1.6, this.data[n - 1])) * amp;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(lx - 2 * this.dpr, ly, (2.5 + this.flash * 5) * this.dpr, 0, Math.PI * 2);
    ctx.fill();
    this.flash *= 0.85;
  }
}
