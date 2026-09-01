import { describe, expect, it } from 'vitest';
import { fft, powerSpectrum } from '../src/dsp/fft';
import { bandpassBiquad, detrend, dominantFrequency, filtfilt, resampleUniform } from '../src/dsp/filters';

describe('fft', () => {
  it('matches a naive DFT', () => {
    const n = 64;
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin(i * 0.3) + Math.cos(i * 1.1) * 0.5;
    const expRe = new Float64Array(n), expIm = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      for (let t = 0; t < n; t++) {
        const a = (-2 * Math.PI * k * t) / n;
        expRe[k] += re[t] * Math.cos(a);
        expIm[k] += re[t] * Math.sin(a);
      }
    }
    fft(re, im);
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(expRe[k], 8);
      expect(im[k]).toBeCloseTo(expIm[k], 8);
    }
  });

  it('finds a pure tone', () => {
    const fs = 30, nfft = 2048, f = 1.25;
    const sig = new Float64Array(300);
    for (let i = 0; i < sig.length; i++) sig[i] = Math.sin(2 * Math.PI * f * (i / fs));
    const p = powerSpectrum(sig, nfft);
    const { freq } = dominantFrequency(p, fs, nfft, 0.7, 3);
    expect(Math.abs(freq - f)).toBeLessThan(0.03);
  });
});
