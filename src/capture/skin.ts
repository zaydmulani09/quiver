export interface Roi { cx: number; cy: number; rx: number; ry: number } // normalised video coords

export interface SkinSample { r: number; g: number; b: number; coverage: number }

/**
 * Averages the colour of skin pixels inside an elliptical region of the raw video frame.
 * Runs on a tiny 2D canvas (48×48) so it costs ~0.2 ms per frame.
 * Skin classification is the classic YCbCr box (Chai & Ngan 1999) — crude, but it reliably
 * throws out hair, eyes, teeth and background so POS gets a clean trace.
 */
export class SkinSampler {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readonly size: number;

  constructor(size = 48) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  /** Face-shaped ellipse near the centre of the frame, sized off the short edge. */
  static defaultRoi(videoW: number, videoH: number): Roi {
    const short = Math.min(videoW, videoH);
    return { cx: 0.5, cy: 0.44, rx: (0.17 * short) / videoW, ry: (0.25 * short) / videoH };
  }

  sample(video: HTMLVideoElement, roi: Roi): SkinSample | null {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const sx = (roi.cx - roi.rx) * vw, sy = (roi.cy - roi.ry) * vh;
    const sw = roi.rx * 2 * vw, sh = roi.ry * 2 * vh;