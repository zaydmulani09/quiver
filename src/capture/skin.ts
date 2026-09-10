export interface Roi { cx: number; cy: number; rx: number; ry: number } // normalised video coords

export interface SkinSample {
  r: number; g: number; b: number;
  /** Fraction of the ellipse classified as skin. */
  coverage: number;
  /** Mean of everything inside the ellipse (fallback when the skin box misses a complexion). */
  all: { r: number; g: number; b: number };
}

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
    this.ctx.imageSmoothingQuality = 'high';
  }

  private frame: HTMLCanvasElement | null = null;
  private frameCtx: CanvasRenderingContext2D | null = null;
  private prevBlocks: Float32Array | null = null;
  private motionFloor = 0;
  private lastFrameData: Uint8ClampedArray | null = null;

  /** Draw the frame at 64x48 once per call; shared by motion() and locate(). */
  private grabFrame(video: HTMLVideoElement): Uint8ClampedArray | null {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    if (!this.frame) {
      this.frame = document.createElement('canvas');
      this.frame.width = 64; this.frame.height = 48;
      this.frameCtx = this.frame.getContext('2d', { willReadFrequently: true });
      this.frameCtx!.imageSmoothingQuality = 'high';
    }
    try { this.frameCtx!.drawImage(video, 0, 0, 64, 48); } catch { return null; }
    this.lastFrameData = this.frameCtx!.getImageData(0, 0, 64, 48).data;
    return this.lastFrameData;
  }

  /**
   * How much the picture changed since the previous call: mean absolute luma difference (0..255)
   * over the whole frame. Head or camera motion lights this up long before it is visible; the
   * magnifier uses it to fade the gain down so motion does not turn into amplified ghosting.
   */
  resetMotion(): void { this.prevLuma = null; }

  motion(video: HTMLVideoElement): number {
    const d = this.grabFrame(video);
    if (!d) return 0;
    const n = 64 * 48;
    const first = !this.prevLuma;
    if (!this.prevLuma) this.prevLuma = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const l = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      sum += Math.abs(l - this.prevLuma[i]);
      this.prevLuma[i] = l;
    }
    return first ? 0 : sum / n;
  }

  /**
   * Find where the skin is. Draws the whole frame at 64x48, classifies skin, and returns the
   * centroid and spread of skin pixels (normalised), or null if there is hardly any skin.
   * Used to slide the ROI onto the face so nobody has to line up with the oval.
   */
  locate(video: HTMLVideoElement): { cx: number; cy: number; sx: number; sy: number; fraction: number } | null {
    const W = 64, H = 48;
    // Reuse the frame motion() grabbed this tick when available.
    const d = this.lastFrameData ?? this.grabFrame(video);
    if (!d) return null;
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0;
    for (let y = 2; y < H - 2; y++) {
      for (let x = 3; x < W - 3; x++) {
        const i = (y * W + x) * 4;
        const R = d[i], G = d[i + 1], B = d[i + 2];
        const yy = 0.299 * R + 0.587 * G + 0.114 * B;
        if (yy < 25 || yy > 245) continue;
        const cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
        const cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
        if (cb < 75 || cb > 130 || cr < 132 || cr > 180) continue;
        n++; sx += x; sy += y; sxx += x * x; syy += y * y;
      }
    }
    const total = (W - 6) * (H - 4);
    if (n < total * 0.02) return null;
    const mx = sx / n, my = sy / n;
    const vx = Math.max(0, sxx / n - mx * mx), vy = Math.max(0, syy / n - my * my);
    return { cx: (mx + 0.5) / W, cy: (my + 0.5) / H, sx: Math.sqrt(vx) / W, sy: Math.sqrt(vy) / H, fraction: n / total };
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
    const n = this.size;
    try {
      this.ctx.drawImage(video, sx, sy, sw, sh, 0, 0, n, n);
    } catch {
      return null;
    }
    const data = this.ctx.getImageData(0, 0, n, n).data;
    let r = 0, g = 0, b = 0, count = 0, inside = 0, ar = 0, ag = 0, ab = 0;
    const half = n / 2;
    for (let y = 0; y < n; y++) {
      const dy = (y + 0.5 - half) / half;
      for (let x = 0; x < n; x++) {
        const dx = (x + 0.5 - half) / half;
        if (dx * dx + dy * dy > 1) continue;
        inside++;
        const i = (y * n + x) * 4;
        const R = data[i], G = data[i + 1], B = data[i + 2];
        ar += R; ag += G; ab += B;
        const yy = 0.299 * R + 0.587 * G + 0.114 * B;
        if (yy < 25 || yy > 245) continue;
        const cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
        const cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
        if (cb < 75 || cb > 130 || cr < 132 || cr > 180) continue;
        r += R; g += G; b += B; count++;
      }
    }
    if (!inside) return null;
    const all = { r: ar / inside, g: ag / inside, b: ab / inside };
    if (!count) return { r: 0, g: 0, b: 0, coverage: 0, all };
    return { r: r / count, g: g / count, b: b / count, coverage: count / inside, all };
  }
}
