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