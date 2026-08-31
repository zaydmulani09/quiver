/** Small DSP toolbox used by the heart-rate estimator. Everything here is pure and testable. */

export interface Biquad {
  b0: number; b1: number; b2: number; a1: number; a2: number;
}

/** RBJ cookbook band-pass (constant 0 dB peak gain). */
export function bandpassBiquad(fs: number, fLo: number, fHi: number): Biquad {
  const f0 = Math.sqrt(fLo * fHi);
  const bw = fHi - fLo;
  const q = f0 / bw;
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Causal direct-form-I IIR filter. */
export function biquadFilter(x: ArrayLike<number>, c: Biquad): Float64Array {
  const n = x.length;
  const y = new Float64Array(n);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const x0 = x[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    y[i] = y0;
  }
  return y;
}

/** Zero-phase filtering (forward + reverse). Doubles the filter order, removes phase lag. */
export function filtfilt(x: ArrayLike<number>, c: Biquad): Float64Array {
  const fwd = biquadFilter(x, c);
  fwd.reverse();
  const back = biquadFilter(fwd, c);
  back.reverse();
  return back;
}

/** Remove the least-squares linear trend. */
export function detrend(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  if (n < 2) return out;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += x[i]; sxx += i * i; sxy += i * x[i]; }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  for (let i = 0; i < n; i++) out[i] = x[i] - (slope * i + intercept);
  return out;
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

export function mean(x: ArrayLike<number>, from = 0, to = x.length): number {