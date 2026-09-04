/**
 * Composites the WebGL output with a burned-in caption (BPM, pulse trace, wordmark, URL) onto a
 * 2D canvas. Recordings and snapshots come from here, so every clip that leaves the app explains
 * itself without a caption.
 */
export interface OverlayState {
  bpm: number | null;
  confidence: number;
  waveform: Float64Array;
  modeLabel: string;
  alpha: number;
  accent: string;
  site: string;
}

export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
  }

  draw(source: HTMLCanvasElement, s: OverlayState): void {
    const { canvas, ctx } = this;
    if (canvas.width !== source.width || canvas.height !== source.height) {
      canvas.width = source.width;
      canvas.height = source.height;
    }
    const W = canvas.width, H = canvas.height;
    ctx.drawImage(source, 0, 0, W, H);

    const u = Math.max(1, Math.min(W, H) / 480); // scale unit: 1 at 480 px tall
    const pad = 22 * u;

    // Bottom gradient so the caption stays legible on any footage.
    const grad = ctx.createLinearGradient(0, H - 150 * u, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, H - 150 * u, W, 150 * u);

    // Wordmark + URL, bottom right.
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `400 ${26 * u}px "Instrument Serif", Georgia, serif`;
    ctx.fillText('quiver', W - pad, H - pad - 22 * u);
    ctx.fillStyle = s.accent;
    ctx.beginPath();
    ctx.arc(W - pad - ctx.measureText('quiver').width - 12 * u, H - pad - 30 * u, 4.5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `500 ${11.5 * u}px "Geist Mono", ui-monospace, monospace`;
    ctx.fillText(s.site, W - pad, H - pad);

    // Mode / amplification tag, bottom left.
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `500 ${11.5 * u}px "Geist Mono", ui-monospace, monospace`;
    const tag = `${s.modeLabel.toUpperCase()}  ·  ×${Math.round(s.alpha)}  ·  ON-DEVICE`;

    if (s.bpm !== null && s.confidence >= 0.4) {
      // Big number with unit, then the trace next to it.
      ctx.fillStyle = '#fff';
      ctx.font = `500 ${64 * u}px "Geist Mono", ui-monospace, monospace`;
      const num = String(Math.round(s.bpm));