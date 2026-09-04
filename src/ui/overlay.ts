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
      ctx.fillText(num, pad, H - pad - 18 * u);
      const numW = ctx.measureText(num).width;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = `400 ${18 * u}px "Geist", system-ui, sans-serif`;
      ctx.fillText('bpm', pad + numW + 10 * u, H - pad - 18 * u);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = `500 ${11.5 * u}px "Geist Mono", ui-monospace, monospace`;
      ctx.fillText(tag, pad, H - pad);

      const n = s.waveform.length;
      if (n > 1) {
        const x0 = pad + numW + 70 * u, x1 = Math.min(W * 0.55, x0 + 260 * u);
        const ym = H - pad - 40 * u, amp = 20 * u;
        if (x1 - x0 > 60 * u) {
          const path = new Path2D();
          for (let i = 0; i < n; i++) {
            const x = x0 + (i / (n - 1)) * (x1 - x0);
            const y = ym - Math.max(-1.6, Math.min(1.6, s.waveform[i])) * amp;
            if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
          }
          ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.strokeStyle = s.accent;
          ctx.globalAlpha = 0.35; ctx.lineWidth = 6 * u; ctx.stroke(path);
          ctx.globalAlpha = 1; ctx.lineWidth = 2 * u; ctx.stroke(path);
        }
      }
    } else {
      ctx.fillText(tag, pad, H - pad);
    }
  }
}
