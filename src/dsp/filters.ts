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
  let s = 0;
  for (let i = from; i < to; i++) s += x[i];
  return to > from ? s / (to - from) : 0;
}

export function std(x: ArrayLike<number>, from = 0, to = x.length): number {
  const m = mean(x, from, to);
  let s = 0;
  for (let i = from; i < to; i++) { const d = x[i] - m; s += d * d; }
  return to > from ? Math.sqrt(s / (to - from)) : 0;
}

/**
 * Resample an irregularly-sampled signal onto a uniform grid by linear interpolation.
 * `t` must be non-decreasing. Returns samples at t0, t0+1/fs, ... up to the last t.
 */
export function resampleUniform(t: ArrayLike<number>, v: ArrayLike<number>, fs: number): { t0: number; y: Float64Array } {
  const n = t.length;
  if (n < 2) return { t0: n ? t[0] : 0, y: new Float64Array(n ? [v[0]] : []) };
  const t0 = t[0];
  const span = t[n - 1] - t0;
  const m = Math.floor(span * fs + 1e-9) + 1;
  const y = new Float64Array(m);
  let j = 0;
  for (let i = 0; i < m; i++) {
    const ti = t0 + i / fs;
    while (j < n - 2 && t[j + 1] < ti) j++;
    const ta = t[j], tb = t[j + 1];
    const f = tb > ta ? Math.min(1, Math.max(0, (ti - ta) / (tb - ta))) : 0;
    y[i] = v[j] + (v[j + 1] - v[j]) * f;
  }
  return { t0, y };
}

/**
 * Locate the dominant spectral peak within [fLo, fHi]. Returns the interpolated frequency,
 * plus a signal-to-noise ratio: main-lobe power over the rest of the in-band power.
 * `peakHalfWidth` is the lobe half-width in bins (Hann window of N samples padded to nfft: ~2 * nfft / N).
 */
export function dominantFrequency(power: ArrayLike<number>, fs: number, nfft: number, fLo: number, fHi: number, peakHalfWidth = 1): { freq: number; snr: number; peakPower: number } {
  const binHz = fs / nfft;
  const iLo = Math.max(1, Math.ceil(fLo / binHz));
  const iHi = Math.min(power.length - 2, Math.floor(fHi / binHz));
  if (iHi <= iLo) return { freq: 0, snr: 0, peakPower: 0 };
  let best = iLo, bestP = -1, total = 0;
  for (let i = iLo; i <= iHi; i++) {
    total += power[i];
    if (power[i] > bestP) { bestP = power[i]; best = i; }
  }
  // Parabolic interpolation for sub-bin precision.
  const a = Math.log(power[best - 1] + 1e-12), b = Math.log(power[best] + 1e-12), c = Math.log(power[best + 1] + 1e-12);
  const denom = a - 2 * b + c;
  const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  const freq = (best + Math.max(-0.5, Math.min(0.5, delta))) * binHz;
  let peakBand = 0;
  for (let i = Math.max(iLo, best - peakHalfWidth); i <= Math.min(iHi, best + peakHalfWidth); i++) peakBand += power[i];
  const rest = Math.max(total - peakBand, 1e-12);
  const snr = peakBand / rest;
  return { freq, snr, peakPower: bestP };
}
